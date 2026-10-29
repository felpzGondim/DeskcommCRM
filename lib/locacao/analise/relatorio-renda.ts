import type { AnaliseDeExtrato } from "@/lib/locacao/extrato/tipos";
import type { FichaPreliminar } from "@/lib/locacao/ficha-schema";

const dinheiro = (centavos: number | null) => centavos == null ? "Não determinado" : (centavos / 100).toLocaleString("pt-BR", {style: "currency", currency: "BRL"});
const celula = (v: string) => v.replaceAll("|", "/").replace(/\r?\n/g, " ");
const cpf = (v: string) => v.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "***.***.***-**");

/** Relatório documental; inclui a memória do motor, sem resumir tabelas por IA. */
export function montarRelatorioDeRenda(ficha: FichaPreliminar, analises: readonly AnaliseDeExtrato[], pendencias: readonly string[]): string {
  const linhas = ["# Análise financeira para locação", "", "## 1. Identificação"];
  for (const p of ficha.pessoas.filter((p) => p.papel !== "contato")) {
    linhas.push("- " + celula(p.nome.valor || "Nome pendente") + " · " + p.papel + " · RENDA: " + dinheiro(p.renda_individual.valor == null ? null : Math.round(p.renda_individual.valor * 100)));
  }
  linhas.push("", "## 2. Resumo", "RENDA utilizada na esteira: " + dinheiro(ficha.renda.mensal.valor == null ? null : Math.round(ficha.renda.mensal.valor * 100)) + ".",
    "O valor utilizado e a apuração documental estão identificados separadamente neste relatório; o formulário mantém um único campo RENDA por pessoa.",
    "Documentos bancários analisados: " + analises.length + ".", "", "## 3. Crédito",
    "FCAnálise e Migra são etapas próprias. Este relatório de renda não substitui seus resultados.", "", "## 4. Renda e movimentação bancária");
  for (const a of analises) {
    linhas.push("", "### " + celula(a.nomeArquivo || a.fonteId || "Extrato"),
      "Titular: " + celula(a.titular.nome || "Não identificado") + ".",
      "Período: " + (a.periodo.inicio || "não identificado") + " a " + (a.periodo.fim || "não identificado") + ".",
      "Fonte: " + (a.messageId || a.fonteId || "não identificada") + " · Páginas: " + (a.paginasPdf ?? "não identificadas") + " · Lançamentos: " + a.lancamentos + ".",
      a.conferencia.conferido
        ? "Conciliação: " + (a.conferencia.fecha ? "sem diferença" : "divergente") + "; diferença: " + dinheiro(a.conferencia.diferencaCentavos) + "."
        : "Conciliação não confirmada; não declarar o extrato integralmente conciliado.",
      "", "| Mês | Cobertura | Créditos brutos | Débitos | Entradas consideradas pelo motor |", "|---|---|---:|---:|---:|");
    for (const m of a.resumo.linhas) {
      linhas.push("| " + m.mes + " | " + m.cobertura + " | " + dinheiro(m.creditosBrutosCentavos) + " | " + dinheiro(m.saidasCentavos) + " | " + dinheiro(m.rendaConsideradaCentavos) + " |");
      if (Object.keys(m.excluidos).length) {
        linhas.push("", "Exclusões de " + m.mes + ": " + Object.entries(m.excluidos).map(([classe, valor]) => classe + " = " + dinheiro(valor ?? 0)).join("; ") + ".", "");
      }
    }
    const completos = a.resumo.linhas.filter((m) => m.cobertura === "completo");
    linhas.push("", "Memória da média: " + (completos.length
      ? "(" + completos.map((m) => dinheiro(m.rendaConsideradaCentavos)).join(" + ") + ") / " + completos.length + " meses completos."
      : "Não há meses completos para calcular uma média mensal."),
      "Resultado apurado pelo motor: " + dinheiro(a.rendaComprovadaCentavos) + ". Meses parciais aparecem na tabela e não são extrapolados.");
    for (const m of a.resumo.linhas) {
      for (const [nome, itens] of [["Origens das entradas", m.entradasPorFonte], ["Destinatários das saídas", m.saidasPorFonte]] as const) {
        linhas.push("", "**" + nome + " · " + m.mes + "**", "", "| Contraparte | Total |", "|---|---:|");
        for (const item of itens) linhas.push("| " + celula(item.mascara) + " | " + dinheiro(item.totalCentavos) + " |");
      }
    }
    if (a.avisos.length) linhas.push("", "Limitações: " + a.avisos.map(celula).join("; "));
  }
  linhas.push("", "## 5. Finanças, despesas e aluguel atual");
  for (const a of analises) {
    linhas.push("", celula(a.nomeArquivo || a.fonteId || "Extrato") + ":", a.resumo.aluguelAtual.recado);
    for (const d of a.resumo.despesasFixas) linhas.push("- Despesa identificada: " + celula(d.mascara) + " · " + dinheiro(d.totalCentavos));
    for (const d of a.resumo.atipicas) linhas.push("- Movimentação atípica: " + celula(d.mascara) + " · " + dinheiro(d.totalCentavos));
  }
  linhas.push("", "## 6. Comprometimento e pendências");
  const renda = ficha.renda.mensal.valor;
  const aluguel = ficha.imovel.aluguel.valor;
  const valores = [aluguel, ficha.imovel.condominio.valor, ficha.imovel.iptu.valor];
  linhas.push(renda && renda > 0 && aluguel != null
    ? "Aluguel / RENDA utilizada: " + (aluguel / renda * 100).toFixed(2) + "%."
    : "Comprometimento não calculável: falta aluguel ou RENDA positiva.");
  if (renda && renda > 0 && valores.every((v) => v != null)) {
    const total = valores.reduce<number>((s, v) => s + (v ?? 0), 0);
    linhas.push("Aluguel + condomínio/rateio + IPTU: " + dinheiro(Math.round(total * 100)) + "; comprometimento sobre a RENDA utilizada: " + (total / renda * 100).toFixed(2) + "%.");
  }
  const avisos = [...new Set([...pendencias, ...ficha.renda.alertas, ...ficha.pendencias])];
  linhas.push(...avisos.map((a) => "- " + celula(a)));
  linhas.push("", "Recebimentos comerciais e movimentação bancária não demonstram, por si, lucro ou renda líquida pessoal. Conferir a natureza dos créditos antes da decisão. A decisão de locação cabe ao responsável humano.");
  return cpf(linhas.join("\n"));
}
