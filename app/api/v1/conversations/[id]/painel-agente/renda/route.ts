/**
 * POST /api/v1/conversations/:id/painel-agente/renda
 * Analisar ou confirmar renda. Mesmo caminho do registro (executarFerramenta).
 * Nada vai ao cliente. Sem Hub.
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
      senhasPdf: z
        .array(
          z.object({
            nome: z.string().trim().min(1).max(120),
            senha: z.string().min(1).max(200),
          }),
        )
        .max(12)
        .optional(),
    })
    .strict(),
  z
    .object({
      etapa: z.literal("confirmar"),
      processo_id: z.string().uuid().optional(),
      renda_proposta_fc: z.number().finite().nonnegative().optional(),
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

  const registrar = (sucesso: boolean, extra: Record<string, unknown> = {}) =>
    void audit({
      action:
        pedido.etapa === "analisar" ? "ai.painel_atendente.renda" : "locacao.renda_confirmada",
      actorUserId: auth.user.id,
      organizationId: orgId,
      resourceType: "conversation",
      resourceId: id,
      requestId,
      metadata: { sucesso, ...extra },
    });

  if (pedido.etapa === "analisar") {
    const senhas = Object.fromEntries((pedido.senhasPdf ?? []).map((s) => [s.nome, s.senha]));
    const r = await executarFerramenta("analisar_renda", contexto, {
      processo_id: pedido.processo_id,
      participante_id: pedido.participante_id,
      senhas,
    });
    registrar(r.ok, r.ok ? { versao: r.extra?.versao, campos: ["renda"] } : {});
    return respostaDaFerramenta(r, t, requestId);
  }

  const r = await executarFerramenta("confirmar_renda", contexto, {
    processo_id: pedido.processo_id,
    renda_proposta_fc: pedido.renda_proposta_fc,
  });
  registrar(r.ok, r.ok ? { versao: r.extra?.versao, campos: ["renda"] } : {});
  return respostaDaFerramenta(r, t, requestId);
}
