/**
 * Leitura da conversa e os atalhos Resumir / Sugerir — o mesmo caminho do botão
 * e da ferramenta do agente.
 */
import {
  montarBlocoDaConversa,
  montarMensagensDoPainel,
  pedidoDaAcao,
  responderNoPainel,
  type FalaDaConversaDoPainel,
  type TurnoDoPainel,
} from "@/lib/agent-engine/agent/painel-do-atendente";
import { requestTurnDeps } from "@/lib/agent-engine/agent/request-deps";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";
import { mascararPessoaNoTexto } from "@/lib/painel/mascarar";
import type { ContextoDaFerramenta, ResultadoDaFerramenta } from "@/lib/painel/ferramentas/tipos";

const JANELA_PADRAO = 60;
const JANELA_MAX = 200;

export async function lerFalasDaConversa(
  ctx: ContextoDaFerramenta,
  opts?: { limite?: number; aPartirDe?: string | null },
): Promise<FalaDaConversaDoPainel[]> {
  const limite = Math.min(Math.max(opts?.limite ?? JANELA_PADRAO, 1), JANELA_MAX);
  let q = ctx.dbSessao
    .from("messages")
    .select("direction,body,media_derived_text,sent_at,revoked_at")
    .eq("organization_id", ctx.orgId)
    .eq("conversation_id", ctx.conversationId)
    .order("sent_at", { ascending: false })
    .limit(limite);
  if (opts?.aPartirDe) q = q.gte("sent_at", opts.aPartirDe);
  const { data: linhas, error } = await q;
  if (error) throw new Error("message_read_failed");
  return ((linhas ?? []) as Record<string, unknown>[])
    .filter((m) => !m.revoked_at)
    .reverse()
    .map((m) => ({
      direcao: m.direction === "inbound" ? "inbound" : "outbound",
      texto: String(m.body ?? m.media_derived_text ?? ""),
      em: (m.sent_at as string | null) ?? null,
    }));
}

export async function lerConversaDoPainel(
  ctx: ContextoDaFerramenta,
  args: { limite?: number; a_partir_de?: string },
): Promise<ResultadoDaFerramenta> {
  const falas = await lerFalasDaConversa(ctx, { limite: args.limite, aPartirDe: args.a_partir_de });
  const { data: contato } = await ctx.dbSessao
    .from("contacts")
    .select("name,display_name")
    .eq("organization_id", ctx.orgId)
    .eq("id", ctx.contactId)
    .maybeSingle();
  const primeiroNome = (nomeDoContato(contato ?? null) ?? "cliente").trim().split(/\s+/)[0] ?? "cliente";
  const bloco = montarBlocoDaConversa(falas, primeiroNome);
  return { ok: true, texto: mascararPessoaNoTexto(bloco) };
}

export async function resumirOuSugerir(
  ctx: ContextoDaFerramenta,
  acao: "resumir" | "sugerir",
  extra?: string | null,
  historico: TurnoDoPainel[] = [],
): Promise<ResultadoDaFerramenta> {
  const falas = await lerFalasDaConversa(ctx);
  if (falas.every((f) => f.texto.trim() === "")) {
    return { ok: false, texto: "Ainda não há mensagens de texto nesta conversa." };
  }
  const { data: contato } = await ctx.dbSessao
    .from("contacts")
    .select("name,display_name")
    .eq("organization_id", ctx.orgId)
    .eq("id", ctx.contactId)
    .maybeSingle();
  const primeiroNome = (nomeDoContato(contato ?? null) ?? "cliente").trim().split(/\s+/)[0] ?? "cliente";
  const mensagens = montarMensagensDoPainel({
    blocoDaConversa: montarBlocoDaConversa(falas, primeiroNome),
    historico,
    pedido: pedidoDaAcao(acao, extra ?? null),
  });
  const deps = requestTurnDeps();
  const resposta = await responderNoPainel(
    getRequestPool(),
    deps.llmCfg,
    { tenantId: ctx.orgId, contactId: ctx.contactId, mensagens },
    { registry: deps.registry, log: deps.log },
  );
  const texto = mascararPessoaNoTexto(resposta.texto);
  return {
    ok: true,
    texto,
    sugestao: acao === "sugerir" ? texto : undefined,
    extra: { callId: resposta.callId },
  };
}
