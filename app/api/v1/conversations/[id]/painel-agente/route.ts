/**
 * POST /api/v1/conversations/:id/painel-agente — o painel do agente na coluna
 * direita da conversa.
 *
 * · Visibilidade: a conversa, o contato e as mensagens são lidos pelo cliente
 *   de SESSÃO — quem decide o que o atendente enxerga é a RLS. Conversa que ele
 *   não vê ⇒ 404.
 * · Resumir/sugerir e o campo /pergunta com a chave ligada passam por
 *   `executarFerramenta` — a mesma entrada dos botões.
 * · Nada vai ao cliente. A auditoria leva SÓ a ação, nunca pergunta nem resposta.
 * · Contato anonimizado ⇒ 422 sem chamar o modelo.
 * · Teto: 10/min por pessoa, 40/min por organização + o orçamento da org.
 *
 * GET ?consulta_id= — andamento da pergunta em curso (polling). `interrompida`
 * é calculada na leitura (CHECK do banco só aceita rodando/pronto/erro).
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
import { ferramentasDoPainelLigadas } from "@/lib/painel/chave";
import { montarContexto } from "@/lib/painel/contexto";
import {
  abrirConsulta,
  atualizarEtapa,
  fecharConsulta,
  lerAndamento,
  type AndamentoDaConsulta,
} from "@/lib/painel/consulta";
import { depoisDaResposta } from "@/lib/painel/depois-da-resposta";
import { executarFerramenta } from "@/lib/painel/ferramentas/executar";
import { modoDaPergunta, responderComFerramentas } from "@/lib/painel/ferramentas/loop";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const TETO_POR_USUARIO = 10;
const TETO_POR_ORGANIZACAO = 40;
const JANELA_SEGUNDOS = 60;
const JANELA_DE_MENSAGENS = 60;

const corpoDoPost = z
  .object({
    acao: z.enum(["resumir", "sugerir", "pergunta"]),
    pergunta: z.string().trim().max(1000).optional(),
    consulta_id: z.string().uuid().optional(),
    modo: z.enum(["normal", "analise"]).optional(),
    historico: z
      .array(z.object({ autor: z.enum(["atendente", "ia"]), texto: z.string().max(4000) }).strict())
      .max(12)
      .default([]),
  })
  .strict()
  .refine((b) => b.acao !== "pergunta" || (b.pergunta ?? "").length >= 3, {
    message: "pergunta obrigatória",
    path: ["pergunta"],
  });

export async function GET(req: NextRequest, ctx: Ctx) {
  const requestId = randomUUID();
  const auth = await requireRole("agent", { requestId, resource: "conversations" });
  if (!auth.ok) return auth.response;
  const t = (texto: string) => traduzir(texto, auth.user.idioma);
  const { id } = await ctx.params;
  const consultaId = new URL(req.url).searchParams.get("consulta_id");
  if (!consultaId || !z.string().uuid().safeParse(consultaId).success) {
    return fail("validation_error", t("Pedido inválido."), 400, { requestId });
  }
  const db = await createClient();
  const andamento = await lerAndamento(db, auth.org.orgId, consultaId, id);
  if (!andamento) return fail("not_found", t("Consulta não encontrada."), 404, { requestId });
  return ok(payloadDoAndamento(andamento), { requestId });
}

function payloadDoAndamento(andamento: AndamentoDaConsulta) {
  return {
    etapa: andamento.etapa,
    status: andamento.status,
    resposta: andamento.resposta,
    propostas: andamento.propostas,
    parou_por: andamento.parou_por,
    modo: andamento.modo,
  };
}

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
  const {
    acao,
    pergunta,
    historico,
    consulta_id: consultaDoCliente,
    modo: modoForcado,
  } = parsed.data;

  const porUsuario = await checkRateLimit(
    `painel-agente:${auth.user.id}`,
    TETO_POR_USUARIO,
    JANELA_SEGUNDOS,
  );
  const porOrganizacao = await checkRateLimit(
    `painel-agente-org:${orgId}`,
    TETO_POR_ORGANIZACAO,
    JANELA_SEGUNDOS,
  );
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
    .select("name,display_name,is_anonymized,phone_number")
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

  const { data: orgLinha } = await db
    .from("organizations")
    .select("settings")
    .eq("id", orgId)
    .maybeSingle();
  const admin = createAdminClient();
  const contexto = montarContexto({
    orgId,
    conversationId: conversa.id,
    contactId,
    userId: auth.user.id,
    requestId,
    dbSessao: db,
    admin,
    settings: orgLinha?.settings,
    idioma: auth.user.idioma,
    phoneNumber: contato?.phone_number,
    origem: "botao",
  });

  if (acao === "resumir" || acao === "sugerir") {
    const nome = acao === "resumir" ? "resumir_conversa" : "sugerir_resposta";
    let r;
    try {
      r = await executarFerramenta(
        nome,
        contexto,
        acao === "sugerir" ? { orientacao: pergunta } : {},
      );
    } catch (erro) {
      const motivo = motivoDaConversaDoCaso(erro);
      logger.error("[painel-agente] o modelo não respondeu", {
        requestId,
        organizationId: orgId,
        motivo: motivo.codigo,
      });
      void audit({
        action: "ai.painel_atendente",
        actorUserId: auth.user.id,
        organizationId: orgId,
        resourceType: "conversation",
        resourceId: conversa.id,
        requestId,
        metadata: { acao, llm_call_id: null, respondeu: false, error_code: motivo.codigo },
      });
      return fail(motivo.codigo, t(motivo.texto), 422, { requestId });
    }
    if (!r.ok) {
      return fail("empty", t(r.texto), 422, { requestId });
    }
    void audit({
      action: "ai.painel_atendente",
      actorUserId: auth.user.id,
      organizationId: orgId,
      resourceType: "conversation",
      resourceId: conversa.id,
      requestId,
      metadata: { acao, llm_call_id: r.extra?.callId ?? null, respondeu: true, error_code: null },
    });
    return ok({ acao, resposta: r.texto }, { requestId });
  }

  const comFerramentas = ferramentasDoPainelLigadas(orgLinha?.settings);
  if (comFerramentas) {
    const consultaId = consultaDoCliente ?? randomUUID();
    const existente = await lerAndamento(admin, orgId, consultaId, conversa.id);
    if (existente) {
      const payload = {
        acao,
        consulta_id: consultaId,
        sugestao: true,
        ...payloadDoAndamento(existente),
      };
      if (existente.status === "rodando") {
        return ok(payload, { status: 202, requestId });
      }
      return ok(payload, { requestId });
    }
    const modo = modoForcado ?? modoDaPergunta(pergunta ?? "", historico);
    const estado = await abrirConsulta(admin, {
      id: consultaId,
      orgId,
      conversationId: conversa.id,
      contactId,
      userId: auth.user.id,
      pergunta: pergunta ?? "",
      modo,
    });
    if (estado === "existente") {
      const deNovo = await lerAndamento(admin, orgId, consultaId, conversa.id);
      if (deNovo) {
        const payload = {
          acao,
          consulta_id: consultaId,
          sugestao: true,
          ...payloadDoAndamento(deNovo),
        };
        return ok(payload, { status: deNovo.status === "rodando" ? 202 : 200, requestId });
      }
    }
    // after() não tem cookies: o client de sessão já foi criado acima; o
    // trabalho usa service role filtrado por organization_id da sessão.
    const ctxDepois = { ...contexto, dbSessao: admin, origem: "agente" as const };
    ctxDepois.onAndamento = (etapa) => atualizarEtapa(admin, orgId, consultaId, etapa);
    const perguntaTexto = pergunta ?? "";
    depoisDaResposta(async () => {
      const t0 = Date.now();
      try {
        const r = await responderComFerramentas(ctxDepois, {
          pergunta: perguntaTexto,
          historico,
          modo,
        });
        await fecharConsulta(admin, {
          id: consultaId,
          orgId,
          resposta: r.texto,
          passos: r.passos,
          propostas: r.propostas,
          tokensEntrada: r.tokensEntrada,
          tokensSaida: r.tokensSaida,
          custoUsd: r.custoUsd,
          duracaoMs: Date.now() - t0,
          parouPor: r.parouPor,
          llmCallIds: r.callId ? [r.callId] : [],
          modo: r.modo,
        });
        void audit({
          action: "ai.painel_atendente",
          actorUserId: auth.user.id,
          organizationId: orgId,
          resourceType: "conversation",
          resourceId: conversa.id,
          requestId,
          metadata: {
            acao,
            llm_call_id: r.callId,
            respondeu: true,
            error_code: null,
            parou_por: r.parouPor,
            consulta_id: consultaId,
          },
        });
      } catch (erro) {
        const motivo = motivoDaConversaDoCaso(erro);
        await fecharConsulta(admin, {
          id: consultaId,
          orgId,
          resposta: "",
          passos: [],
          propostas: [],
          tokensEntrada: 0,
          tokensSaida: 0,
          custoUsd: 0,
          duracaoMs: Date.now() - t0,
          parouPor: "fim",
          llmCallIds: [],
          modo,
          status: "erro",
        });
        logger.error("[painel-agente] o modelo não respondeu", {
          requestId,
          organizationId: orgId,
          motivo: motivo.codigo,
        });
        void audit({
          action: "ai.painel_atendente",
          actorUserId: auth.user.id,
          organizationId: orgId,
          resourceType: "conversation",
          resourceId: conversa.id,
          requestId,
          metadata: {
            acao,
            llm_call_id: null,
            respondeu: false,
            error_code: motivo.codigo,
            consulta_id: consultaId,
          },
        });
      }
    });
    return ok(
      {
        acao,
        consulta_id: consultaId,
        status: "rodando" as const,
        etapa: "gerando resumo…",
        sugestao: true,
      },
      { status: 202, requestId },
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

  const primeiroNome =
    (nomeDoContato(contato ?? null) ?? "cliente").trim().split(/\s+/)[0] ?? "cliente";
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
    });
  }

  void audit({
    action: "ai.painel_atendente",
    actorUserId: auth.user.id,
    organizationId: orgId,
    resourceType: "conversation",
    resourceId: conversa.id,
    requestId,
    metadata: {
      acao,
      llm_call_id: resposta?.callId ?? null,
      respondeu: erroCodigo === null,
      error_code: erroCodigo,
    },
  });

  if (motivo !== null || resposta === null) {
    const m = motivo ?? motivoDaConversaDoCaso(new Error("vazio"));
    return fail(m.codigo, t(m.texto), 422, { requestId });
  }
  return ok({ acao, resposta: resposta.texto, sugestao: true }, { requestId });
}
