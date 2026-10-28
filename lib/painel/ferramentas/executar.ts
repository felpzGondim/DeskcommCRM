/**
 * Porta única: botão e agente chamam isto. Não há caminho paralelo.
 * C e S executam aqui quando o HUMANO clicou (origem "botao"); o loop do
 * modelo nunca as coloca no ToolSet.
 */
import { analiseLigada } from "@/lib/locacao/chaves";
import { mascararPessoaNoTexto, parametrosSemPii } from "@/lib/painel/mascarar";
import { ferramentaDoPainel } from "./registro";
import type { ContextoDaFerramenta, ResultadoDaFerramenta } from "./tipos";

export async function executarFerramenta(
  nome: string,
  ctx: ContextoDaFerramenta,
  args: unknown = {},
): Promise<ResultadoDaFerramenta> {
  const def = ferramentaDoPainel(nome);
  if (!def) return { ok: false, texto: "Ferramenta desconhecida." };
  if (def.exigeChaveAnalise && !analiseLigada(ctx.settings, def.exigeChaveAnalise)) {
    return {
      ok: false,
      texto: "Esta análise não está ligada nesta organização.",
      codigo: "tool_unavailable",
    };
  }
  if (def.nivel !== "L" && ctx.origem === "agente") {
    return {
      ok: false,
      texto: `A ferramenta ${nome} exige clique do atendente no painel. Proposta registrada; nada foi executado.`,
    };
  }
  void parametrosSemPii(args);
  await ctx.onAndamento?.(def.rotuloAndamento);
  const parsed = def.entrada.safeParse(args ?? {});
  if (!parsed.success) {
    return { ok: false, texto: "Pedido inválido para esta ferramenta." };
  }
  const r = await def.executar(ctx, parsed.data);
  return { ...r, texto: mascararPessoaNoTexto(r.texto) };
}
