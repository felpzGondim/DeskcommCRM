"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { audit } from "@/lib/audit";
import {
  CAMINHO_CONSENTIMENTO_OAUTH,
  executarDecisaoConsentimento,
  loginComVoltaAoConsentimento,
  authorizationIdValido,
} from "@/lib/auth/delegacao-oauth-consentimento";
import { ipDoCliente } from "@/lib/http/ip-do-cliente";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

export async function decidirConsentimentoOAuthForm(formData: FormData): Promise<void> {
  const authorizationId = formData.get("authorization_id");
  const decisao = formData.get("decisao");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const r = await executarDecisaoConsentimento(
    { authorizationId, decisao },
    {
      getUser: async () => (user ? { id: user.id } : null),
      approveAuthorization: (id, opts) => supabase.auth.oauth.approveAuthorization(id, opts),
      denyAuthorization: (id, opts) => supabase.auth.oauth.denyAuthorization(id, opts),
    },
  );

  const hdrs = await headers();
  const requestId = hdrs.get("x-request-id");
  const idParaLogin = authorizationIdValido(authorizationId);

  if (!r.ok) {
    logger.warn("oauth.consentimento_recusado", {
      motivo: r.motivo,
      requestId,
    });
    if (r.motivo === "sem_login") {
      redirect(loginComVoltaAoConsentimento(idParaLogin));
    }
    redirect(`${CAMINHO_CONSENTIMENTO_OAUTH}?erro=1`);
  }

  await audit({
    action: decisao === "aprovar" ? "oauth.consent_approved" : "oauth.consent_denied",
    actorUserId: user?.id ?? null,
    resourceType: "oauth_authorization",
    resourceId: r.authorizationId,
    requestId,
    ip: ipDoCliente(hdrs),
    userAgent: hdrs.get("user-agent") ?? null,
    metadata: {
      decisao: decisao === "aprovar" ? "aprovar" : "negar",
    },
  });

  redirect(r.redirectUrl);
}
