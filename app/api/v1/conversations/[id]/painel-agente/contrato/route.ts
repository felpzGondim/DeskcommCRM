import { createHash, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { abrirContrato, chamarApiContrato, dadosContratoSchema, preparoContratoSchema, resultadoContratoSchema, selarContrato } from "@/lib/agent-engine/agent/painel-contrato";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { env } from "@/lib/env";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { carregarServidorMcpExterno } from "@/lib/mcp/servidor-externo/carregar";
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
  const hub = await carregarServidorMcpExterno(createAdminClient(), orgId, {
    contatoDoTurno: contato.id, conversaDoTurno: id, noAtendimento: true,
  });
  if (!hub) return fail("tool_unavailable", t("Configure o servidor MCP do Brisa Hub antes de gerar o contrato."), 422, { requestId });
  // Trocar servidor ou credencial também invalida a prévia, sem expor a chave.
  const destino = createHash("sha256").update(`${hub.servidor.endpoint}:${hub.servidor.chave}`).digest("hex");
  const escopo = `${orgId}:${id}:${auth.user.id}:${destino}`;
  try {
    if (pedido.data.etapa === "preparar") {
      const previa = preparoContratoSchema.parse(await chamarApiContrato(hub.servidor, "preparar", pedido.data.dados));
      const pronto = previa.pronto && previa.pendencias.length === 0 && !!previa.preview_id;
      const token = pronto ? selarContrato(previa.preview_id!, previa.validade_s ?? 1800, env.INTERNAL_SECRET, escopo) : null;
      registrar(true);
      return ok({ resumo: previa.resumo.texto, pendencias: previa.pendencias, avisos: previa.avisos, token }, { requestId });
    }
    const recibo = abrirContrato(pedido.data.token, env.INTERNAL_SECRET, escopo);
    if (!recibo) return fail("idempotency_conflict", t("A prévia expirou ou pertence a outra conversa. Prepare a locação novamente."), 409, { requestId });
    // A mesma prévia sempre leva a mesma chave ao recibo persistente do Hub,
    // inclusive após timeout, resposta perdida ou duplo clique.
    const resultado = resultadoContratoSchema.parse(await chamarApiContrato(hub.servidor, "confirmar", {
      preview_id: recibo.preview, idempotency_key: recibo.chave, confirmado: true,
    }));
    registrar(resultado.gravado);
    return ok(resultado, { requestId });
  } catch (e) {
    registrar(false);
    return fail("hub_unavailable", t(e instanceof Error && e.message === "hub_contract_permission"
      ? "A chave do CRM não está autorizada na API de contratos do Brisa Hub. Peça à administração para habilitar esse acesso."
      : "Não foi possível concluir a operação no Brisa Hub. Se já confirmou, tente novamente pela mesma prévia para consultar ou retomar o pedido."), 502, { requestId });
  }
}
