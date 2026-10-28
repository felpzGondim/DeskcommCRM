import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { dadosContratoSchema, ErroApiContrato } from "@/lib/agent-engine/agent/painel-contrato";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import { FalhaDoContrato } from "@/lib/painel/acoes/contrato";
import { montarContexto } from "@/lib/painel/contexto";
import { executarFerramenta } from "@/lib/painel/ferramentas/executar";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const corpoSchema = z.discriminatedUnion("etapa", [
  z.object({ etapa: z.literal("preparar"), dados: dadosContratoSchema }).strict(),
  z.object({ etapa: z.literal("confirmar"), token: z.string().min(1).max(2000), confirmado: z.literal(true) }).strict(),
]);

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireSupportWrite();
  if (denied) return denied;
  const requestId = randomUUID();
  const auth = await requireRole("agent", { requestId, resource: "conversations" });
  if (!auth.ok) return auth.response;
  const t = (s: string) => traduzir(s, auth.user.idioma);
  const pedido = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!pedido.success) return fail("validation_error", t("Confira os dados da locação antes de continuar."), 400, { requestId });
  const { id } = await ctx.params;
  const orgId = auth.org.orgId;
  const limites = await Promise.all([
    checkRateLimit(`painel-agente:${auth.user.id}`, 10, 60),
    checkRateLimit(`painel-agente-org:${orgId}`, 40, 60),
  ]);
  if (limites.some((l) => !l.allowed)) return fail("rate_limited", t("Muitos pedidos seguidos. Tente em um minuto."), 429,
    { requestId, headers: { "Retry-After": "60" } });
  const db = await createClient();
  const { data: conversa } = await db.from("conversations").select("contact_id")
    .eq("organization_id", orgId).eq("id", id).maybeSingle();
  if (!conversa?.contact_id) return fail("not_found", t("Conversa não encontrada."), 404, { requestId });
  const { data: contato } = await db.from("contacts").select("id,is_anonymized")
    .eq("organization_id", orgId).eq("id", conversa.contact_id).maybeSingle();
  if (!contato || contato.is_anonymized) return fail("reply_context_unavailable", t("O contato não está disponível para esta ação."), 422, { requestId });

  const registrar = (sucesso: boolean) => void audit({
    action: pedido.data.etapa === "preparar" ? "ai.painel_atendente.contrato_preparado" : "ai.painel_atendente.contrato_confirmado",
    actorUserId: auth.user.id, organizationId: orgId, resourceType: "conversation", resourceId: id,
    requestId, metadata: { sucesso },
  });
  const { data: orgLinha } = await db.from("organizations").select("settings").eq("id", orgId).maybeSingle();
  const contexto = montarContexto({
    orgId, conversationId: id, contactId: contato.id, userId: auth.user.id, requestId,
    dbSessao: db, admin: createAdminClient(), settings: orgLinha?.settings,
    idioma: auth.user.idioma, origem: "botao",
  });
  try {
    if (pedido.data.etapa === "preparar") {
      const r = await executarFerramenta("preparar_contrato", contexto, pedido.data.dados);
      registrar(r.ok);
      return ok({
        resumo: r.texto,
        pendencias: r.extra?.pendencias ?? [],
        avisos: r.extra?.avisos ?? [],
        token: r.extra?.token ?? r.previaToken ?? null,
      }, { requestId });
    }
    const r = await executarFerramenta("confirmar_contrato", contexto, { token: pedido.data.token });
    registrar(r.ok);
    return ok(r.extra ?? { gravado: r.ok }, { requestId });
  } catch (e) {
    if (e instanceof FalhaDoContrato) {
      registrar(false);
      return fail(e.codigo, t(e.message), e.codigo === "idempotency_conflict" ? 409 : 422, { requestId });
    }
    registrar(false);
    const erro = e instanceof ErroApiContrato ? e : null;
    const etapa = pedido.data.etapa;
    // Resposta 200 do Hub em formato que o painel não reconhece (schema ou JSON inválido).
    const respostaInvalida = e instanceof z.ZodError || e instanceof SyntaxError;
    // Só tipo do erro e caminhos dos campos: nunca valores nem dados pessoais.
    logger.warn("painel_agente.contrato.falha", {
      requestId, etapa,
      tipo: erro ? `ErroApiContrato:${erro.codigo}` : e instanceof z.ZodError ? "ZodError" : e instanceof Error ? e.name : typeof e,
      ...(e instanceof z.ZodError ? {
        caminhos: e.issues.slice(0, 20).map((i) => ({ caminho: i.path.map(String).join("."), codigo: i.code })),
      } : {}),
    });
    if (!erro && respostaInvalida) {
      return fail("hub_unavailable", `${t("O Brisa Hub respondeu num formato que o painel não reconhece. Avise a administração informando a referência:")} ${requestId}`, 502, { requestId });
    }
    return fail("hub_unavailable", erro?.detalhe ?? t(erro?.codigo === "hub_contract_permission"
      ? "A chave do CRM não está autorizada na API de contratos do Brisa Hub. Peça à administração para habilitar esse acesso."
      : erro?.codigo === "hub_contract_unconfigured"
        ? "O serviço de contratos do Hub não está configurado. Peça à administração para conferir a integração."
        : etapa === "preparar"
          ? "Não foi possível preparar a locação no Brisa Hub. Tente novamente em instantes."
          : "Não foi possível concluir a operação no Brisa Hub. Se já confirmou, tente novamente pela mesma prévia para consultar ou retomar o pedido."), 502, { requestId });
  }
}
