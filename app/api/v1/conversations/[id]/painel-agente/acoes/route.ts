import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { TETO_TOKEN_PREVIA } from "@/lib/agent-engine/agent/painel-anexos-limites";
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

const corpo = z.discriminatedUnion("acao", [
  z.object({ acao: z.enum(["boletos", "contrato", "ficha"]) }).strict(),
  z.object({ acao: z.literal("analise"), etapa: z.enum(["preparar", "confirmar"]),
    confirmar: z.literal(true).optional(), pedidoId: z.string().uuid().optional(), previaToken: z.string().max(TETO_TOKEN_PREVIA).optional(),
    senhasPdf: z.array(z.object({ nome: z.string().trim().min(1).max(120), senha: z.string().min(1).max(200) })).max(12).optional() }).strict()
    .refine((v) => v.etapa === "preparar" ? !v.confirmar && !v.pedidoId && !v.previaToken
      : v.confirmar === true && !!v.pedidoId && !!v.previaToken),
]);

const NOME_DA_ACAO = {
  boletos: "buscar_boletos",
  contrato: "consultar_contrato",
  ficha: "consultar_ficha",
} as const;

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
  if (!pessoa.allowed || !org.allowed) return fail("rate_limited", t("Muitos pedidos seguidos. Tente em um minuto."), 429, {
    requestId, headers: { "Retry-After": "60" },
  });

  const db = await createClient();
  const { data: conversa } = await db.from("conversations").select("id,contact_id")
    .eq("organization_id", orgId).eq("id", id).maybeSingle();
  if (!conversa?.contact_id) return fail("not_found", t("Conversa não encontrada."), 404, { requestId });
  const { data: contato } = await db.from("contacts").select("id,is_anonymized,phone_number")
    .eq("organization_id", orgId).eq("id", conversa.contact_id).maybeSingle();
  if (!contato || contato.is_anonymized) {
    return fail("reply_context_unavailable", t("O contato desta conversa não está disponível."), 422, { requestId });
  }
  if (pedido.acao !== "analise" && !contato.phone_number) {
    return fail("reply_context_unavailable", t("O contato não tem telefone disponível para esta consulta."), 422, { requestId });
  }

  const registrar = (sucesso: boolean, replay = false) => void audit({
    action: `ai.painel_atendente.${pedido.acao}`,
    actorUserId: auth.user.id, organizationId: orgId, resourceType: "conversation",
    resourceId: id, requestId, metadata: { sucesso, replay },
  });

  const { data: orgLinha } = await db.from("organizations").select("settings")
    .eq("id", orgId).maybeSingle();
  const senhas = pedido.acao === "analise"
    ? Object.fromEntries((pedido.senhasPdf ?? []).map((s) => [s.nome, s.senha])) : {};

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
    phoneNumber: contato.phone_number,
    origem: "botao",
  });

  try {
    if (pedido.acao === "analise") {
      if (pedido.etapa === "preparar") {
        const r = await executarFerramenta("preparar_analise", contexto, { senhas });
        registrar(r.ok);
        return respostaDaFerramenta(r, t, requestId, { limites: r.extra?.limites });
      }
      const r = await executarFerramenta("iniciar_analise", contexto, {
        pedidoId: pedido.pedidoId,
        previaToken: pedido.previaToken,
        senhas,
      });
      registrar(r.ok, r.extra?.replay === true);
      return respostaDaFerramenta(r, t, requestId);
    }
    const r = await executarFerramenta(NOME_DA_ACAO[pedido.acao], contexto, {});
    registrar(r.ok);
    return respostaDaFerramenta(r, t, requestId);
  } catch {
    registrar(false);
    return fail("hub_unavailable", t("Não foi possível consultar o Brisa Hub agora. Tente novamente."), 502, { requestId });
  }
}
