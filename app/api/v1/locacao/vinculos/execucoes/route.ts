import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { gateLocacao, podeAprovarProcesso } from "@/lib/locacao/api-gate";
import { tabelaLocacao } from "@/lib/locacao/admin";
import { vinculoLigado } from "@/lib/locacao/chaves";
import { rodarVinculo } from "@/lib/superlogica/execucao";
import { fonteVazia } from "@/lib/superlogica/fonte";

export const dynamic = "force-dynamic";

const corpo = z.object({ modo: z.enum(["simulacao", "valendo"]) }).strict();

export async function GET() {
  const requestId = randomUUID();
  const g = await gateLocacao(requestId, { exigirProcessos: false });
  if (!g.ok) return g.response;
  const { data } = await tabelaLocacao(g.gate.admin, "superlogica_vinculo_execucoes")
    .select("id,modo,estado,iniciado_em,terminado_em,resumo,erro_codigo")
    .eq("organization_id", g.gate.orgId)
    .order("iniciado_em", { ascending: false }).limit(20);
  return ok({ habilitado: vinculoLigado(g.gate.settings), execucoes: data ?? [] }, { requestId });
}

export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const suporte = await requireSupportWrite();
  if (suporte) return suporte;
  const g = await gateLocacao(requestId, { exigirVinculo: true, exigirProcessos: false });
  if (!g.ok) return g.response;
  if (!podeAprovarProcesso(g.gate)) {
    return fail("forbidden_role", g.gate.t("Só quem aprova dispara a rodada."), 403, { requestId });
  }
  const parsed = corpo.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", g.gate.t("Pedido inválido."), 422, { requestId });
  if (parsed.data.modo === "valendo") {
    const corte = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: sim } = await tabelaLocacao(g.gate.admin, "superlogica_vinculo_execucoes")
      .select("id").eq("organization_id", g.gate.orgId).eq("modo", "simulacao")
      .eq("estado", "concluida").gte("terminado_em", corte).limit(1).maybeSingle();
    if (!sim) {
      return fail("invalid_state", g.gate.t("Rode uma simulação nos últimos 7 dias antes de valer."), 409, { requestId });
    }
  }
  try {
    const r = await rodarVinculo(g.gate.admin, {
      orgId: g.gate.orgId, userId: g.gate.user.id, modo: parsed.data.modo,
      settings: g.gate.settings, fonte: fonteVazia(),
    });
    void audit({
      action: parsed.data.modo === "simulacao" ? "locacao.vinculo_simulado" : "locacao.vinculo_executado",
      organizationId: g.gate.orgId, actorUserId: g.gate.user.id, requestId,
      metadata: { execucao_id: r.execucaoId, modo: parsed.data.modo, ...r.resumo },
    });
    return ok(r, { requestId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "erro";
    if (msg === "execucao_em_andamento") {
      return fail("invalid_state", g.gate.t("Já há uma rodada em andamento."), 409, { requestId });
    }
    return fail("internal_error", g.gate.t("A rodada falhou."), 500, { requestId });
  }
}
