/**
 * Botões da casca do modal: chamam as rotas que já existem.
 * Sem cliente MCP do Hub. Sem dado pessoal.
 *
 * Renda: o POST só enfileira (202 + execucao_id). A casca lê o status
 * em `locacao_execucoes` (polling da AbaComExecucao).
 */
import { apiClient } from "@/lib/api/client";
import { PONTO_RENDA_ASSINCRONA } from "@/lib/locacao/execucao-da-aba";
import type { AbaDaExecucao } from "@/lib/locacao/vocabulario";

export { PONTO_RENDA_ASSINCRONA };

export type ResultadoDeRodarAba = {
  execucao_id?: string;
};

export async function rodarAbaDoModal(input: {
  conversationId: string;
  aba: AbaDaExecucao;
  processoId: string;
  senhasPdf?: Array<{ nome: string; senha: string }>;
}): Promise<ResultadoDeRodarAba> {
  const base = `/api/v1/conversations/${input.conversationId}/painel-agente`;
  if (input.aba === "renda") {
    const r = await apiClient.post<{ data?: { execucao_id?: string } }>(
      PONTO_RENDA_ASSINCRONA.rota.replace(":id", input.conversationId),
      {
        etapa: "analisar",
        processo_id: input.processoId,
        senhasPdf: input.senhasPdf?.length ? input.senhasPdf : undefined,
      },
    );
    const id = typeof r.data?.execucao_id === "string" ? r.data.execucao_id : "";
    return { execucao_id: id || undefined };
  }
  if (input.aba === "fc") {
    await apiClient.post(`${base}/fc`, {
      etapa: "analisar",
      processo_id: input.processoId,
    });
    return {};
  }
  if (input.aba === "migra") {
    await apiClient.post(`${base}/seguro`, {
      etapa: "analisar",
      processo_id: input.processoId,
    });
    return {};
  }
  if (input.aba === "relatorio") {
    await apiClient.post(`${base}/relatorio`, {
      etapa: "gerar",
      processo_id: input.processoId,
    });
  }
  return {};
}
