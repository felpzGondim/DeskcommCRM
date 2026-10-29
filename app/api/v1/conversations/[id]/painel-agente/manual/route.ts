/**
 * POST /api/v1/conversations/:id/painel-agente/manual
 * Reserva quando o robô cai em erro ou login_necessario. Mesmo caminho do registro.
 * Nada vai ao cliente. Nenhum passo pago. CPF revelado só no clique, com auditoria.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { montarContexto } from "@/lib/painel/contexto";
import { executarFerramenta } from "@/lib/painel/ferramentas/executar";
import { respostaDaFerramenta } from "@/lib/painel/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const anexo = z.object({
  bytes_b64: z.string().min(1).max(2_800_000),
  mime: z.string().max(80).optional(),
}).strict();

const corpo = z.discriminatedUnion("etapa", [
  z.object({
    etapa: z.literal("preparar"),
    processo_id: z.string().uuid().optional(),
    pedido_id: z.string().uuid().optional(),
  }).strict(),
  z.object({
    etapa: z.literal("revelar_cpf"),
    processo_id: z.string().uuid().optional(),
    pedido_id: z.string().uuid().optional(),
  }).strict(),
  z.object({
    etapa: z.literal("registrar_fc"),
    processo_id: z.string().uuid().optional(),
    pedido_id: z.string().uuid().optional(),
    score: z.union([z.number().finite(), z.string().max(40)]).nullable().optional(),
    risco: z.string().max(40).nullable().optional(),
    id_fc: z.string().max(80).nullable().optional(),
    anexo: anexo.optional(),
  }).strict(),
  z.object({
    etapa: z.literal("registrar_seguro"),
    processo_id: z.string().uuid().optional(),
    pedido_id: z.string().uuid().optional(),
    cards: z.array(z.object({
      seguradora: z.string().max(80).optional(),
      codigo: z.string().max(80).optional(),
      codigo_cotacao: z.string().max(80).optional(),
      status: z.string().max(80).optional(),
      plano: z.string().max(120).optional(),
    }).strict()).max(20).optional(),
    anexo: anexo.optional(),
  }).strict(),
]);

export async function POST(req: NextRequest, ctx: Ctx) {
  const denied = await requireSupportWrite();
  if (denied) return denied;
  const requestId = randomUUID();
  const auth = await requireRole("agent", { requestId, resource: "conversations" });
  if (!auth.ok) return auth.response;
  const t = (s: string) => traduzir(s, auth.user.idioma);
  const orgId = auth.org.orgId;
  const { id } = await ctx.params;
  const parsed = corpo.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_error", t("Pedido inválido."), 400, { requestId });
  const pedido = parsed.data;

  const [pessoa, org] = await Promise.all([
    checkRateLimit(`painel-agente:${auth.user.id}`, 10, 60),
    checkRateLimit(`painel-agente-org:${orgId}`, 40, 60),
  ]);
  if (!pessoa.allowed || !org.allowed) {
    return fail("rate_limited", t("Muitos pedidos seguidos. Tente em um minuto."), 429, {
      requestId,
      headers: { "Retry-After": "60" },
    });
  }

  const db = await createClient();
  const { data: conversa } = await db
    .from("conversations")
    .select("id,contact_id")
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (!conversa?.contact_id)
    return fail("not_found", t("Conversa não encontrada."), 404, { requestId });
  const { data: contato } = await db
    .from("contacts")
    .select("id,is_anonymized")
    .eq("organization_id", orgId)
    .eq("id", conversa.contact_id)
    .maybeSingle();
  if (!contato || contato.is_anonymized) {
    return fail(
      "reply_context_unavailable",
      t("O contato desta conversa não está disponível."),
      422,
      { requestId },
    );
  }

  const { data: orgLinha } = await db
    .from("organizations")
    .select("settings")
    .eq("id", orgId)
    .maybeSingle();
  const contexto = montarContexto({
    orgId,
    conversationId: id,
    contactId: contato.id,
    userId: auth.user.id,
    requestId,
    dbSessao: db,
    admin: createAdminClient(),
    settings: orgLinha?.settings,
    idioma: auth.user.idioma,
    origem: "botao",
  });

  const ferramenta =
    pedido.etapa === "preparar" ? "preparar_manual"
      : pedido.etapa === "revelar_cpf" ? "revelar_cpf_manual"
        : pedido.etapa === "registrar_fc" ? "registrar_manual_fc"
          : "registrar_manual_seguro";
  const r = await executarFerramenta(ferramenta, contexto, {
    processo_id: pedido.processo_id,
    ...("pedido_id" in pedido ? { pedido_id: pedido.pedido_id } : {}),
    ...("score" in pedido ? { score: pedido.score, risco: pedido.risco, id_fc: pedido.id_fc } : {}),
    ...("cards" in pedido ? { cards: pedido.cards } : {}),
    ...("anexo" in pedido ? { anexo: pedido.anexo } : {}),
  });

  const efeito = pedido.etapa !== "preparar" && r.ok;
  if (efeito) {
    const action =
      pedido.etapa === "revelar_cpf" ? "locacao.cpf_revelado"
        : pedido.etapa === "registrar_fc" ? "locacao.analise_manual_fc"
          : "locacao.analise_manual_seguro";
    void audit({
      action,
      actorUserId: auth.user.id,
      organizationId: orgId,
      resourceType: "conversation",
      resourceId: id,
      requestId,
      metadata: {
        sucesso: r.ok,
        pedido_id: r.extra?.pedido_id ?? null,
        estado: r.extra?.estado ?? null,
        documento_id: r.extra?.documento_id ?? null,
        etapa: pedido.etapa,
      },
    });
  }

  return respostaDaFerramenta(r, t, requestId);
}
