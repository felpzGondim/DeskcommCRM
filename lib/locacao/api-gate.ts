/**
 * Porta comum das rotas /api/v1/locacao: papel, suporte, org da sessão e
 * chave liga/desliga. organization_id nunca vem do body.
 */
import type { NextResponse } from "next/server";

import { fail, type ApiError } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { escreveComoPlatformAdmin, type AuthUser, type ActiveOrg } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import {
  arquivosLigados,
  driveLigado,
  ehAprovador,
  processosLigados,
  vinculoLigado,
} from "@/lib/locacao/chaves";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type GateLocacao = {
  user: AuthUser;
  org: ActiveOrg;
  orgId: string;
  settings: unknown;
  admin: ReturnType<typeof createAdminClient>;
  t: (s: string) => string;
};

export async function gateLocacao(
  requestId: string,
  opts?: { exigirProcessos?: boolean; exigirVinculo?: boolean; exigirArquivos?: boolean },
): Promise<{ ok: true; gate: GateLocacao } | { ok: false; response: NextResponse<ApiError> }> {
  const auth = await requireRole("agent", { requestId, resource: "locacao" });
  if (!auth.ok) return { ok: false, response: auth.response };
  const db = await createClient();
  const { data: org } = await db.from("organizations").select("settings")
    .eq("id", auth.org.orgId).maybeSingle();
  const settings = org?.settings ?? {};
  const t = (s: string) => traduzir(s, auth.user.idioma);
  if (opts?.exigirProcessos !== false && !processosLigados(settings)) {
    return { ok: false, response: fail("forbidden", t("O processo de locação está desligado."), 403, { requestId }) };
  }
  if (opts?.exigirVinculo && !vinculoLigado(settings)) {
    return { ok: false, response: fail("forbidden", t("O vínculo com a Superlógica está desligado."), 403, { requestId }) };
  }
  if (opts?.exigirArquivos && !arquivosLigados(settings)) {
    return { ok: false, response: fail("forbidden", t("Os arquivos do processo estão desligados."), 403, { requestId }) };
  }
  return {
    ok: true,
    gate: {
      user: auth.user,
      org: auth.org,
      orgId: auth.org.orgId,
      settings,
      admin: createAdminClient(),
      t,
    },
  };
}

export function podeAprovarProcesso(gate: GateLocacao): boolean {
  return ehAprovador(gate.user.id, escreveComoPlatformAdmin(gate.user), gate.settings);
}

export function drivePodeCopiar(settings: unknown): boolean {
  return driveLigado(settings);
}
