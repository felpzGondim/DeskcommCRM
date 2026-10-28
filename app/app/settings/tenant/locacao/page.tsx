import { redirect } from "next/navigation";

import { PainelConfigLocacao } from "@/components/locacao/PainelConfigLocacao";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");
  if (ROLE_RANK[org.role] < ROLE_RANK.admin) redirect("/403");
  const t = (s: string) => traduzir(s, user.idioma);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t("Locação")}</h1>
        <p className="text-sm text-text-muted">
          {t("Chaves do processo de locação, do campo de pergunta do painel, vínculo Superlógica e arquivos. Tudo desligado por padrão.")}
        </p>
      </div>
      <PainelConfigLocacao />
    </div>
  );
}
