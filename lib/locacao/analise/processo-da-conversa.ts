/**
 * Resolve o processo da conversa para a análise de renda.
 * Extraído para o iniciar e o worker usarem o mesmo critério.
 */
import { MOTIVOS_RENDA } from "@/lib/locacao/analise/motivos-renda";
import { lerProcesso, listarProcessosDaConversa } from "@/lib/locacao/repositorio";
import type { ContextoDaFerramenta, ResultadoDaFerramenta } from "@/lib/painel/ferramentas/tipos";

export async function processoDaConversa(
  ctx: Pick<ContextoDaFerramenta, "admin" | "orgId" | "conversationId">,
  processoId?: string,
): Promise<{ id: string } | ResultadoDaFerramenta> {
  if (processoId) {
    const linha = await lerProcesso(ctx.admin, ctx.orgId, processoId);
    if (!linha) return { ok: false, texto: MOTIVOS_RENDA.sem_processo, codigo: "validation_error" };
    return { id: processoId };
  }
  const lista = await listarProcessosDaConversa(ctx.admin, ctx.orgId, ctx.conversationId);
  const primeiro = lista[0];
  const id = typeof primeiro?.id === "string" ? primeiro.id : "";
  if (!id) return { ok: false, texto: MOTIVOS_RENDA.sem_processo, codigo: "validation_error" };
  return { id };
}
