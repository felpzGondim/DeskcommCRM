import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { gateLocacao } from "@/lib/locacao/api-gate";
import { lerProcesso, ligarConversa, LocacaoErro } from "@/lib/locacao/repositorio";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const corpo = z.object({ conversation_id: z.string().uuid() }).strict();

export async function POST(req: NextRequest, ctx: Ctx) {
  const requestId = randomUUID();
  const suporte = await requireSupportWrite();
  if (suporte) return suporte;
  const { id } = await ctx.params;
  const g = await gateLocacao(requestId);
  if (!g.ok) return g.response;
  const parsed = corpo.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", g.gate.t("Pedido inválido."), 422, { requestId });
  const processo = await lerProcesso(g.gate.admin, g.gate.orgId, id);
  if (!processo) return fail("not_found", g.gate.t("Processo não encontrado."), 404, { requestId });
  const { data: conv } = await g.gate.admin.from("conversations").select("id")
    .eq("organization_id", g.gate.orgId).eq("id", parsed.data.conversation_id).maybeSingle();
  if (!conv) return fail("not_found", g.gate.t("Conversa não encontrada."), 404, { requestId });
  try {
    await ligarConversa(g.gate.admin, {
      orgId: g.gate.orgId, processoId: id,
      conversationId: parsed.data.conversation_id, userId: g.gate.user.id,
    });
    void audit({
      action: "locacao.conversa_ligada",
      organizationId: g.gate.orgId, actorUserId: g.gate.user.id, requestId,
      metadata: { processo_id: id, conversation_id: parsed.data.conversation_id },
    });
    return ok({ ok: true }, { requestId });
  } catch (err) {
    if (err instanceof LocacaoErro) return fail("invalid_state", g.gate.t("Não foi possível ligar a conversa."), 409, { requestId });
    throw err;
  }
}
