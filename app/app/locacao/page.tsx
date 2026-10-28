import Link from "next/link";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { processosLigados } from "@/lib/locacao/chaves";
import { tabelaLocacao } from "@/lib/locacao/admin";
import { rotuloDoStatusDoProcesso } from "@/lib/locacao/status";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");
  const t = (s: string) => traduzir(s, user.idioma);
  const db = await createClient();
  const { data: row } = await db.from("organizations").select("settings").eq("id", org.orgId).maybeSingle();
  if (!processosLigados(row?.settings)) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
        <h1 className="text-xl font-semibold">{t("Processo de locação")}</h1>
        <p className="text-sm text-text-muted">{t("O processo de locação está desligado.")}</p>
        <Link className="text-sm text-primary underline" href="/app/settings/tenant/locacao">
          {t("Abrir as chaves de locação")}
        </Link>
      </div>
    );
  }
  const admin = createAdminClient();
  const { data } = await tabelaLocacao(admin, "locacao_processos")
    .select("id,status,encerrado_em,status_mudou_em")
    .eq("organization_id", org.orgId)
    .order("status_mudou_em", { ascending: false })
    .limit(100);
  const processos = (data ?? []) as Array<{ id: string; status: string; encerrado_em: string | null }>;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold">{t("Processo de locação")}</h1>
      {processos.length === 0 ? (
        <p className="text-sm text-text-muted">{t("Nenhum processo ainda. Abra um a partir da conversa.")}</p>
      ) : (
        <ul className="space-y-2">
          {processos.map((p) => (
            <li key={p.id}>
              <Link className="text-sm text-primary underline" href={`/app/locacao/${p.id}`}>
                {rotuloDoStatusDoProcesso(p.status, t)} · {p.id.slice(0, 8)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
