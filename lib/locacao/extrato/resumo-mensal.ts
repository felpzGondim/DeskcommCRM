/**
 * Tabela mensal do extrato: créditos, excluídos, renda considerada, saídas,
 * cobertura e pagadores recorrentes mascarados.
 */
import { mascararCpfNoTexto } from "@/lib/painel/mascarar";

import { CLASSES_EXCLUIDAS_DA_RENDA } from "./classificar";
import { formatarReais } from "./dinheiro";
import { diaDe, mascararPagador, mesDe } from "./texto";
import type {
  ClasseLancamento,
  CoberturaDoMes,
  LancamentoClassificado,
  LinhaMensal,
  MotivoSemRenda,
  PagadorRecorrente,
  PeriodoDoExtrato,
  ResumoMensal,
} from "./tipos";

const ROTULO_CLASSE: Record<ClasseLancamento, string> = {
  propria: "próprias",
  resgate_aplicacao: "resgates/aplicações",
  estorno_devolucao: "estornos/devoluções",
  emprestimo: "empréstimos",
  venda_cartao: "vendas no cartão/antecipações",
  salario_prolabore: "salário/pró-labore",
  terceiro_pj: "terceiros PJ",
  terceiro_pf: "terceiros PF",
  saida: "saídas",
  outro: "outros",
};

function coberturaDoMes(
  lancamentos: readonly LancamentoClassificado[],
  paginaFaltando: boolean,
): CoberturaDoMes {
  if (paginaFaltando) return "incompleto_pagina";
  const dias = lancamentos.map((l) => diaDe(l.data)).filter((d): d is number => d != null);
  if (dias.length === 0) return "parcial";
  const min = Math.min(...dias);
  const max = Math.max(...dias);
  if (min > 5 || max < 25) return "parcial";
  return "completo";
}

function pagadoresDoMes(lancamentos: readonly LancamentoClassificado[]): PagadorRecorrente[] {
  const mapa = new Map<string, { mascara: string; total: number }>();
  for (const l of lancamentos) {
    if (l.direcao !== "C") continue;
    if (CLASSES_EXCLUIDAS_DA_RENDA.has(l.classe)) continue;
    if (
      l.classe !== "terceiro_pj" &&
      l.classe !== "terceiro_pf" &&
      l.classe !== "salario_prolabore"
    ) {
      continue;
    }
    const chave = (l.contraparte ?? l.descricao).slice(0, 80);
    const atual = mapa.get(chave) ?? { mascara: mascararPagador(chave), total: 0 };
    atual.total += l.valorCentavos;
    mapa.set(chave, atual);
  }
  return [...mapa.values()]
    .map((v) => ({ mascara: v.mascara, meses: 1, totalCentavos: v.total }))
    .sort((a, b) => b.totalCentavos - a.totalCentavos)
    .slice(0, 8);
}

function marcarRecorrencia(linhas: LinhaMensal[]): void {
  const vezes = new Map<string, number>();
  for (const linha of linhas) {
    for (const p of linha.pagadoresRecorrentes) {
      vezes.set(p.mascara, (vezes.get(p.mascara) ?? 0) + 1);
    }
  }
  for (const linha of linhas) {
    linha.pagadoresRecorrentes = linha.pagadoresRecorrentes
      .map((p) => ({ ...p, meses: vezes.get(p.mascara) ?? 1 }))
      .filter((p) => p.meses >= 2);
  }
}

export function resumirMeses(
  lancamentos: readonly LancamentoClassificado[],
  opcoes: { periodo?: PeriodoDoExtrato; paginasFaltando?: boolean } = {},
): ResumoMensal {
  const porMes = new Map<string, LancamentoClassificado[]>();
  for (const l of lancamentos) {
    const mes = mesDe(l.data);
    if (!mes) continue;
    const lista = porMes.get(mes) ?? [];
    lista.push(l);
    porMes.set(mes, lista);
  }

  const avisos: string[] = [];
  const linhas: LinhaMensal[] = [...porMes.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mes, itens]) => {
      const excluidos: Partial<Record<ClasseLancamento, number>> = {};
      let creditos = 0;
      let renda = 0;
      let saidas = 0;
      for (const l of itens) {
        if (l.direcao === "D") {
          saidas += l.valorCentavos;
          continue;
        }
        creditos += l.valorCentavos;
        if (CLASSES_EXCLUIDAS_DA_RENDA.has(l.classe) || l.classe === "outro") {
          excluidos[l.classe] = (excluidos[l.classe] ?? 0) + l.valorCentavos;
        } else {
          renda += l.valorCentavos;
        }
      }
      return {
        mes,
        creditosBrutosCentavos: creditos,
        excluidos,
        rendaConsideradaCentavos: renda,
        saidasCentavos: saidas,
        cobertura: coberturaDoMes(itens, opcoes.paginasFaltando === true),
        pagadoresRecorrentes: pagadoresDoMes(itens),
      };
    });

  marcarRecorrencia(linhas);

  const soNegocio =
    lancamentos.length > 0 &&
    lancamentos.every(
      (l) =>
        l.direcao === "D" ||
        l.classe === "venda_cartao" ||
        CLASSES_EXCLUIDAS_DA_RENDA.has(l.classe),
    ) &&
    lancamentos.some((l) => l.classe === "venda_cartao");

  const completos = linhas.filter((l) => l.cobertura === "completo");
  let motivoSemRenda: MotivoSemRenda | null = null;
  let rendaComprovadaCentavos: number | null = null;

  if (opcoes.paginasFaltando) {
    avisos.push("Página faltando: a renda do período incompleto não é estimada.");
    motivoSemRenda = "pagina_faltando";
  } else if (soNegocio) {
    motivoSemRenda = "so_negocio";
    avisos.push("Só movimento de negócio, sem renda fixa identificável. Não estime a renda.");
  } else if (completos.length > 0) {
    const soma = completos.reduce((acc, l) => acc + l.rendaConsideradaCentavos, 0);
    rendaComprovadaCentavos = Math.round(soma / completos.length);
    if (rendaComprovadaCentavos === 0) {
      rendaComprovadaCentavos = null;
      motivoSemRenda = "so_negocio";
      avisos.push("Créditos do extrato, após exclusões, não identificam renda fixa. Não estime.");
    }
  } else if (linhas.length > 0) {
    avisos.push("Só há mês parcial. Não estime a renda a partir de cobertura incompleta.");
  }

  if (opcoes.periodo?.inicio && opcoes.periodo.fim) {
    avisos.push(`Período declarado no extrato: ${opcoes.periodo.inicio} a ${opcoes.periodo.fim}.`);
  }

  return { linhas, rendaComprovadaCentavos, motivoSemRenda, avisos };
}

function rotuloCobertura(c: CoberturaDoMes): string {
  if (c === "completo") return "mês completo";
  if (c === "incompleto_pagina") return "incompleto (página faltando)";
  return "mês parcial";
}

function excluidosTexto(excluidos: LinhaMensal["excluidos"]): string {
  const partes = (Object.entries(excluidos) as [ClasseLancamento, number][])
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${ROTULO_CLASSE[k]} ${formatarReais(v)}`);
  return partes.length > 0 ? partes.join("; ") : "nenhum";
}

export function textoDoResumoParaIa(resumo: ResumoMensal, paginasPdf: number | null): string {
  const cabeca = [
    "TABELA MENSAL CALCULADA PELO SISTEMA (use estes números; não some o texto bruto do extrato).",
    "Renda comprovada = créditos do mês menos transferências próprias, estornos/devoluções, resgates/aplicações e empréstimos. Vendas no cartão/antecipações não são renda de pessoa física.",
    "O valor declarado na conversa NÃO é comprovado.",
  ];
  if (paginasPdf != null) cabeca.push(`Páginas do PDF: ${paginasPdf}.`);
  const linhas = resumo.linhas.map((l) => {
    const pagadores =
      l.pagadoresRecorrentes.length > 0
        ? ` pagadores recorrentes: ${l.pagadoresRecorrentes.map((p) => `${p.mascara} (${p.meses} meses)`).join(", ")}`
        : "";
    return `${l.mes}: créditos ${formatarReais(l.creditosBrutosCentavos)}; excluídos ${excluidosTexto(l.excluidos)}; renda considerada ${formatarReais(l.rendaConsideradaCentavos)}; saídas ${formatarReais(l.saidasCentavos)}; cobertura ${rotuloCobertura(l.cobertura)}.${pagadores}`;
  });
  const comprovada =
    resumo.rendaComprovadaCentavos != null
      ? `Renda comprovada (média dos meses completos): ${formatarReais(resumo.rendaComprovadaCentavos)}.`
      : `Sem renda comprovada. ${resumo.motivoSemRenda === "so_negocio" ? "Só movimento de negócio, sem renda fixa identificável." : resumo.motivoSemRenda === "pagina_faltando" ? "Página faltando." : "Extrato insuficiente para comprovar."} Não estime.`;
  const aviso = resumo.avisos.map((a) => `Aviso: ${a}`).join("\n");
  return mascararCpfNoTexto(
    [cabeca.join(" "), ...linhas, comprovada, aviso].filter(Boolean).join("\n"),
  );
}
