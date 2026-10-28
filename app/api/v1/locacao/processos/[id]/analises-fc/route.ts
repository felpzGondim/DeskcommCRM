/**
 * POST /api/v1/locacao/processos/:id/analises-fc
 *
 * Abre o registro da análise FC. NÃO dispara passo pago. Fiador só entra se o
 * atendente pedir (o POST nomeia o participante). Reaproveita laudo de até 90
 * dias. Sem mensagem a contato.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { gateLocacao } from "@/lib/locacao/api-gate";
import { tabelaLocacao } from "@/lib/locacao/admin";
import {
  abrirAnaliseFc,
  fcEmAndamento,
  fcReaproveitavel,
  lerProcesso,
  LocacaoErro,
} from "@/lib/locacao/repositorio";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const corpo = z.object({
  participante_id: z.string().uuid(),
}).strict();

export async function GET(_req: NextRequest, ctx: Ctx) {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const g = await gateLocacao(requestId);
  if (!g.ok) return g.response;
  const processo = await lerProcesso(g.gate.admin, g.gate.orgId, id);
  if (!processo) return fail("not_found", g.gate.t("Processo não encontrado."), 404, { requestId });
  const { data } = await tabelaLocacao(g.gate.admin, "locacao_analises_fc")
    .select("id,participante_id,pedido_id,estado,reaproveitou_de,autorizado_em,concluida_em,ficha_versao")
    .eq("organization_id", g.gate.orgId).eq("processo_id", id)
    .order("created_at", { ascending: false }).limit(20);
  return ok({ analises: data ?? [] }, { requestId });
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
  const { data: part } = await tabelaLocacao(g.gate.admin, "locacao_processo_participantes")
    .select("id,papel,cpf_hash,removido_em")
    .eq("organization_id", g.gate.orgId).eq("processo_id", id)
    .eq("id", parsed.data.participante_id).maybeSingle();
  if (!part || (part as { removido_em: string | null }).removido_em) {
    return fail("not_found", g.gate.t("Participante não encontrado."), 404, { requestId });
  }
  const cpfHash = (part as { cpf_hash: string | null }).cpf_hash;
  if (cpfHash && await fcEmAndamento(g.gate.admin, g.gate.orgId, cpfHash)) {
    return fail("invalid_state", g.gate.t("Já há uma análise em andamento."), 409, { requestId });
  }
  const reuso = cpfHash
    ? await fcReaproveitavel(g.gate.admin, g.gate.orgId, cpfHash, 90)
    : null;
  try {
    const pedidoId = await abrirAnaliseFc(g.gate.admin, {
      orgId: g.gate.orgId, processoId: id, participanteId: parsed.data.participante_id,
      userId: g.gate.user.id, cpfHash,
      fichaVersao: Number(processo.ficha_versao_atual ?? 0) || null,
      reaproveitouDe: reuso ? String(reuso.id) : null,
    });
    void audit({
      action: "locacao.analise_fc_aberta",
      organizationId: g.gate.orgId, actorUserId: g.gate.user.id, requestId,
      metadata: {
        processo_id: id, participante_id: parsed.data.participante_id,
        reaproveitada: !!reuso, pedido_id: pedidoId,
      },
    });
    return ok({ pedido_id: pedidoId, reaproveitada: !!reuso }, { requestId });
  } catch (err) {
    if (err instanceof LocacaoErro) {
      return fail("invalid_state", g.gate.t("Não foi possível abrir a análise."), 409, { requestId });
    }
    throw err;
  }
}
