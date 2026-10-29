import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { gateLocacao } from "@/lib/locacao/api-gate";
import { lerProcesso, LocacaoErro } from "@/lib/locacao/repositorio";
import {
  CAMPOS_DO_VALOR_DO_IMOVEL,
  valoresParaJson,
} from "@/lib/locacao/valores-imovel";
import {
  editarValoresDoProcesso,
  garantirValoresDoProcesso,
} from "@/lib/locacao/valores-imovel-persistencia";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const corpo = z.object({
  aluguel: z.number().finite().nonnegative().optional(),
  condominio: z.number().finite().nonnegative().optional(),
  iptu: z.number().finite().nonnegative().optional(),
  seguro_incendio: z.number().finite().nonnegative().optional(),
  seguro_fianca: z.number().finite().nonnegative().optional(),
}).strict();

export async function GET(_req: NextRequest, ctx: Ctx) {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const g = await gateLocacao(requestId);
  if (!g.ok) return g.response;
  const processo = await lerProcesso(g.gate.admin, g.gate.orgId, id);
  if (!processo) return fail("not_found", g.gate.t("Processo não encontrado."), 404, { requestId });
  const valores = await garantirValoresDoProcesso(g.gate.admin, {
    orgId: g.gate.orgId,
    processoId: id,
    settings: g.gate.settings,
  });
  return ok({ valores: valoresParaJson(valores) }, { requestId });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
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
  const patch: Partial<Record<(typeof CAMPOS_DO_VALOR_DO_IMOVEL)[number], number>> = {};
  for (const campo of CAMPOS_DO_VALOR_DO_IMOVEL) {
    const n = parsed.data[campo];
    if (typeof n === "number") patch[campo] = n;
  }
  try {
    const valores = await editarValoresDoProcesso(g.gate.admin, {
      orgId: g.gate.orgId,
      processoId: id,
      userId: g.gate.user.id,
      patch,
    });
    if (Object.keys(patch).length > 0) {
      void audit({
        action: "locacao.valores_imovel_editados",
        organizationId: g.gate.orgId,
        actorUserId: g.gate.user.id,
        requestId,
        metadata: { processo_id: id, campos: Object.keys(patch) },
      });
    }
    return ok({ valores: valoresParaJson(valores) }, { requestId });
  } catch (err) {
    if (err instanceof LocacaoErro) {
      return fail("invalid_state", g.gate.t("Não foi possível gravar os valores do imóvel."), 409, { requestId });
    }
    throw err;
  }
}
