import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { analiseLigada, processosLigados } from "@/lib/locacao/chaves";
import { completarFicha } from "@/lib/locacao/ficha-schema";
import { lerFichaAtualDoProcesso, listarProcessosDaConversa } from "@/lib/locacao/repositorio";
import { tabelaLocacao } from "@/lib/locacao/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const auth = await requireRole("agent", { requestId, resource: "locacao", allowPlatformAdmin: "leitura" });
  if (!auth.ok) return auth.response;
  const db = await createClient();
  const { data: conv } = await db.from("conversations").select("id")
    .eq("organization_id", auth.org.orgId).eq("id", id).maybeSingle();
  if (!conv) return fail("not_found", "not_found", 404, { requestId });
  const { data: org } = await db.from("organizations").select("settings")
    .eq("id", auth.org.orgId).maybeSingle();
  const habilitado = processosLigados(org?.settings);
  const rendaLigada = analiseLigada(org?.settings, "renda");
  if (!habilitado) return ok({ habilitado: false, analise: { renda: false }, processos: [] }, { requestId });
  const admin = createAdminClient();
  const processos = await listarProcessosDaConversa(admin, auth.org.orgId, id);
  const imoveisIds = [...new Set(processos.map((p) => String(p.imovel_id ?? "")))].filter(Boolean);
  const rotulos = new Map<string, string>();
  if (imoveisIds.length > 0) {
    const { data } = await tabelaLocacao(admin, "locacao_imoveis")
      .select("id,logradouro,numero,complemento").eq("organization_id", auth.org.orgId).in("id", imoveisIds);
    for (const row of data ?? []) {
      const r = row as { id: string; logradouro: string; numero: string | null; complemento: string | null };
      rotulos.set(r.id, [r.logradouro, r.numero, r.complemento].filter(Boolean).join(", "));
    }
  }
  const fichas = await Promise.all(processos.slice(0, 5).map(async (p) => {
    const idProc = String(p.id ?? "");
    const linha = idProc ? await lerFichaAtualDoProcesso(admin, auth.org.orgId, idProc) : null;
    const ficha = linha?.ficha ? completarFicha(linha.ficha) : null;
    return {
      id: idProc,
      renda_mensal: ficha?.renda.mensal.valor ?? null,
      renda_proposta_fc: ficha?.renda.proposta_fc.valor ?? null,
      alertas: ficha?.renda.alertas ?? [],
    };
  }));
  const rendaPorId = new Map(fichas.map((f) => [f.id, f]));
  return ok({
    habilitado: true,
    analise: { renda: rendaLigada },
    processos: processos.map((p) => {
      const idProc = String(p.id ?? "");
      const extra = rendaPorId.get(idProc);
      return {
        id: p.id,
        status: p.status,
        imovel: rotulos.get(String(p.imovel_id ?? "")) ?? "",
        encerrado_em: p.encerrado_em ?? null,
        renda_confirmada_em: p.renda_confirmada_em ?? null,
        renda_mensal: extra?.renda_mensal ?? null,
        renda_proposta_fc: extra?.renda_proposta_fc ?? null,
        alertas: extra?.alertas ?? [],
      };
    }),
  }, { requestId });
}
