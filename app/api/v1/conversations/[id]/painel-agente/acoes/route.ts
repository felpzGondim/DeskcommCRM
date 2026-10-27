import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ACOES_HUB, apresentarResultado, ferramentaDaAcao, ferramentaDoInquilino, leituraPermitida, montarFichaTemporaria, tresDigitosDoCliente } from "@/lib/agent-engine/agent/painel-acoes-hub";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { comIdempotencia } from "@/lib/api/idempotency";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { chamarFerramentaRemota } from "@/lib/mcp/servidor-externo/chamada";
import { carregarServidorMcpExterno } from "@/lib/mcp/servidor-externo/carregar";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const corpo = z.discriminatedUnion("acao", [
  z.object({ acao: z.enum(["boletos", "contrato", "ficha"]) }).strict(),
  z.object({ acao: z.literal("analise"), confirmar: z.literal(true), pedidoId: z.string().uuid() }).strict(),
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
  if (!pessoa.allowed || !org.allowed) return fail("rate_limited", t("Muitos pedidos seguidos. Tente em um minuto."), 429, {
    requestId, headers: { "Retry-After": "60" },
  });

  // Sessão e organização verificadas antes de usar service role para abrir o segredo da org.
  const db = await createClient();
  const { data: conversa } = await db.from("conversations").select("id,contact_id")
    .eq("organization_id", orgId).eq("id", id).maybeSingle();
  if (!conversa?.contact_id) return fail("not_found", t("Conversa não encontrada."), 404, { requestId });
  const { data: contato } = await db.from("contacts").select("id,is_anonymized,phone_number")
    .eq("organization_id", orgId).eq("id", conversa.contact_id).maybeSingle();
  if (!contato || contato.is_anonymized || !contato.phone_number) {
    return fail("reply_context_unavailable", t("O contato não tem telefone disponível para esta consulta."), 422, { requestId });
  }

  const registrar = (sucesso: boolean, replay = false) => void audit({
    action: `ai.painel_atendente.${pedido.acao}`,
    actorUserId: auth.user.id, organizationId: orgId, resourceType: "conversation",
    resourceId: id, requestId, metadata: { sucesso, replay },
  });

  const montado = await carregarServidorMcpExterno(createAdminClient(), orgId, {
    contatoDoTurno: contato.id, conversaDoTurno: id, noAtendimento: true,
  });
  const ferramenta = montado && ferramentaDaAcao(pedido.acao, montado.ferramentas);
  const ferramentaInquilino = pedido.acao === "contrato" && montado && ferramenta?.name === "buscar_contrato"
    ? ferramentaDoInquilino(montado.ferramentas) : null;
  if (!montado || !ferramenta || (pedido.acao !== "analise" && !leituraPermitida(pedido.acao, ferramenta)) ||
    (pedido.acao === "contrato" && ferramenta.name === "buscar_contrato" && ferramentaInquilino?.somenteLeitura !== true) ||
    (pedido.acao === "analise" &&
    (!ferramenta.inputSchema?.properties?.pedido_id || !ferramenta.inputSchema.properties.conversa_id))) {
    registrar(false);
    return fail("tool_unavailable", t(`${ACOES_HUB[pedido.acao].rotulo}: ferramenta não disponível no Brisa Hub. Peça à administração para conferir a integração MCP.`), 422, { requestId });
  }
  try {
    if (pedido.acao === "analise") {
      const recibo = await comIdempotencia({
        db, organizationId: orgId, endpoint: `/api/v1/conversations/${id}/painel-agente/acoes/analise`,
        exigirReserva: true,
        chave: pedido.pedidoId, corpo: { conversationId: id, acao: "analise", pedidoId: pedido.pedidoId },
        executar: async () => {
          const r = await chamarFerramentaRemota(montado.servidor, ferramenta.name,
            { pedido_id: pedido.pedidoId, conversa_id: id }, { cabecalhos: montado.cabecalhos });
          // A resposta livre do Hub pode conter dados pessoais: só mostramos um status fixo.
          void r;
          return { resposta: { resumo: "Pedido de análise enviado ao Brisa Hub (FC Score+ e Migra). Consulte o andamento no Hub." }, status: 200 };
        },
      });
      if (recibo.tipo === "conflito") return fail("idempotency_conflict", t("Este pedido já foi usado com outros dados."), 409, { requestId });
      if (recibo.tipo === "em_curso") return fail("idempotency_in_progress", t("Esta análise já está em andamento. Aguarde e consulte novamente."), 409, { requestId });
      registrar(true, recibo.tipo === "replay");
      return ok(recibo.resposta, { requestId });
    }
    let argumentos: Record<string, unknown> = {};
    if (pedido.acao === "boletos" && ferramenta.name === "segunda_via_boleto") {
      const { data: ultima, error: erroMensagem } = await db.from("messages")
        .select("body,sent_at")
        .eq("organization_id", orgId)
        .eq("conversation_id", id)
        .eq("direction", "inbound")
        .is("revoked_at", null)
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (erroMensagem) throw new Error("message_read_failed");
      const cpf3 = tresDigitosDoCliente(ultima?.body, ultima?.sent_at);
      if (!cpf3) {
        registrar(true);
        return ok({
          resumo: "Aguardando os três primeiros dígitos do CPF do titular, enviados pelo cliente nesta conversa. O atendente não precisa digitá-los.",
          sugestao: "Para localizar sua 2ª via, por favor informe somente os três primeiros dígitos do CPF do titular do contrato. Não envie o CPF completo.",
        }, { requestId });
      }
      argumentos = { tres_primeiros_digitos_cpf: cpf3 };
    }
    if (pedido.acao === "ficha") {
      const { data: linhas, error: erroFicha } = await db.from("messages")
        .select("type,body,media_mime,metadata,revoked_at")
        .eq("organization_id", orgId)
        .eq("conversation_id", id)
        .eq("direction", "inbound")
        .order("sent_at", { ascending: false })
        .limit(60);
      if (erroFicha) throw new Error("message_read_failed");
      argumentos = { ficha: montarFichaTemporaria((linhas ?? []) as Record<string, unknown>[]) };
    }
    const r = await chamarFerramentaRemota(montado.servidor, ferramenta.name, argumentos, { cabecalhos: montado.cabecalhos });
    if (pedido.acao === "contrato" && ferramentaInquilino) {
      const inquilino = await chamarFerramentaRemota(montado.servidor, ferramentaInquilino.name, {}, { cabecalhos: montado.cabecalhos });
      const dadosContrato = r.dados && typeof r.dados === "object" ? r.dados as Record<string, unknown> : {};
      const dadosInquilino = inquilino.dados && typeof inquilino.dados === "object" ? inquilino.dados as Record<string, unknown> : {};
      r.dados = { ...dadosContrato, inquilino_situacao: dadosInquilino.situacao };
    }
    const saida = apresentarResultado(pedido.acao, r);
    if (!saida) {
      registrar(false);
      return fail("hub_contract_error", t("O Brisa Hub não devolveu os dados esperados para esta ação."), 422, { requestId });
    }
    registrar(true);
    return ok(saida, { requestId });
  } catch {
    // Nunca propagar mensagens de erro do Hub: podem conter telefone, CPF ou chave.
    registrar(false);
    return fail("hub_unavailable", t("Não foi possível consultar o Brisa Hub agora. Tente novamente."), 502, { requestId });
  }
}
