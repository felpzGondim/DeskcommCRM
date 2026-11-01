/**
 * POST /api/v1/conversations/:id/painel-agente/renda
 * Analisar só enfileira (202 + execucao_id). Confirmar continua síncrono.
 * GET consulta o andamento. Nada vai ao cliente. Sem Hub.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { processoDaConversa } from "@/lib/locacao/analise/processo-da-conversa";
import { publicoDaExecucaoDeRenda } from "@/lib/locacao/analise/publico-renda";
import { lerExecucao, lerUltimaExecucaoPorAba } from "@/lib/locacao/execucoes";
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
    registrar(r.ok, r.ok ? { execucao_id: r.extra?.execucao_id, campos: ["renda"] } : {});
    if (!r.ok) return respostaDaFerramenta(r, t, requestId);
    return ok(
      {
        resumo: r.texto,
        execucao_id: r.extra?.execucao_id,
        estado: r.extra?.estado ?? "na_fila",
        etapa_texto: r.extra?.etapa_texto ?? "na fila",
        entrada_hash: r.extra?.entrada_hash,
        reusada: r.extra?.reusada === true,
      },
      { status: 202, requestId },
    );
  }

  const r = await executarFerramenta("confirmar_renda", contexto, {
    processo_id: pedido.processo_id,
    renda_proposta_fc: pedido.renda_proposta_fc,
  });
  registrar(r.ok, r.ok ? { versao: r.extra?.versao, campos: ["renda"] } : {});
  return respostaDaFerramenta(r, t, requestId);
}

const consulta = z
  .object({
    execucao_id: z.string().uuid().optional(),
    processo_id: z.string().uuid().optional(),
  })
  .strict();

export async function GET(req: NextRequest, ctx: Ctx) {
  const requestId = randomUUID();
  const auth = await requireRole("agent", { requestId, resource: "conversations" });
  if (!auth.ok) return auth.response;
  const t = (s: string) => traduzir(s, auth.user.idioma);
  const orgId = auth.org.orgId;
  const { id } = await ctx.params;
  const parsed = consulta.safeParse({
    execucao_id: req.nextUrl.searchParams.get("execucao_id") ?? undefined,
    processo_id: req.nextUrl.searchParams.get("processo_id") ?? undefined,
  });
  if (!parsed.success) return fail("validation_error", t("Pedido inválido."), 400, { requestId });

  const db = await createClient();
  const { data: conversa } = await db
    .from("conversations")
    .select("id,contact_id")
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (!conversa?.contact_id)
    return fail("not_found", t("Conversa não encontrada."), 404, { requestId });

  const admin = createAdminClient();
  if (parsed.data.execucao_id) {
    const row = await lerExecucao(admin, orgId, parsed.data.execucao_id);
    if (!row || row.aba !== "renda") {
      return fail("not_found", t("Execução não encontrada."), 404, { requestId });
    }
    const conv =
      row.resultado && typeof row.resultado === "object" && !Array.isArray(row.resultado)
        ? (row.resultado as Record<string, unknown>).conversation_id
        : null;
    if (typeof conv === "string" && conv !== id) {
      return fail("not_found", t("Execução não encontrada."), 404, { requestId });
    }
    return ok(publicoDaExecucaoDeRenda(row), { requestId });
  }

  const alvo = await processoDaConversa(
    { admin, orgId, conversationId: id },
    parsed.data.processo_id,
  );
  if ("ok" in alvo) return fail("not_found", t(alvo.texto), 404, { requestId });
  const row = await lerUltimaExecucaoPorAba(admin, orgId, alvo.id, "renda");
  if (!row) return fail("not_found", t("Nenhuma análise de renda nesta conversa."), 404, { requestId });
  return ok(publicoDaExecucaoDeRenda(row), { requestId });
}
