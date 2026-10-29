/**
 * POST /api/v1/conversations/:id/painel-agente/fc
 * Salvar, acompanhar ou confirmar a cobrança da FC Score+. Mesmo caminho do registro.
 * Nada vai ao cliente. Agente nunca confirma a cobrança.
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

const corpo = z.discriminatedUnion("etapa", [
  z
    .object({
      etapa: z.literal("analisar"),
      processo_id: z.string().uuid().optional(),
      participante_id: z.string().uuid().optional(),
    })
    .strict(),
  z
    .object({
      etapa: z.literal("status"),
      processo_id: z.string().uuid().optional(),
      pedido_id: z.string().uuid().optional(),
      participante_id: z.string().uuid().optional(),
    })
    .strict(),
  z
    .object({
      etapa: z.literal("confirmar"),
      processo_id: z.string().uuid().optional(),
      pedido_id: z.string().uuid().optional(),
    })
    .strict(),
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
    pedido.etapa === "analisar"
      ? "analisar_fc"
      : pedido.etapa === "confirmar"
        ? "confirmar_cobranca_fc"
        : "status_fc";
  const r = await executarFerramenta(ferramenta, contexto, {
    processo_id: pedido.processo_id,
    ...("pedido_id" in pedido ? { pedido_id: pedido.pedido_id } : {}),
    ...("participante_id" in pedido ? { participante_id: pedido.participante_id } : {}),
  });

  const efeito =
    pedido.etapa === "analisar"
    || pedido.etapa === "confirmar"
    || (r.ok && (r.extra?.documento_id || r.extra?.estado === "concluida" || r.extra?.estado === "reaproveitada"));
  if (efeito) {
    void audit({
      action: pedido.etapa === "confirmar" ? "locacao.analise_fc_cobrada" : "locacao.analise_fc_aberta",
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
        reaproveitada: r.extra?.reaproveitada === true,
        cobranca: r.extra?.cobranca ?? null,
      },
    });
  }

  return respostaDaFerramenta(r, t, requestId);
}
