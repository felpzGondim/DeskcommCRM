/**
 * Ficha preliminar local (A1) — ler e gerar relatório. O botão e a ferramenta
 * enfileiram; o worker chama `gerarRelatorioPreliminarDoPainel`.
 */
import { limitesDaAnalise } from "@/lib/agent-engine/agent/painel-anexos-limites";
import {
  enriquecerAnexosDaAnalise,
  frasesDosAvisos,
} from "@/lib/agent-engine/agent/painel-leitura-anexos";
import {
  blocoDasFontesDaFicha,
  familiaresDaFicha,
  fontesDaFicha,
  gerarRelatorioPreliminarNoPainel,
  prepararFontesDoRelatorio,
  rendaDeclaradaNasFontes,
} from "@/lib/agent-engine/agent/painel-relatorio-preliminar";
import {
  criarExtratorComModelo,
  leitorSuperlogicaDesligado,
  lerSeguroIncendioNoTexto,
  montarPacote,
} from "@/lib/locacao/extrato";
import { preencherRendaDeclaradaInicial, preservarEdicoesHumanas } from "@/lib/locacao/renda-utilizada";
import { completarFicha } from "@/lib/locacao/ficha-schema";
import { pacoteSuperlogicaLigado } from "@/lib/locacao/chaves";
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
import {
  codigoDaFalhaDoRelatorio,
  motivoDaFalhaDoRelatorio,
  textoDaFalhaDoRelatorio,
  type EtapaFalhaRelatorio,
} from "@/lib/painel/relatorio-preliminar-motivo";
import { eventoVencedor, listarGeracoesEmCurso } from "@/lib/painel/relatorio-preliminar-fila";
import type { ContextoDaFerramenta, ResultadoDaFerramenta } from "@/lib/painel/ferramentas/tipos";

export {
  motivoDaFalhaDoRelatorio,
  textoDaFalhaDoRelatorio,
  type MotivoFalhaRelatorio,
} from "@/lib/painel/relatorio-preliminar-motivo";

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
  opcoes: { eventoId?: string } = {},
): Promise<ResultadoDaFerramenta> {
  const emCurso = await listarGeracoesEmCurso(ctx.admin, ctx.orgId, ctx.conversationId);
  const vencedor = eventoVencedor(emCurso);
  if (vencedor && vencedor.id !== opcoes.eventoId) {
    return {
      ok: false,
      texto: "O relatório preliminar já está sendo gerado.",
      codigo: "idempotency_in_progress",
    };
  }
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
  let etapa: EtapaFalhaRelatorio = "anexos";
  try {
    const enriquecido = await enriquecerAnexosDaAnalise(janela, ctx.orgId, ctx.conversationId, {
      limites,
      senhas: senhasPdf,
      lerDocumento: (e) => lerDocumentoPorVisao({ ...e, llmCfg: deps.llmCfg }),
    });
    const fontes = fontesDaFicha(enriquecido.linhas, {
      charsPorAnexo: limites.chars_por_arquivo,
    });
    const atualPrevia = await lerFichaAtual(ctx.admin, ctx.orgId, ctx.conversationId);
    const fichaPrevia = atualPrevia ? completarFicha(atualPrevia.ficha) : null;
    const familiares = fichaPrevia ? familiaresDaFicha(fichaPrevia) : [];
    const pool = getRequestPool();
    etapa = "extracao_extrato";
    const preparado = await prepararFontesDoRelatorio(fontes, {
      familiares,
      extrator: criarExtratorComModelo(
        pool,
        deps.llmCfg,
        { tenantId: ctx.orgId, contactId: ctx.contactId },
        { registry: deps.registry, log: deps.log },
      ),
    });
    const bloco = blocoDasFontesDaFicha(preparado.fontes);
    if (bloco.length > limites.chars_conjunto) {
      return {
        ok: false,
        texto: "Há documentos demais para conferir de uma vez. Revise os anexos desta conversa.",
        codigo: "validation_error",
      };
    }
    const incendio =
      fontes.map((f) => lerSeguroIncendioNoTexto(f.texto)).find((v) => v != null) ?? null;
    const sl = pacoteSuperlogicaLigado(ctx.settings)
      ? await leitorSuperlogicaDesligado().ler({ orgId: ctx.orgId, contactId: ctx.contactId })
      : null;
    const pacote = montarPacote({
      superlogica: sl,
      conversa: { seguroIncendioCentavos: incendio },
    });
    etapa = "relatorio";
    const { saida } = await gerarRelatorioPreliminarNoPainel(
      pool,
      deps.llmCfg,
      {
        tenantId: ctx.orgId,
        contactId: ctx.contactId,
        fontes: bloco,
        analisesExtrato: preparado.analises,
        pendenciasDeFonte: preparado.pendencias,
        rendaDeclaradaCentavos: rendaDeclaradaNasFontes(fontes),
        holeriteCentavos: preparado.holeriteCentavos,
        pacote,
      },
      { registry: deps.registry, log: deps.log },
    );
    const avisos = frasesDosAvisos(enriquecido.avisos, limites.tentativas_senha);
    const inicial = preencherRendaDeclaradaInicial(saida.ficha, rendaDeclaradaNasFontes(fontes));
    const fichaExtraida = fichaPrevia ? preservarEdicoesHumanas(inicial, fichaPrevia) : inicial;
    const ficha = {
      ...fichaExtraida,
      pendencias: [...new Set([...saida.ficha.pendencias, ...avisos])].slice(0, 20),
    };
    etapa = "gravacao";
    const linha = await gravarVersaoDaFicha(ctx.admin, {
      organizationId: ctx.orgId,
      conversationId: ctx.conversationId,
      ficha,
      relatorio: saida.relatorio,
      origem: "preliminar_ia",
      baseVersao: atualPrevia?.versao ?? 0,
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
    const motivo = motivoDaFalhaDoRelatorio(err);
    const codigo = codigoDaFalhaDoRelatorio(motivo);
    logger.error("[painel-ficha] falha ao gerar relatório", {
      requestId: ctx.requestId,
      organizationId: ctx.orgId,
      codigo,
      motivo,
      etapa,
    });
    return {
      ok: false,
      texto: textoDaFalhaDoRelatorio(motivo),
      codigo,
      extra: { motivo },
    };
  }
}
