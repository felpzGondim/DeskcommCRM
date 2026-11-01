/**
 * Única função que inicia a análise de renda. Botão e chat chamam esta.
 * Só enfileira: devolve o id. Quem processa é o worker.
 */
import { hashDaEntradaDaRenda } from "@/lib/locacao/analise/entrada-hash";
import { MOTIVOS_RENDA } from "@/lib/locacao/analise/motivos-renda";
import { analiseLigada } from "@/lib/locacao/chaves";
import { abrirExecucao, lerExecucaoEmAndamento } from "@/lib/locacao/execucoes";
import { lerFichaAtualDoProcesso } from "@/lib/locacao/repositorio";
import { limitesDaAnalise } from "@/lib/agent-engine/agent/painel-anexos-limites";
import type { ContextoDaFerramenta, ResultadoDaFerramenta } from "@/lib/painel/ferramentas/tipos";

import { processoDaConversa } from "@/lib/locacao/analise/processo-da-conversa";

export const TEXTO_RENDA_NA_FILA = "Análise de renda na fila.";

export type ArgsDaRenda = {
  processo_id?: string;
  participante_id?: string;
  senhas?: Record<string, string>;
};

export async function iniciarAnaliseDeRenda(
  ctx: ContextoDaFerramenta,
  args: ArgsDaRenda = {},
): Promise<ResultadoDaFerramenta> {
  if (!analiseLigada(ctx.settings, "renda")) {
    return { ok: false, texto: MOTIVOS_RENDA.desligada, codigo: "tool_unavailable" };
  }
  const alvo = await processoDaConversa(ctx, args.processo_id);
  if ("ok" in alvo) return alvo;

  const emAndamento = await lerExecucaoEmAndamento(ctx.admin, ctx.orgId, alvo.id, "renda");
  if (emAndamento) {
    return {
      ok: true,
      texto: TEXTO_RENDA_NA_FILA,
      extra: {
        execucao_id: emAndamento.id,
        estado: emAndamento.estado,
        etapa_texto: emAndamento.etapa_texto,
        reusada: true,
      },
    };
  }

  const limites = limitesDaAnalise(ctx.settings);
  const { data: linhas, error: erroFontes } = await ctx.dbSessao
    .from("messages")
    .select("id,media_storage_path,media_size_bytes")
    .eq("organization_id", ctx.orgId)
    .eq("conversation_id", ctx.conversationId)
    .order("sent_at", { ascending: false })
    .limit(limites.mensagens_brutas);
  if (erroFontes) {
    return { ok: false, texto: MOTIVOS_RENDA.conversa, codigo: "internal_error" };
  }

  const ficha = await lerFichaAtualDoProcesso(ctx.admin, ctx.orgId, alvo.id);
  const entradaHash = hashDaEntradaDaRenda({
    processoId: alvo.id,
    conversationId: ctx.conversationId,
    fichaVersao: ficha?.versao ?? null,
    mensagens: linhas ?? [],
    senhaNomes: Object.keys(args.senhas ?? {}),
  });

  const origem = ctx.origem === "agente" ? "chat" : "botao";
  const execucaoId = await abrirExecucao(ctx.admin, {
    orgId: ctx.orgId,
    processoId: alvo.id,
    aba: "renda",
    origem,
    atorUserId: ctx.userId,
    participanteId: args.participante_id ?? null,
    entradaHash,
    fichaVersao: ficha?.versao ?? null,
    callId: ctx.requestId,
    etapaTexto: "na fila",
    resultado: {
      conversation_id: ctx.conversationId,
      contact_id: ctx.contactId,
      senhas: args.senhas ?? {},
      request_id: ctx.requestId,
    },
  });

  return {
    ok: true,
    texto: TEXTO_RENDA_NA_FILA,
    extra: {
      execucao_id: execucaoId,
      estado: "na_fila",
      etapa_texto: "na fila",
      entrada_hash: entradaHash,
    },
  };
}
