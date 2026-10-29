import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { gateLocacao } from "@/lib/locacao/api-gate";
import {
  BuscaSuperlogicaErro,
  buscarPessoasNoHub,
  mascararNomeParcial,
  pesquisaDoPedido,
} from "@/lib/locacao/busca-superlogica";

export const dynamic = "force-dynamic";

const pedido = z.object({
  conversation_id: z.string().uuid(),
  pesquisa: z.string().trim().min(2).max(120).optional(),
  nome: z.string().trim().min(2).max(120).optional(),
  cpf: z.string().trim().max(14).optional(),
}).strict().refine((v) => pesquisaDoPedido(v).length >= 2, "pesquisa");

export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const suporte = await requireSupportWrite();
  if (suporte) return suporte;
  const g = await gateLocacao(requestId, { exigirProcessos: false });
  if (!g.ok) return g.response;
  const parsed = pedido.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", g.gate.t("Pedido inválido."), 422, { requestId });
  }
  const pesquisa = pesquisaDoPedido(parsed.data);
  const { data: conv } = await g.gate.admin.from("conversations")
    .select("id,contact_id")
    .eq("organization_id", g.gate.orgId)
    .eq("id", parsed.data.conversation_id)
    .maybeSingle();
  if (!conv?.contact_id) {
    return fail("not_found", g.gate.t("Conversa não encontrada."), 404, { requestId });
  }
  try {
    const r = await buscarPessoasNoHub(g.gate.admin, {
      orgId: g.gate.orgId,
      conversationId: parsed.data.conversation_id,
      contactId: conv.contact_id,
      pedido: { pesquisa },
    });
    return ok({
      resultado: r.status,
      encontrado: r.encontrado,
      status: r.status,
      candidatos: r.candidatos.map((c) => ({
        id: c.id,
        nome: mascararNomeParcial(c.nome),
        tipo: c.tipo,
        contrato: c.contrato,
        imovel: c.imovel,
      })),
      ha_mais: r.haMais,
    }, { requestId });
  } catch (err) {
    if (err instanceof BuscaSuperlogicaErro) {
      const status = err.codigo === "tool_unavailable" ? 422 : 502;
      return fail(err.codigo, g.gate.t(err.message), status, { requestId });
    }
    throw err;
  }
}
