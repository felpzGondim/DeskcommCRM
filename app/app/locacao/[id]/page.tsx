import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { escreveComoPlatformAdmin } from "@/lib/auth/types";
import { ehAprovador, processosLigados } from "@/lib/locacao/chaves";
import { rotuloDoStatusDoProcesso } from "@/lib/locacao/status";
import { listarParticipantes, lerProcesso } from "@/lib/locacao/repositorio";
import { tabelaLocacao } from "@/lib/locacao/admin";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { CamposImovelProcessoDoProcesso } from "@/components/locacao/CamposImovelProcesso";
import { AcoesDoProcesso } from "./_acoes";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");
  const t = (s: string) => traduzir(s, user.idioma);
  const db = await createClient();
  const { data: row } = await db.from("organizations").select("settings").eq("id", org.orgId).maybeSingle();
  if (!processosLigados(row?.settings)) redirect("/app/locacao");
  const admin = createAdminClient();
  const processo = await lerProcesso(admin, org.orgId, id);
  if (!processo) notFound();
  const participantes = await listarParticipantes(admin, org.orgId, id);
  const { data: imovel } = await tabelaLocacao(admin, "locacao_imoveis")
    .select("logradouro,numero,complemento").eq("organization_id", org.orgId)
    .eq("id", String(processo.imovel_id ?? "")).maybeSingle();
  const rotulo = imovel
    ? [String((imovel as { logradouro: string }).logradouro),
      (imovel as { numero: string | null }).numero,
      (imovel as { complemento: string | null }).complemento].filter(Boolean).join(", ")
    : t("Imóvel");
  const podeAprovar = ehAprovador(user.id, escreveComoPlatformAdmin(user), row?.settings);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
      <Link className="text-sm text-primary underline" href="/app/locacao">{t("Voltar aos processos")}</Link>
      <h1 className="text-xl font-semibold">{t("Processo de locação")}</h1>
      <p className="text-sm">{rotulo}</p>
      <p className="text-sm">{t("Etapa")}: {rotuloDoStatusDoProcesso(String(processo.status), t)}</p>
      <CamposImovelProcessoDoProcesso processoId={id} />
      <h2 className="text-sm font-medium">{t("Pessoas")}</h2>
      <ul className="space-y-1 text-sm">
        {participantes.map((p) => (
          <li key={String(p.id)}>{String(p.papel)}{p.principal ? ` · ${t("principal")}` : ""}</li>
        ))}
      </ul>
      <AcoesDoProcesso
        processoId={id}
        status={String(processo.status)}
        podeAprovar={podeAprovar}
      />
      <Button asChild variant="outline" size="sm">
        <Link href={`/app/inbox`}>{t("Voltar à conversa")}</Link>
      </Button>
    </div>
  );
}
