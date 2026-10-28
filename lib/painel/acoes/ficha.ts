/**
 * Ficha preliminar local (A1) — ler e gerar relatório. O mesmo caminho do botão
 * Gerar relatório preliminar.
 */
import { limitesDaAnalise } from "@/lib/agent-engine/agent/painel-anexos-limites";
import {
  enriquecerAnexosDaAnalise,
  frasesDosAvisos,
} from "@/lib/agent-engine/agent/painel-leitura-anexos";
import {
  blocoDasFontesDaFicha,
  fontesDaFicha,
  gerarRelatorioPreliminarNoPainel,
} from "@/lib/agent-engine/agent/painel-relatorio-preliminar";
import { requestTurnDeps } from "@/lib/agent-engine/agent/request-deps";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { lerDocumentoPorVisao } from "@/lib/ai/visao/ler-documento";
import {
  FichaConflitoDeVersao,
  gravarVersaoDaFicha,
  lerFichaAtual,
  listarHistoricoDaFicha,
} from "@/lib/locacao/ficha-repositorio";
import { mascararPessoaNoTexto } from "@/lib/painel/mascarar";
import { logger } from "@/lib/logger";
import type { ContextoDaFerramenta, ResultadoDaFerramenta } from "@/lib/painel/ferramentas/tipos";

export async function lerFichaDoPainel(ctx: ContextoDaFerramenta): Promise<ResultadoDaFerramenta> {
  const atual = await lerFichaAtual(ctx.admin, ctx.orgId, ctx.conversationId);
  if (!atual) return { ok: true, texto: "Ainda não há ficha preliminar nesta conversa." };
  const historico = await listarHistoricoDaFicha(ctx.admin, ctx.orgId, ctx.conversationId);
  return {
    ok: true,
    texto: mascararPessoaNoTexto(
      `Ficha v${atual.versao} (${atual.origem}). Relatório: ${atual.relatorio}\nPendências: ${JSON.stringify((atual.ficha as { pendencias?: unknown }).pendencias ?? [])}`,
    ),
    extra: {
      versao: atual.versao,
      origem: atual.origem,
      ficha: atual.ficha,
      relatorio: atual.relatorio,
      historico,
    },
  };
}

export async function gerarRelatorioPreliminarDoPainel(
  ctx: ContextoDaFerramenta,
  senhasPdf: Record<string, string> = {},
): Promise<ResultadoDaFerramenta> {
  const limites = limitesDaAnalise(ctx.settings);
  const { data: linhas, error: erroFontes } = await ctx.dbSessao
    .from("messages")
    .select(
      "id,direction,type,body,media_derived_text,media_derived_status,media_mime,media_storage_path,media_size_bytes,metadata,revoked_at",
    )
    .eq("organization_id", ctx.orgId)
    .eq("conversation_id", ctx.conversationId)
    .order("sent_at", { ascending: false })
    .limit(limites.mensagens_brutas);
  if (erroFontes) {
    return {
      ok: false,
      texto: "Não foi possível ler a conversa para o relatório preliminar.",
      codigo: "internal_error",
    };
  }
  const janela = (linhas ?? []).slice(0, 200) as Record<string, unknown>[];
  const deps = requestTurnDeps();
  try {
    const enriquecido = await enriquecerAnexosDaAnalise(janela, ctx.orgId, ctx.conversationId, {
      limites,
      senhas: senhasPdf,
      lerDocumento: (e) => lerDocumentoPorVisao({ ...e, llmCfg: deps.llmCfg }),
    });
    const fontes = fontesDaFicha(enriquecido.linhas);
    const bloco = blocoDasFontesDaFicha(fontes);
    if (bloco.length > limites.chars_conjunto) {
      return {
        ok: false,
        texto: "Há documentos demais para conferir de uma vez. Revise os anexos desta conversa.",
        codigo: "validation_error",
      };
    }
    const { saida } = await gerarRelatorioPreliminarNoPainel(
      getRequestPool(),
      deps.llmCfg,
      { tenantId: ctx.orgId, contactId: ctx.contactId, fontes: bloco },
      { registry: deps.registry, log: deps.log },
    );
    const avisos = frasesDosAvisos(enriquecido.avisos, limites.tentativas_senha);
    const ficha = {
      ...saida.ficha,
      pendencias: [...new Set([...saida.ficha.pendencias, ...avisos])].slice(0, 20),
    };
    const atual = await lerFichaAtual(ctx.admin, ctx.orgId, ctx.conversationId);
    const linha = await gravarVersaoDaFicha(ctx.admin, {
      organizationId: ctx.orgId,
      conversationId: ctx.conversationId,
      ficha,
      relatorio: saida.relatorio,
      origem: "preliminar_ia",
      baseVersao: atual?.versao ?? 0,
      alteradoPor: ctx.userId,
    });
    const historico = await listarHistoricoDaFicha(ctx.admin, ctx.orgId, ctx.conversationId);
    return {
      ok: true,
      texto: mascararPessoaNoTexto(saida.relatorio),
      avisos: enriquecido.avisos,
      extra: {
        versao: linha.versao,
        origem: linha.origem,
        ficha: linha.ficha,
        relatorio: linha.relatorio,
        campos_alterados: linha.campos_alterados,
        historico,
      },
    };
  } catch (err) {
    if (err instanceof FichaConflitoDeVersao) {
      return {
        ok: false,
        texto: "Outra pessoa alterou a ficha. Recarregue e gere de novo.",
        codigo: "idempotency_conflict",
      };
    }
    const codigo =
      err instanceof Error && err.message === "saida_truncada"
        ? "saida_truncada"
        : "invalid_format";
    logger.error("[painel-ficha] falha ao gerar relatório", {
      requestId: ctx.requestId,
      organizationId: ctx.orgId,
      codigo,
    });
    return {
      ok: false,
      texto:
        codigo === "saida_truncada"
          ? "Não foi possível gerar o relatório preliminar. A resposta da IA ficou incompleta. Tente de novo."
          : "Não foi possível gerar o relatório preliminar. A resposta da IA veio em formato inválido. Tente de novo.",
      codigo,
    };
  }
}
