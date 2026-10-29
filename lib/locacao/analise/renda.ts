/**
 * Análise de renda no CRM (PR 4.1). Lê conversa + PDFs originais e aplica o
 * motor canônico de `lib/locacao/extrato` — a mesma regra do relatório
 * preliminar (#31). Sem classificação por regex. Sem prompt que lista
 * lançamentos. Nada vai ao cliente.
 */
import {
  comprovadaDasAnalises,
  FRASE_DECLARADO_ANULADO,
} from "@/lib/agent-engine/agent/painel-relatorio-preliminar";
import {
  FRASE_PACOTE_AUSENTE,
  textoDoResumoParaIa,
  type AnaliseDeExtrato,
  type ClasseLancamento,
  type MotivoSemRenda,
  type PacoteDoImovel,
} from "@/lib/locacao/extrato";
import type {
  BlocoDeRendaCalculado,
  FichaPreliminar,
  NumeroFicha,
} from "@/lib/locacao/ficha-schema";

const MOTIVO_SEM_RENDA: Record<MotivoSemRenda, string> = {
  ilegivel: "Extrato ilegível. Não estime a renda.",
  escaneado: "Extrato escaneado sem lançamentos legíveis. Não estime a renda.",
  so_negocio: "Após exclusões, não há renda identificável.",
  pagina_faltando: "Extrato com página faltando. Não trate como completo.",
  nao_e_extrato: "Não há extrato bancário para comprovar a renda.",
};

export type LancamentoNaFicha = {
  descricao: string;
  valor: number;
  data: string | null;
  fonte: string | null;
  trecho: string | null;
};

export type EntradaDaRendaNaFicha = {
  analises: readonly AnaliseDeExtrato[];
  holeriteCentavos?: number | null;
  declarada?: number | null;
  pacote?: PacoteDoImovel | null;
  pendencias?: readonly string[];
};

function reais(centavos: number | null | undefined): number | null {
  if (centavos == null || !Number.isFinite(centavos)) return null;
  return Math.round(centavos) / 100;
}

function mediaCentavos(valores: readonly (number | null | undefined)[]): number | null {
  const ok = valores.filter((v): v is number => v != null);
  if (ok.length === 0) return null;
  return Math.round(ok.reduce((a, b) => a + b, 0) / ok.length);
}

function fonteDaAnalise(a: AnaliseDeExtrato): string {
  return (a.fonteId ?? a.nomeArquivo ?? "extrato").slice(0, 16);
}

function itensDasClasses(
  analises: readonly AnaliseDeExtrato[],
  classes: readonly ClasseLancamento[],
  filtro?: (item: AnaliseDeExtrato["itens"][number]) => boolean,
): LancamentoNaFicha[] {
  const saida: LancamentoNaFicha[] = [];
  for (const a of analises) {
    for (const i of a.itens) {
      if (i.direcao !== "C") continue;
      if (!classes.includes(i.classe)) continue;
      if (filtro && !filtro(i)) continue;
      saida.push({
        descricao: i.descricao.slice(0, 180),
        valor: Math.round(i.valorCentavos) / 100,
        data: i.data || null,
        fonte: fonteDaAnalise(a),
        trecho: i.descricao.slice(0, 240),
      });
    }
  }
  return saida.slice(0, 50);
}

function eRendeFacil(descricao: string): boolean {
  return /rende\s*facil/i.test(descricao.normalize("NFD").replace(/\p{M}/gu, ""));
}

function motivoSemRenda(analises: readonly AnaliseDeExtrato[]): string | null {
  const motivo = analises.map((a) => a.motivoSemRenda).find((m) => m != null);
  if (motivo) return MOTIVO_SEM_RENDA[motivo];
  if (analises.length === 0) return MOTIVO_SEM_RENDA.nao_e_extrato;
  return "Sem renda comprovada depois das exclusões. Não estime.";
}

function numeroDaRenda(valor: number | null, fonte: string | null, trecho: string | null): NumeroFicha {
  return {
    valor,
    fonte,
    trecho,
    confianca: valor != null && valor > 0 ? 1 : null,
    message_id: null,
  };
}

export function montarBlocoDeRendaDasAnalises(
  analises: readonly AnaliseDeExtrato[],
  opcoes: {
    comprovadaCentavos: number | null;
    declarada?: number | null;
    pacote?: PacoteDoImovel | null;
  },
): BlocoDeRendaCalculado {
  const comprovada = reais(opcoes.comprovadaCentavos);
  const declarada =
    typeof opcoes.declarada === "number" && Number.isFinite(opcoes.declarada)
      ? Math.round(opcoes.declarada * 100) / 100
      : null;
  const pacote = reais(opcoes.pacote?.totalCentavos ?? null);
  const tres = reais(opcoes.pacote?.vezes3Centavos ?? null);
  const tabelas = analises
    .map((a) => textoDoResumoParaIa(a.resumo, a.paginasPdf))
    .filter((t) => t.trim().length > 0);
  const tabela = tabelas.length > 0 ? tabelas.join("\n\n").slice(0, 16000) : null;
  if (comprovada == null) {
    return {
      comprovada: null,
      declarada,
      tabela,
      motivo_nao_comprovacao: motivoSemRenda(analises),
      pacote,
      tres_vezes_pacote: tres,
      abaixo_de_3x: null,
    };
  }
  return {
    comprovada,
    declarada,
    tabela,
    motivo_nao_comprovacao: null,
    pacote,
    tres_vezes_pacote: tres,
    abaixo_de_3x: tres != null ? comprovada < tres : null,
  };
}

export function textoDoResumoDoBloco(bloco: BlocoDeRendaCalculado, alertas: readonly string[]): string {
  const linhas: string[] = [];
  if (bloco.comprovada != null) {
    linhas.push(`Renda comprovada: R$ ${bloco.comprovada.toFixed(2)}.`);
  } else {
    linhas.push(bloco.motivo_nao_comprovacao ?? "Sem renda comprovada.");
  }
  if (bloco.declarada != null) {
    linhas.push(`Renda declarada (não comprovada): R$ ${bloco.declarada.toFixed(2)}.`);
  }
  if (bloco.tres_vezes_pacote != null) {
    linhas.push(`3× o pacote (aluguel+condomínio+IPTU+seguro-incêndio): R$ ${bloco.tres_vezes_pacote.toFixed(2)}.`);
  } else {
    linhas.push(FRASE_PACOTE_AUSENTE);
  }
  if (alertas[0]) linhas.push(alertas[0]);
  return linhas.join(" ");
}

/**
 * Grava na ficha a comprovada do motor do #31 e o bloco que o 4.5 lê.
 * PIX/TED de terceiros entram; próprias, familiares, resgates, estornos e
 * empréstimos saem com volume à parte. Familiar provável fica sinalizado.
 */
export function aplicarRendaNaFicha(
  base: FichaPreliminar,
  entrada: EntradaDaRendaNaFicha,
): FichaPreliminar {
  const analises = entrada.analises;
  const comprovadaCentavos = comprovadaDasAnalises(analises, entrada.holeriteCentavos ?? null);
  const comprovada = reais(comprovadaCentavos);
  const comProvaveis = reais(
    mediaCentavos(analises.map((a) => a.resumo.rendaComProvaveisCentavos)),
  );
  const fonte = analises.find((a) => a.rendaComprovadaCentavos != null);
  const resgates = itensDasClasses(analises, ["resgate_aplicacao"]);
  const alertas: string[] = [...(entrada.pendencias ?? [])];

  if (comprovada == null && entrada.declarada != null) {
    alertas.push(FRASE_DECLARADO_ANULADO);
  }
  if (comProvaveis != null && comprovada != null && comProvaveis !== comprovada) {
    alertas.push(
      `Familiar provável — conferir. Renda sem: R$ ${comprovada.toFixed(2)}. Renda com: R$ ${comProvaveis.toFixed(2)}.`,
    );
  }
  const proprias = itensDasClasses(analises, ["propria"]);
  if (proprias.length) alertas.push("Transferências da própria pessoa ficaram à parte da comprovada.");
  const familiares = itensDasClasses(analises, ["familiar", "conjuge"]);
  if (familiares.length) {
    alertas.push("Créditos de familiares diretos da ficha ficaram à parte da comprovada.");
  }
  if (resgates.length) {
    alertas.push("Poupança, resgates, aplicações e Rende Fácil ficaram à parte da comprovada.");
  }
  const bloco = montarBlocoDeRendaDasAnalises(analises, {
    comprovadaCentavos,
    declarada: entrada.declarada ?? null,
    pacote: entrada.pacote ?? null,
  });
  if (bloco.abaixo_de_3x === true) {
    alertas.push("A renda comprovada não cobre 3× o pacote (aluguel+condomínio+IPTU+seguro-incêndio).");
  } else if (bloco.abaixo_de_3x === false) {
    alertas.push("A renda comprovada cobre 3× o pacote.");
  } else if (bloco.tres_vezes_pacote == null) {
    alertas.push(FRASE_PACOTE_AUSENTE);
  }
  if (comprovada == null) alertas.push(bloco.motivo_nao_comprovacao ?? MOTIVO_SEM_RENDA.nao_e_extrato);

  const evidencias = itensDasClasses(analises, [
    "salario_prolabore",
    "terceiro_pf",
    "terceiro_pj",
    "venda_cartao",
  ]).slice(0, 20).map((l) => ({
    trecho: (l.trecho ?? l.descricao).slice(0, 240),
    fonte: (l.fonte ?? "extrato").slice(0, 16),
  }));

  const trecho = evidencias[0]?.trecho ?? (comprovada != null
    ? "média dos meses completos, sem familiares prováveis"
    : null);

  return {
    ...base,
    pendencias: [...new Set([...base.pendencias, ...(entrada.pendencias ?? [])])].slice(0, 20),
    renda: {
      ...base.renda,
      mensal: numeroDaRenda(comprovada, fonte ? fonteDaAnalise(fonte) : "extrato", trecho),
      proposta_fc: numeroDaRenda(comprovada, fonte ? fonteDaAnalise(fonte) : "extrato", trecho),
      alertas: [...new Set(alertas)].slice(0, 20),
      excluida: {
        autotransferencias: proprias,
        poupanca: resgates.filter((l) => !eRendeFacil(l.descricao)),
        rende_facil: resgates.filter((l) => eRendeFacil(l.descricao)),
        familiares,
        familiares_provaveis: itensDasClasses(analises, ["familiar_provavel"]),
        estornos: itensDasClasses(analises, ["estorno_devolucao"]),
        emprestimos: itensDasClasses(analises, ["emprestimo"]),
      },
      pix_terceiros: itensDasClasses(analises, ["terceiro_pf", "terceiro_pj"]),
      vendas_cartao: itensDasClasses(analises, ["venda_cartao"]),
      evidencias,
      bloco_calculado: bloco,
    },
  };
}

export function textoDoResumo(ficha: FichaPreliminar): string {
  const bloco = ficha.renda.bloco_calculado;
  if (!bloco) return ficha.renda.alertas[0] ?? "Sem renda comprovada.";
  return textoDoResumoDoBloco(bloco, ficha.renda.alertas);
}
