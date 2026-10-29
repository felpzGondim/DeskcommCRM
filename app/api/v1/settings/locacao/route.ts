/**
 * GET/PATCH /api/v1/settings/locacao — fatias locacao e superlogica_vinculo
 * de organizations.settings. Merge não destrutivo. Desligado por padrão.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import {
  lerLocacaoSettings,
  lerSuperlogicaVinculoSettings,
  locacaoAnalisePatchSchema,
  locacaoSettingsSchema,
  superlogicaVinculoSettingsSchema,
} from "@/lib/locacao/chaves";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const patch = z.object({
  locacao: locacaoSettingsSchema.omit({ analise: true }).partial().extend({
    analise: locacaoAnalisePatchSchema.optional(),
  }).optional(),
  superlogica_vinculo: superlogicaVinculoSettingsSchema.partial().optional(),
}).strict();

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "locacao_settings" });
  if (!authz.ok) return authz.response;
  const admin = createAdminClient();
  const { data, error } = await admin.from("organizations").select("settings")
    .eq("id", authz.org.orgId).maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });
  const settings = (data as { settings?: unknown } | null)?.settings;
  return ok({
    locacao: lerLocacaoSettings(settings),
    superlogica_vinculo: lerSuperlogicaVinculoSettings(settings),
  }, { requestId });
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const negado = await requireSupportWrite();
  if (negado) return negado;
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "locacao_settings" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const parsed = patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", t("Dados inválidos."), 422, { requestId });
  const admin = createAdminClient();
  const { data: atual, error: erroLeitura } = await admin.from("organizations")
    .select("settings").eq("id", authz.org.orgId).maybeSingle();
  if (erroLeitura) return fail("internal_error", erroLeitura.message, 500, { requestId });
  const settings = ((atual as { settings?: Record<string, unknown> } | null)?.settings ?? {}) as Record<string, unknown>;
  const locAtual = lerLocacaoSettings(settings);
  const locPatch = parsed.data.locacao ?? {};
  const locacao = {
    ...locAtual,
    ...locPatch,
    analise: { ...locAtual.analise, ...(locPatch.analise ?? {}) },
  };
  const vinculo = { ...lerSuperlogicaVinculoSettings(settings), ...(parsed.data.superlogica_vinculo ?? {}) };
  const { error } = await admin.from("organizations").update({
    settings: { ...settings, locacao, superlogica_vinculo: vinculo },
  }).eq("id", authz.org.orgId);
  if (error) return fail("internal_error", error.message, 500, { requestId });
  void audit({
    action: "locacao.config_alterada",
    actorUserId: authz.user.id, organizationId: authz.org.orgId, requestId,
    metadata: {
      processos: locacao.processos_habilitado === true,
      arquivos: locacao.arquivos_habilitado === true,
      drive: locacao.drive_habilitado === true,
      vinculo: vinculo.habilitado === true,
    },
  });
  return ok({ locacao, superlogica_vinculo: vinculo }, { requestId });
}
