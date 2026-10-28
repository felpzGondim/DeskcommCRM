import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { gateLocacao } from "@/lib/locacao/api-gate";
import { caminhosAlterados } from "@/lib/locacao/ficha-diff";
import { fichaPreliminarSchema } from "@/lib/locacao/ficha-schema";
import { gravarFichaDoProcesso, lerProcesso, LocacaoErro } from "@/lib/locacao/repositorio";
import { tabelaLocacao } from "@/lib/locacao/admin";
import { ORIGENS_DA_FICHA_DO_PROCESSO } from "@/lib/locacao/vocabulario";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const corpo = z.object({
  ficha: fichaPreliminarSchema,
  base_versao: z.number().int().nonnegative(),
  origem: z.enum(ORIGENS_DA_FICHA_DO_PROCESSO).default("atendente"),
}).strict();

export async function GET(_req: NextRequest, ctx: Ctx) {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const g = await gateLocacao(requestId);
  if (!g.ok) return g.response;
  const processo = await lerProcesso(g.gate.admin, g.gate.orgId, id);
  if (!processo) return fail("not_found", g.gate.t("Processo não encontrado."), 404, { requestId });
  const { data: atual } = await tabelaLocacao(g.gate.admin, "locacao_processo_fichas")
    .select("versao,origem,ficha,campos_alterados,alterado_por,alterado_em")
    .eq("organization_id", g.gate.orgId).eq("processo_id", id)
    .order("versao", { ascending: false }).limit(1).maybeSingle();
  const { data: historico } = await tabelaLocacao(g.gate.admin, "locacao_processo_fichas")
    .select("versao,origem,campos_alterados,alterado_por,alterado_em")
    .eq("organization_id", g.gate.orgId).eq("processo_id", id)
    .order("versao", { ascending: false }).limit(50);
  return ok({ atual: atual ?? null, historico: historico ?? [] }, { requestId });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const requestId = randomUUID();
  const suporte = await requireSupportWrite();
  if (suporte) return suporte;
  const { id } = await ctx.params;
  const g = await gateLocacao(requestId);
  if (!g.ok) return g.response;
  const parsed = corpo.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", g.gate.t("Pedido inválido."), 422, { requestId });
  const processo = await lerProcesso(g.gate.admin, g.gate.orgId, id);
  if (!processo) return fail("not_found", g.gate.t("Processo não encontrado."), 404, { requestId });
  const { data: previa } = await tabelaLocacao(g.gate.admin, "locacao_processo_fichas")
    .select("ficha").eq("organization_id", g.gate.orgId).eq("processo_id", id)
    .order("versao", { ascending: false }).limit(1).maybeSingle();
  const fichaPrevia = (previa as { ficha?: unknown } | null)?.ficha;
  const campos = fichaPrevia
    ? caminhosAlterados(fichaPreliminarSchema.parse(fichaPrevia), parsed.data.ficha)
    : ["*"];
  try {
    const versao = await gravarFichaDoProcesso(g.gate.admin, {
      orgId: g.gate.orgId, processoId: id, userId: g.gate.user.id,
      ficha: parsed.data.ficha, origem: parsed.data.origem,
      baseVersao: parsed.data.base_versao, camposAlterados: campos,
    });
    void audit({
      action: "locacao.ficha_gravada",
      organizationId: g.gate.orgId, actorUserId: g.gate.user.id, requestId,
      metadata: { processo_id: id, versao, campos },
    });
    return ok({ versao }, { requestId });
  } catch (err) {
    if (err instanceof LocacaoErro && err.codigo === "ficha_conflito_de_versao") {
      return fail("invalid_state", g.gate.t("Outra pessoa alterou a ficha, recarregue."), 409, { requestId });
    }
    if (err instanceof LocacaoErro) return fail("invalid_state", g.gate.t("Não foi possível gravar a ficha."), 409, { requestId });
    throw err;
  }
}
