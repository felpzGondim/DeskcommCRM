/**
 * PUT/DELETE — classifica a sessão de canal na conta empresarial da org.
 * Menor superfície do cadastro de conexão: POST que cria o número NÃO classifica.
 * Cookie + admin da org. Nunca dsk_. Sem telefone no body.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import {
  revogarVinculoSessaoEmpresarial,
  vincularSessaoContaEmpresarial,
} from "@/lib/auth/delegacao-cadastro";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

const corpo = z.object({ conta_empresarial_id: z.uuid() }).strict();

export async function PUT(req: NextRequest, { params }: Context): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const auth = await requireRole("admin", {
    requestId,
    resource: "channel_sessions",
    allowPlatformAdmin: true,
  });
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) {
    return fail("validation_failed", "Canal inválido.", 422, { requestId });
  }
  const parsed = corpo.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", "Informe a conta empresarial.", 422, { requestId });
  }

  const r = await vincularSessaoContaEmpresarial(createAdminClient(), {
    organizationId: auth.org.orgId,
    sessionId: id,
    contaId: parsed.data.conta_empresarial_id,
  });
  if (!r.ok) {
    if (r.motivo === "conta_ausente" || r.motivo === "sessao_ausente") {
      return fail("not_found", "Não encontrado.", 404, { requestId });
    }
    return fail("internal_error", "Não foi possível gravar o vínculo.", 500, { requestId });
  }

  void audit({
    action: "delegacao.conta_empresarial_vinculada",
    actorUserId: auth.user.id,
    organizationId: auth.org.orgId,
    resourceType: "channel_session",
    resourceId: id,
    requestId,
    metadata: { conta_empresarial_id: parsed.data.conta_empresarial_id },
  });
  return ok({ channel_session_id: id, conta_empresarial_id: parsed.data.conta_empresarial_id }, {
    requestId,
  });
}

export async function DELETE(_req: NextRequest, { params }: Context): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const auth = await requireRole("admin", {
    requestId,
    resource: "channel_sessions",
    allowPlatformAdmin: true,
  });
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) {
    return fail("validation_failed", "Canal inválido.", 422, { requestId });
  }

  const r = await revogarVinculoSessaoEmpresarial(createAdminClient(), {
    organizationId: auth.org.orgId,
    sessionId: id,
  });
  if (!r.ok) {
    return fail("internal_error", "Não foi possível revogar o vínculo.", 500, { requestId });
  }

  void audit({
    action: "delegacao.conta_empresarial_revogada",
    actorUserId: auth.user.id,
    organizationId: auth.org.orgId,
    resourceType: "channel_session",
    resourceId: id,
    requestId,
  });
  return ok({ channel_session_id: id, revoked: true }, { requestId });
}
