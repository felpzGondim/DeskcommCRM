/**
 * Leitura da conversa e os atalhos Resumir / Sugerir — o mesmo caminho do botão
 * e da ferramenta do agente.
 */
import { limitesDaAnalise } from "@/lib/agent-engine/agent/painel-anexos-limites";
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
import { reabrirPdfsTruncados } from "@/lib/painel/reabrir-pdfs-truncados";
import { comAvisoSeTruncado, derivadoEstaTruncado } from "@/lib/painel/texto-derivado";
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
    .select(
      "id,direction,type,body,media_derived_text,media_derived_status,media_mime,media_storage_path,media_size_bytes,metadata,sent_at,revoked_at",
    )
    .eq("organization_id", ctx.orgId)
    .eq("conversation_id", ctx.conversationId)
    .order("sent_at", { ascending: false })
    .limit(limite);
  if (opts?.aPartirDe) q = q.gte("sent_at", opts.aPartirDe);
  const { data: linhas, error } = await q;
  if (error) throw new Error("message_read_failed");
  const { linhas: lidas } = await reabrirPdfsTruncados(
    (linhas ?? []) as Record<string, unknown>[],
    ctx,
  );
  return lidas
    .filter((m) => !m.revoked_at)
    .reverse()
    .map((m) => {
      const derivado = typeof m.media_derived_text === "string" ? m.media_derived_text : "";
      const corpo = typeof m.body === "string" ? m.body : "";
      const truncado = !corpo && derivadoEstaTruncado(derivado, m.original_completo === true);
      const texto = comAvisoSeTruncado(corpo || derivado, truncado);
      return {
        direcao: m.direction === "inbound" ? "inbound" : "outbound",
        texto,
        em: (m.sent_at as string | null) ?? null,
        originalCompleto: m.original_completo === true,
      };
    });
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
  const primeiroNome =
    (nomeDoContato(contato ?? null) ?? "cliente").trim().split(/\s+/)[0] ?? "cliente";
  const bloco = montarBlocoDaConversa(falas, primeiroNome);
  const limites = limitesDaAnalise(ctx.settings);
  const reabertos = falas.filter((f) => f.originalCompleto === true && f.texto.length > 0);
  let resto = limites.chars_conjunto;
  const extras: string[] = [];
  for (const fala of reabertos) {
    if (resto <= 0) break;
    const recorte = fala.texto.slice(0, Math.min(limites.chars_por_arquivo, resto));
    resto -= recorte.length;
    extras.push(recorte);
  }
  const texto = extras.length > 0 ? `${bloco}\n${extras.join("\n")}` : bloco;
  return { ok: true, texto: mascararPessoaNoTexto(texto) };
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
  const primeiroNome =
    (nomeDoContato(contato ?? null) ?? "cliente").trim().split(/\s+/)[0] ?? "cliente";
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
