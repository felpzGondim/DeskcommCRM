/**
 * Leitura de um anexo da conversa (texto extraído / visão). Conta no teto de análise.
 */
import { limitesDaAnalise } from "@/lib/agent-engine/agent/painel-anexos-limites";
import { frasesDosAvisos, nomeDoAnexo } from "@/lib/agent-engine/agent/painel-leitura-anexos";
import { requestTurnDeps } from "@/lib/agent-engine/agent/request-deps";
import { lerDocumentoPorVisao } from "@/lib/ai/visao/ler-documento";
import { mascararPessoaNoTexto } from "@/lib/painel/mascarar";
import { reabrirPdfsTruncados } from "@/lib/painel/reabrir-pdfs-truncados";
import { comAvisoSeTruncado, derivadoEstaTruncado } from "@/lib/painel/texto-derivado";
import type { ContextoDaFerramenta, ResultadoDaFerramenta } from "@/lib/painel/ferramentas/tipos";

export async function lerAnexoDoPainel(
  ctx: ContextoDaFerramenta,
  args: { nome?: string; message_id?: string; senha?: string },
): Promise<ResultadoDaFerramenta> {
  const limites = limitesDaAnalise(ctx.settings);
  const { data: linhas, error } = await ctx.dbSessao
    .from("messages")
    .select(
      "id,direction,type,body,media_derived_text,media_derived_status,media_mime,media_storage_path,media_size_bytes,metadata,revoked_at",
    )
    .eq("organization_id", ctx.orgId)
    .eq("conversation_id", ctx.conversationId)
    .order("sent_at", { ascending: false })
    .limit(limites.mensagens_brutas);
  if (error) return { ok: false, texto: "Não foi possível ler os anexos desta conversa." };
  const todas = (linhas ?? []) as Record<string, unknown>[];
  const alvo = todas.filter((l) => {
    if (l.revoked_at) return false;
    if (args.message_id && String(l.id) === args.message_id) return true;
    if (args.nome && nomeDoAnexo(l).toLowerCase() === args.nome.trim().toLowerCase()) return true;
    return false;
  });
  const janela =
    alvo.length > 0
      ? alvo
      : todas.filter((l) => ["document", "image"].includes(String(l.type ?? "")));
  if (janela.length === 0)
    return { ok: false, texto: "Não há anexo com esse nome nesta conversa." };
  const senhas = args.senha && args.nome ? { [args.nome]: args.senha } : {};
  const enriquecido = await reabrirPdfsTruncados(janela.slice(0, 3), ctx, {
    senhas,
    visao: () => {
      const deps = requestTurnDeps();
      return (e) => lerDocumentoPorVisao({ ...e, llmCfg: deps.llmCfg });
    },
  });
  const teto = limites.chars_por_arquivo;
  const textos = enriquecido.linhas
    .map((l) => {
      const nome = nomeDoAnexo(l);
      const derivado =
        l.media_derived_status === "ready" && typeof l.media_derived_text === "string"
          ? l.media_derived_text.trim()
          : "";
      const truncado = derivadoEstaTruncado(derivado, l.original_completo === true);
      const recorte = comAvisoSeTruncado(derivado.slice(0, teto), truncado);
      return derivado ? `${nome}: ${recorte}` : `${nome}: (sem texto documental legível)`;
    })
    .join("\n");
  const pendencias = frasesDosAvisos(enriquecido.avisos, limites.tentativas_senha);
  return {
    ok: true,
    texto: mascararPessoaNoTexto(
      [textos || "Anexo sem texto extraído.", ...pendencias].filter(Boolean).join("\n"),
    ),
    avisos: enriquecido.avisos,
  };
}
