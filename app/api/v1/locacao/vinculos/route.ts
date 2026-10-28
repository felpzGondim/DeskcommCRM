import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { gateLocacao } from "@/lib/locacao/api-gate";
import { desligarVinculo, ligarVinculoManual, LocacaoErro, vinculoDoContato } from "@/lib/locacao/repositorio";
import { MOTIVOS_DE_DESFAZER_VINCULO } from "@/lib/locacao/vocabulario";

export const dynamic = "force-dynamic";

const ligar = z.object({
  contact_id: z.string().uuid(),
  superlogica_pessoa_id: z.string().regex(/^\d+$/),
  tipos: z.array(z.enum(["locatario", "fiador", "proprietario"])).max(3).optional(),
}).strict();

const desligar = z.object({
  vinculo_id: z.string().uuid(),
  motivo: z.enum(MOTIVOS_DE_DESFAZER_VINCULO),
}).strict();

export async function GET(req: NextRequest) {
  const requestId = randomUUID();
  const g = await gateLocacao(requestId, { exigirProcessos: false });
  if (!g.ok) return g.response;
  const contactId = new URL(req.url).searchParams.get("contact_id");
  if (!contactId || !z.string().uuid().safeParse(contactId).success) {
    return fail("validation_failed", g.gate.t("Pedido inválido."), 422, { requestId });
  }
  const vinculo = await vinculoDoContato(g.gate.admin, g.gate.orgId, contactId);
  return ok({ vinculo }, { requestId });
}

export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const suporte = await requireSupportWrite();
  if (suporte) return suporte;
  const g = await gateLocacao(requestId, { exigirProcessos: false });
  if (!g.ok) return g.response;
  const parsed = ligar.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", g.gate.t("Pedido inválido."), 422, { requestId });
  const { data: c } = await g.gate.admin.from("contacts").select("id")
    .eq("organization_id", g.gate.orgId).eq("id", parsed.data.contact_id).maybeSingle();
  if (!c) return fail("not_found", g.gate.t("Contato não encontrado."), 404, { requestId });
  try {
    const id = await ligarVinculoManual(g.gate.admin, {
      orgId: g.gate.orgId, contactId: parsed.data.contact_id,
      pessoaId: parsed.data.superlogica_pessoa_id, userId: g.gate.user.id,
      tipos: parsed.data.tipos,
    });
    void audit({
      action: "contato.superlogica.ligar",
      organizationId: g.gate.orgId, actorUserId: g.gate.user.id, requestId,
      metadata: { contact_id: parsed.data.contact_id, vinculo_id: id },
    });
    return ok({ id }, { requestId });
  } catch (err) {
    if (err instanceof LocacaoErro && err.codigo === "vinculo_diferente") {
      return fail("invalid_state", g.gate.t("Este contato já tem outro vínculo. Nada foi sobrescrito."), 409, { requestId });
    }
    if (err instanceof LocacaoErro) return fail("invalid_state", g.gate.t("Não foi possível ligar."), 409, { requestId });
    throw err;
  }
}

export async function DELETE(req: NextRequest) {
  const requestId = randomUUID();
  const suporte = await requireSupportWrite();
  if (suporte) return suporte;
  const g = await gateLocacao(requestId, { exigirProcessos: false });
  if (!g.ok) return g.response;
  const parsed = desligar.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", g.gate.t("Pedido inválido."), 422, { requestId });
  try {
    await desligarVinculo(g.gate.admin, {
      orgId: g.gate.orgId, vinculoId: parsed.data.vinculo_id,
      userId: g.gate.user.id, motivo: parsed.data.motivo,
    });
    void audit({
      action: "contato.superlogica.desligar",
      organizationId: g.gate.orgId, actorUserId: g.gate.user.id, requestId,
      metadata: { vinculo_id: parsed.data.vinculo_id, motivo: parsed.data.motivo },
    });
    return ok({ ok: true }, { requestId });
  } catch (err) {
    if (err instanceof LocacaoErro) return fail("invalid_state", g.gate.t("Não foi possível desligar."), 409, { requestId });
    throw err;
  }
}
