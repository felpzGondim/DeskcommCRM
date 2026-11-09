import Link from "next/link";
import { redirect } from "next/navigation";

import { decidirConsentimentoOAuthForm } from "@/app/actions/auth/decidirConsentimentoOAuth";
import { Button } from "@/components/ui/button";
import {
  carregarDetalhesConsentimento,
  loginComVoltaAoConsentimento,
} from "@/lib/auth/delegacao-oauth-consentimento";
import { idiomaDoVisitante } from "@/lib/i18n/idiomaAnonimo";
import { traduzir } from "@/lib/i18n/dicionario";
import { tituloDaTelaPublica } from "@/lib/i18n/titulo-da-tela-publica";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const generateMetadata = () => tituloDaTelaPublica((t) => t("Autorizar acesso"));

export default async function ConsentimentoOAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string; erro?: string }>;
}) {
  const { authorization_id: authorizationId, erro } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const idioma = await idiomaDoVisitante(
    (user?.user_metadata?.locale as string | undefined) ?? null,
  );
  const t = (texto: string) => traduzir(texto, idioma);

  const r = await carregarDetalhesConsentimento(authorizationId, {
    getUser: async () => (user ? { id: user.id } : null),
    getAuthorizationDetails: (id) => supabase.auth.oauth.getAuthorizationDetails(id),
  });

  if (!r.ok && r.motivo === "sem_login") {
    redirect(loginComVoltaAoConsentimento(authorizationId ?? null));
  }

  if (!r.ok || erro === "1") {
    return (
      <div className="space-y-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t("Autorizar acesso")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Este pedido de autorização não é válido ou já expirou.")}
        </p>
        <Link
          href="/login"
          className="text-sm font-medium text-foreground underline underline-offset-4"
        >
          {t("Voltar ao início")}
        </Link>
      </div>
    );
  }

  if ("redirectUrl" in r) {
    redirect(r.redirectUrl);
  }

  const { detalhes } = r;

  return (
    <div className="space-y-6">
      <div className="space-y-1.5 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t("Autorizar acesso")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Este aplicativo pede permissão para ler conversas da sua conta empresarial.")}
        </p>
      </div>
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-muted-foreground">{t("Aplicativo")}</dt>
          <dd className="font-medium" data-testid="oauth-consent-client">
            {detalhes.client.name}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("Quem autoriza")}</dt>
          <dd className="font-medium" data-testid="oauth-consent-usuario">
            {detalhes.usuario.email}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("Permissões pedidas")}</dt>
          <dd>
            <ul className="list-disc space-y-1 pl-5" data-testid="oauth-consent-escopos">
              {detalhes.escopos.map((escopo) => (
                <li key={escopo}>{rotuloNaTela(escopo, t)}</li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>
      <form action={decidirConsentimentoOAuthForm} className="flex flex-col gap-2">
        <input type="hidden" name="authorization_id" value={detalhes.authorizationId} />
        <Button type="submit" name="decisao" value="aprovar" className="w-full">
          {t("Permitir")}
        </Button>
        <Button type="submit" name="decisao" value="negar" variant="secondary" className="w-full">
          {t("Recusar")}
        </Button>
      </form>
    </div>
  );
}

function rotuloNaTela(escopo: string, t: (texto: string) => string): string {
  if (escopo === "buscar") return t("Listar conversas da conta empresarial");
  if (escopo === "ler") return t("Ler conversas da conta empresarial");
  if (escopo === "baixar") return t("Baixar anexos da conta empresarial");
  return escopo;
}
