/**
 * Botões da casca do modal: chamam as rotas que já existem.
 * Sem cliente MCP do Hub. Sem dado pessoal.
 *
 * PONTO DE LIGAÇÃO — renda assíncrona (PR 2): hoje o POST de renda é síncrono.
 * Quando o runner gravar `locacao_execucoes` e devolver 202 com `execucao_id`,
 * troque só este arquivo; a casca já lê o status.
 */
import { apiClient } from "@/lib/api/client";
import { PONTO_RENDA_ASSINCRONA } from "@/lib/locacao/execucao-da-aba";
import type { AbaDaExecucao } from "@/lib/locacao/vocabulario";

export { PONTO_RENDA_ASSINCRONA };

export async function rodarAbaDoModal(input: {
  conversationId: string;
  aba: AbaDaExecucao;
  processoId: string;
  senhasPdf?: Array<{ nome: string; senha: string }>;
}): Promise<void> {
  const base = `/api/v1/conversations/${input.conversationId}/painel-agente`;
  if (input.aba === "renda") {
    await apiClient.post(`${base}/renda`, {
      etapa: "analisar",
      processo_id: input.processoId,
      senhasPdf: input.senhasPdf?.length ? input.senhasPdf : undefined,
    });
    return;
  }
  if (input.aba === "fc") {
    await apiClient.post(`${base}/fc`, {
      etapa: "analisar",
      processo_id: input.processoId,
    });
    return;
  }
  if (input.aba === "migra") {
    await apiClient.post(`${base}/seguro`, {
      etapa: "analisar",
      processo_id: input.processoId,
    });
    return;
  }
  if (input.aba === "relatorio") {
    await apiClient.post(`${base}/relatorio`, {
      etapa: "gerar",
      processo_id: input.processoId,
    });
  }
}
