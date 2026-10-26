/**
 * POST /api/v1/conversations/:id/painel-agente — o painel do agente na coluna
 * direita da conversa (parte 1: resumir e sugerir resposta).
 *
 * · Visibilidade: a conversa, o contato e as mensagens são lidos pelo cliente
 *   de SESSÃO — quem decide o que o atendente enxerga é a RLS. Conversa que ele
 *   não vê ⇒ 404.
 * · Nada é gravado: o histórico do painel vive na tela (vai no body, curto) e
 *   some ao trocar de conversa. O custo fica em `llm_calls` com
 *   `purpose = 'painel_atendente'`; a auditoria (`api_audit_log`) leva SÓ a
 *   ação, nunca pergunta nem resposta (é append-only, fora da cascata LGPD).
 * · Contato anonimizado ⇒ 422 sem chamar o modelo.
 * · Teto: 10/min por pessoa, 40/min por organização (em memória sem Redis) +
 *   o orçamento da org (`ai_budgets`), que o seam aplica.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import {
  montarBlocoDaConversa,
  montarMensagensDoPainel,
  pedidoDaAcao,
  responderNoPainel,
  type FalaDaConversaDoPainel,
} from "@/lib/agent-engine/agent/painel-do-atendente";
import { requestTurnDeps } from "@/lib/agent-engine/agent/request-deps";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { motivoDaConversaDoCaso } from "@/lib/ai/conversa-do-caso/motivo";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const TETO_POR_USUARIO = 10;
const TETO_POR_ORGANIZACAO = 40;
const JANELA_SEGUNDOS = 60;
/** Quantas mensagens da conversa entram no contexto (as mais recentes). */
const JANELA_DE_MENSAGENS = 60;

const corpoDoPost = z
  .object({
    acao: z.enum(["resumir", "sugerir", "pergunta"]),
    pergunta: z.string().trim().max(1000).optional(),
    historico: z
      .array(
        z.object({ autor: z.enum(["atendente", "ia"]), texto: z.string().max(4000) }).strict(),
      )
      .max(12)
      .default([]),
  })
  .strict()
  .refine((b) => b.acao !== "pergunta" || (b.pergunta ?? "").length >= 3, {
    message: "pergunta obrigatória",
    path: ["pergunta"],
  });

export async function POST(req: NextRequest, ctx: Ctx) {
  const denied = await requireSupportWrite();
  if (denied) return denied;
  const requestId = randomUUID();
  const auth = await requireRole("agent", { requestId, resource: "conversations" });
  if (!auth.ok) return auth.response;
  const t = (texto: string) => traduzir(texto, auth.user.idioma);
  const orgId = auth.org.orgId;
  const { id } = await ctx.params;

  const parsed = corpoDoPost.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_error", t("Pedido inválido."), 400, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const { acao, pergunta, historico } = parsed.data;

  const porUsuario = await checkRateLimit(`painel-agente:${auth.user.id}`, TETO_POR_USUARIO, JANELA_SEGUNDOS);
  const porOrganizacao = await checkRateLimit(`painel-agente-org:${orgId}`, TETO_POR_ORGANIZACAO, JANELA_SEGUNDOS);
  if (!porUsuario.allowed || !porOrganizacao.allowed) {
    return fail("rate_limited", t("Muitos pedidos seguidos. Tente em um minuto."), 429, {
      requestId,
      headers: { "Retry-After": String(JANELA_SEGUNDOS) },
    });
  }

  const db = await createClient();
  const { data: conversa } = await db
    .from("conversations")
    .select("id,contact_id")
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (!conversa || !conversa.contact_id) {
    return fail("not_found", t("Conversa não encontrada."), 404, { requestId });
  }
  const contactId = conversa.contact_id as string;

  const { data: contato } = await db
    .from("contacts")
    .select("name,display_name,is_anonymized")
    .eq("organization_id", orgId)
    .eq("id", contactId)
    .maybeSingle();
  if (contato?.is_anonymized === true) {
    return fail(
      "reply_context_unavailable",
      t("Este contato foi anonimizado a pedido dele. A IA não lê esta conversa."),
      422,
      { requestId },
    );
  }

  const { data: linhas, error: erroMsgs } = await db
    .from("messages")
    .select("direction,body,media_derived_text,sent_at,revoked_at")
    .eq("organization_id", orgId)
    .eq("conversation_id", conversa.id)
    .order("sent_at", { ascending: false })
    .limit(JANELA_DE_MENSAGENS);
  if (erroMsgs) {
    logger.error("[painel-agente] falha ao ler mensagens", { requestId, organizationId: orgId });
    return fail("internal_error", t("Não foi possível ler a conversa."), 500, { requestId });
  }
  const falas: FalaDaConversaDoPainel[] = (linhas ?? [])
    .filter((m) => !m.revoked_at)
    .reverse()
    .map((m) => ({
      direcao: m.direction === "inbound" ? "inbound" : "outbound",
      texto: String(m.body ?? m.media_derived_text ?? ""),
      em: (m.sent_at as string | null) ?? null,
    }));
  if (falas.every((f) => f.texto.trim() === "")) {
    return fail("empty", t("Ainda não há mensagens de texto nesta conversa."), 422, { requestId });
  }

  const primeiroNome = (nomeDoContato(contato ?? null) ?? "cliente").trim().split(/\s+/)[0] ?? "cliente";
  const mensagens = montarMensagensDoPainel({
    blocoDaConversa: montarBlocoDaConversa(falas, primeiroNome),
    historico,
    pedido: pedidoDaAcao(acao, pergunta ?? null),
  });

  let erroCodigo: string | null = null;
  let resposta: Awaited<ReturnType<typeof responderNoPainel>> | null = null;
  let motivo: ReturnType<typeof motivoDaConversaDoCaso> | null = null;
  try {
    const deps = requestTurnDeps();
    resposta = await responderNoPainel(
      getRequestPool(),
      deps.llmCfg,
      { tenantId: orgId, contactId, mensagens },
      { registry: deps.registry, log: deps.log },
    );
  } catch (erro) {
    motivo = motivoDaConversaDoCaso(erro);
    erroCodigo = motivo.codigo;
    logger.error("[painel-agente] o modelo não respondeu", {
      requestId,
      organizationId: orgId,
      motivo: erroCodigo,
      erro: erro instanceof Error ? erro.message : String(erro),
    });
  }

  void audit({
    action: "ai.painel_atendente",
    actorUserId: auth.user.id,
    organizationId: orgId,
    resourceType: "conversation",
    resourceId: conversa.id,
    requestId,
    metadata: { acao, llm_call_id: resposta?.callId ?? null, respondeu: erroCodigo === null, error_code: erroCodigo },
  });

  if (motivo !== null || resposta === null) {
    const m = motivo ?? motivoDaConversaDoCaso(new Error("vazio"));
    return fail(m.codigo, t(m.texto), 422, { requestId });
  }
  return ok({ acao, resposta: resposta.texto }, { requestId });
}
