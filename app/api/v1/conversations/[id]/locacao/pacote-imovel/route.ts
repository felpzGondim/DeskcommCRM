import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { processoAtivoDaConversa } from "@/lib/locacao/ficha-compartilhada";
import { FichaConflitoDeVersao, gravarVersaoDaFicha, lerFichaAtual } from "@/lib/locacao/ficha-repositorio";
import { completarFicha } from "@/lib/locacao/ficha-schema";
import { validarImovelNoSuperlogica } from "@/lib/locacao/pacote-do-imovel";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const corpo = z.object({
  id_imovel: z.number().int().positive().max(999_999_999_999).optional(),
}).strict();

export async function POST(req: NextRequest, ctx: Ctx) {
  const requestId = randomUUID();
  const suporte = await requireSupportWrite();
  if (suporte) return suporte;
  const { id } = await ctx.params;
  const auth = await requireRole("agent", { requestId, resource: "locacao" });
  if (!auth.ok) return auth.response;
  const parsed = corpo.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("validation_failed", "Pedido inválido.", 422, { requestId });

  const db = await createClient();
  const { data: conv } = await db.from("conversations").select("id,contact_id")
    .eq("organization_id", auth.org.orgId).eq("id", id).maybeSingle();
  if (!conv) return fail("not_found", "Conversa não encontrada.", 404, { requestId });

  const { data: org } = await db.from("organizations").select("settings")
    .eq("id", auth.org.orgId).maybeSingle();
  const admin = createAdminClient();
  const processo = await processoAtivoDaConversa(admin, auth.org.orgId, id).catch(() => null);
  const atual = await lerFichaAtual(admin, auth.org.orgId, id);
  const ficha = atual?.ficha ? completarFicha(atual.ficha) : null;
  const contactId = typeof conv.contact_id === "string" ? conv.contact_id : "";

  const r = await validarImovelNoSuperlogica({
    admin,
    orgId: auth.org.orgId,
    contactId,
    conversationId: id,
    settings: org?.settings ?? {},
    ficha,
    imovelId: processo && typeof processo.imovel_id === "string" ? processo.imovel_id : null,
    idImovel: parsed.data.id_imovel ?? null,
  });

  if (r.ficha && atual && r.ficha !== ficha && r.status === "ok") {
    try {
      await gravarVersaoDaFicha(admin, {
        organizationId: auth.org.orgId,
        conversationId: id,
        ficha: r.ficha,
        relatorio: atual.relatorio,
        origem: "atendente",
        baseVersao: atual.versao,
        alteradoPor: auth.user.id,
      });
    } catch (err) {
      if (!(err instanceof FichaConflitoDeVersao)) throw err;
    }
  }

  void audit({
    action: "locacao.imovel_superlogica_validado",
    organizationId: auth.org.orgId,
    actorUserId: auth.user.id,
    requestId,
    metadata: {
      conversation_id: id,
      processo_id: processo ? String(processo.id ?? "") : null,
      status: r.status,
      id_gravado: r.idGravado,
      tem_candidatos: r.candidatos.length > 0,
      tem_locador: !!r.locador,
    },
  });

  return ok({
    status: r.status,
    aviso: r.aviso,
    locador: r.locador,
    candidatos: r.candidatos,
    ha_mais: r.haMais,
    superlogica_imovel_id: r.superlogicaImovelId,
    ficha: r.ficha,
  }, { requestId });
}
