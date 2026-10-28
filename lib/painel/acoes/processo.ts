/**
 * Leitura do processo da Fase 3 e da FC já existente (até 90 dias).
 * Sem nova FC paga. Sem CPF completo na saída.
 */
import { tabelaLocacao } from "@/lib/locacao/admin";
import { processosLigados } from "@/lib/locacao/chaves";
import { fcReaproveitavel, lerProcesso, listarParticipantes, listarProcessosDaConversa } from "@/lib/locacao/repositorio";
import { mascararPessoaNoTexto } from "@/lib/painel/mascarar";
import type { ContextoDaFerramenta, ResultadoDaFerramenta } from "@/lib/painel/ferramentas/tipos";

export async function lerProcessoDoPainel(ctx: ContextoDaFerramenta): Promise<ResultadoDaFerramenta> {
  if (!processosLigados(ctx.settings)) {
    return { ok: true, texto: "O processo de locação não está ligado nesta organização." };
  }
  const lista = await listarProcessosDaConversa(ctx.admin, ctx.orgId, ctx.conversationId);
  if (lista.length === 0) return { ok: true, texto: "Esta conversa não está ligada a um processo de locação." };
  const partes: string[] = [];
  for (const p of lista.slice(0, 5)) {
    const id = String(p.id ?? "");
    const proc = id ? await lerProcesso(ctx.admin, ctx.orgId, id) : null;
    if (!proc) continue;
    const participantes = await listarParticipantes(ctx.admin, ctx.orgId, id);
    const nomes = participantes
      .map((x) => `${String(x.papel ?? "")}${x.cpf_mascarado ? ` ${x.cpf_mascarado}` : ""}`)
      .join(", ");
    partes.push(
      `Processo ${id.slice(0, 8)}: status ${String(proc.status ?? "")}; imóvel ${String(proc.imovel_id ?? "").slice(0, 8)}; participantes: ${nomes || "nenhum"}.`,
    );
  }
  return { ok: true, texto: mascararPessoaNoTexto(partes.join("\n")), extra: { processos: lista } };
}

export async function lerFcExistenteDoPainel(
  ctx: ContextoDaFerramenta,
  args: { cpf_hash?: string },
): Promise<ResultadoDaFerramenta> {
  if (!processosLigados(ctx.settings)) {
    return { ok: true, texto: "O processo de locação não está ligado nesta organização." };
  }
  if (!args.cpf_hash) {
    const lista = await listarProcessosDaConversa(ctx.admin, ctx.orgId, ctx.conversationId);
    if (lista.length === 0) return { ok: true, texto: "Não há processo nesta conversa para localizar FC." };
    const linhas: string[] = [];
    for (const p of lista.slice(0, 5)) {
      const { data } = await tabelaLocacao(ctx.admin, "locacao_analises_fc")
        .select("id,estado,concluida_em,reaproveitou_de")
        .eq("organization_id", ctx.orgId)
        .eq("processo_id", String(p.id ?? ""))
        .order("created_at", { ascending: false })
        .limit(3);
      for (const a of (data ?? []) as Record<string, unknown>[]) {
        linhas.push(
          `FC ${String(a.id).slice(0, 8)}: ${String(a.estado)} ${a.concluida_em ? `em ${String(a.concluida_em)}` : ""}${a.reaproveitou_de ? " (reaproveitada)" : ""}.`,
        );
      }
    }
    return {
      ok: true,
      texto: mascararPessoaNoTexto(linhas.join("\n") || "Nenhuma análise FC registrada neste processo."),
    };
  }
  const reuso = await fcReaproveitavel(ctx.admin, ctx.orgId, args.cpf_hash, 90);
  if (!reuso) return { ok: true, texto: "Não há laudo FC reaproveitável (90 dias) para este hash." };
  return {
    ok: true,
    texto: mascararPessoaNoTexto(
      `Há laudo FC reaproveitável (até 90 dias). Processo ${String(reuso.processo_id ?? "").slice(0, 8)}. Concluída em ${String(reuso.concluida_em ?? "")}. Sem nova cobrança.`,
    ),
  };
}
