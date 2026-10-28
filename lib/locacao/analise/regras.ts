/**
 * Regras da skill de análise financeira do inquilino, aplicadas em texto de
 * mentira e no JSON do modelo. Sem rede, sem banco: o teste cobre isto.
 *
 * Tira da renda comprovada: autotransferência, poupança e Rende Fácil.
 * PIX de terceiros fica à parte — não entra na proposta para a FC.
 */
export const MOTIVOS_DE_EXCLUSAO = [
  "autotransferencia",
  "poupanca",
  "rende_facil",
  "pix_terceiros",
] as const;

export type MotivoDeExclusao = (typeof MOTIVOS_DE_EXCLUSAO)[number];

export const CLASSES_DE_LANCAMENTO = [
  "renda_recorrente",
  "autotransferencia",
  "poupanca",
  "rende_facil",
  "pix_terceiros",
  "outro",
] as const;

export type ClasseDeLancamento = (typeof CLASSES_DE_LANCAMENTO)[number];

export type LancamentoDaRenda = {
  descricao: string;
  valor: number;
  data: string | null;
  fonte: string | null;
  trecho: string | null;
  classe: ClasseDeLancamento;
};

export type ResultadoDasRegras = {
  comprovada: number;
  proposta_fc: number;
  lancamentos: LancamentoDaRenda[];
  autotransferencias: LancamentoDaRenda[];
  poupanca: LancamentoDaRenda[];
  rende_facil: LancamentoDaRenda[];
  pix_terceiros: LancamentoDaRenda[];
  alertas: string[];
};

function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Classifica um lançamento pela descrição. A regra vence a classe que o modelo chutou. */
export function motivoDeExclusao(texto: string): MotivoDeExclusao | null {
  const t = normalizar(texto);
  if (/rende\s*facil/.test(t)) return "rende_facil";
  if (
    /\bpoupanca\b/.test(t) ||
    /rendimento da poupanca/.test(t) ||
    /aplicacao poupanca/.test(t) ||
    /deposito poupanca/.test(t) ||
    /resgate poupanca/.test(t)
  ) {
    return "poupanca";
  }
  if (
    /mesma titularidade/.test(t) ||
    /entre contas (proprias|do titular)/.test(t) ||
    /auto\s*transfer/.test(t) ||
    /transferencia entre contas/.test(t) ||
    /transferencia para conta (propria|do titular)/.test(t) ||
    /aplicacao automatica/.test(t) ||
    /resgate (de )?aplicacao/.test(t)
  ) {
    return "autotransferencia";
  }
  if (
    /\bpix\b/.test(t) &&
    /terceir|recebido de /.test(t) &&
    !/salario|folha|holerite|provento/.test(t)
  ) {
    return "pix_terceiros";
  }
  return null;
}

export function classeDoLancamento(texto: string, sugerida?: string | null): ClasseDeLancamento {
  const motivo = motivoDeExclusao(texto);
  if (motivo) return motivo;
  if (sugerida && (CLASSES_DE_LANCAMENTO as readonly string[]).includes(sugerida)) {
    return sugerida as ClasseDeLancamento;
  }
  const t = normalizar(texto);
  if (
    /salario|folha|holerite|provento|pensao|aposentadoria|aluguel recebido|prestacao de servico/.test(
      t,
    )
  ) {
    return "renda_recorrente";
  }
  return "outro";
}

/** Interpreta 1.234,56 / 1234,56 / 1234.56. Não lança. Ignora dia/mês do extrato. */
export function parseValorBr(texto: string): number | null {
  const semData = texto.replace(/\b\d{2}\/\d{2}(?:\/\d{2,4})?\b/g, " ");
  const comRs = semData.match(/R\$\s*(-?\d{1,3}(?:\.\d{3})*(?:,\d{2})?|-?\d+(?:,\d{2})?)/);
  const m = comRs ?? semData.match(/(-?\d{1,3}(?:\.\d{3})+,\d{2}|-?\d+,\d{2}|-?\d+\.\d{2})/);
  if (!m?.[1]) return null;
  const bruto = m[1];
  const negativo = /^\s*-/.test(texto) || /\b(debito|enviado|saida)\b/i.test(texto);
  let n: number;
  if (bruto.includes(",") && bruto.includes(".")) {
    n = Number(bruto.replace(/\./g, "").replace(",", "."));
  } else if (bruto.includes(",")) {
    n = Number(bruto.replace(",", "."));
  } else {
    n = Number(bruto);
  }
  if (!Number.isFinite(n)) return null;
  return negativo ? -Math.abs(n) : n;
}

/**
 * Lê linhas de um extrato de mentira (ou real). Uma linha com valor vira
 * lançamento. Serve de rede de segurança quando o modelo omite entradas.
 */
export function lancamentosDoTexto(texto: string, fonte = "texto"): LancamentoDaRenda[] {
  const saida: LancamentoDaRenda[] = [];
  for (const bruta of texto.split(/\r?\n/)) {
    const linha = bruta.trim();
    if (!linha) continue;
    const valor = parseValorBr(linha);
    if (valor === null || valor === 0) continue;
    const classe = classeDoLancamento(linha);
    saida.push({
      descricao: linha.slice(0, 180),
      valor: Math.abs(valor),
      data: linha.match(/\b(\d{2}\/\d{2}(?:\/\d{2,4})?)\b/)?.[1] ?? null,
      fonte,
      trecho: linha.slice(0, 240),
      classe,
    });
  }
  return saida;
}

function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Aplica as regras da skill: só renda recorrente soma; exclusões vão para
 * as listas; PIX de terceiros não entra na proposta da FC.
 */
export function aplicarRegrasDaRenda(
  lancamentos: readonly LancamentoDaRenda[],
  alertasExtras: readonly string[] = [],
): ResultadoDasRegras {
  const autotransferencias: LancamentoDaRenda[] = [];
  const poupanca: LancamentoDaRenda[] = [];
  const rendeFacil: LancamentoDaRenda[] = [];
  const pixTerceiros: LancamentoDaRenda[] = [];
  const recorrentes: LancamentoDaRenda[] = [];
  const reclassificados: LancamentoDaRenda[] = [];

  for (const bruto of lancamentos) {
    const classe = classeDoLancamento(bruto.descricao, bruto.classe);
    const item = { ...bruto, classe };
    reclassificados.push(item);
    if (classe === "autotransferencia") autotransferencias.push(item);
    else if (classe === "poupanca") poupanca.push(item);
    else if (classe === "rende_facil") rendeFacil.push(item);
    else if (classe === "pix_terceiros") pixTerceiros.push(item);
    else if (classe === "renda_recorrente") recorrentes.push(item);
  }

  const comprovada = arredondar(recorrentes.reduce((s, l) => s + Math.abs(l.valor), 0));
  const alertas = [...alertasExtras];
  if (autotransferencias.length > 0) {
    alertas.push("Autotransferências entre contas do próprio titular foram excluídas da renda.");
  }
  if (poupanca.length > 0) {
    alertas.push("Movimentação de poupança foi excluída da renda.");
  }
  if (rendeFacil.length > 0) {
    alertas.push("Lançamentos de Rende Fácil foram excluídos da renda.");
  }
  if (pixTerceiros.length > 0) {
    alertas.push(
      "PIX de terceiros ficou à parte: não conta como renda fixa nem entra na proposta da FC.",
    );
  }
  if (comprovada === 0) {
    alertas.push("Não há renda recorrente comprovada depois das exclusões.");
  }

  return {
    comprovada,
    proposta_fc: comprovada,
    lancamentos: reclassificados,
    autotransferencias,
    poupanca,
    rende_facil: rendeFacil,
    pix_terceiros: pixTerceiros,
    alertas: [...new Set(alertas)].slice(0, 20),
  };
}
