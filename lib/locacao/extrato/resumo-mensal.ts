/**
 * Tabela mensal (correção 20:57): renda comprovada = créditos que não são
 * próprias, familiares, resgates, estornos nem empréstimos. PIX/TED de
 * terceiros (inclusive avulsos) e vendas no cartão entram. Familiares
 * prováveis saem da comprovada e aparecem na renda com prováveis.
 */
import { mascararCpfNoTexto } from "@/lib/painel/mascarar";

import { detectarAluguelAtual } from "./aluguel-atual";
import { CLASSES_EXCLUIDAS_DA_RENDA } from "./classificar";
import { formatarReais } from "./dinheiro";
import { diaDe, mascararPagador, mesDe } from "./texto";
import type {
  ClasseLancamento,
  CoberturaDoMes,
  FamiliarProvavel,
  LancamentoClassificado,
  LinhaMensal,
  MotivoSemRenda,
  PagadorRecorrente,
  PeriodoDoExtrato,
  RecorrenciaPagador,
  ResumoMensal,
  SomaPorFonte,
} from "./tipos";

const ROTULO_CLASSE: Record<ClasseLancamento, string> = {
  propria: "próprias",
  conjuge: "cônjuge",
  familiar: "familiares",
  familiar_provavel: "familiar provável",
  resgate_aplicacao: "resgates/aplicações",
  estorno_devolucao: "estornos/devoluções",
  emprestimo: "empréstimos",
  venda_cartao: "vendas no cartão/maquininha",
  salario_prolabore: "salário/pró-labore",
  terceiro_pj: "terceiros PJ",
  terceiro_pf: "terceiros PF",
  saida: "saídas",
  outro: "outros",
};

const DESPESA_FIXA =
  /\bFINANCIAMENTO\b|\bFATURA\b|\bPARCELA\b|\bCONSIGNADO\b|\bCARTAO\b|\bENERGIA\b|\bAGUA\b|\bTELEFONE\b/i;

const ALUGUEL_AUSENTE =
  "Não foi possível identificar o pagamento de aluguel nos documentos fornecidos.";

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

function chaveFonte(l: LancamentoClassificado): string {
  return (l.contraparte ?? l.descricao).slice(0, 80);
}

function somarPorFonte(
  lancamentos: readonly LancamentoClassificado[],
  direcao: "C" | "D",
): SomaPorFonte[] {
  const mapa = new Map<string, number>();
  for (const l of lancamentos) {
    if (l.direcao !== direcao) continue;
    const k = chaveFonte(l);
    mapa.set(k, (mapa.get(k) ?? 0) + l.valorCentavos);
  }
  return [...mapa.entries()]
    .map(([k, total]) => ({ mascara: mascararPagador(k), totalCentavos: total }))
    .sort((a, b) => b.totalCentavos - a.totalCentavos)
    .slice(0, 8);
}

function ehRendaComprovada(l: LancamentoClassificado): boolean {
  if (l.direcao !== "C") return false;
  if (CLASSES_EXCLUIDAS_DA_RENDA.has(l.classe)) return false;
  return true;
}

function ehRendaComProvaveis(l: LancamentoClassificado): boolean {
  if (l.direcao !== "C") return false;
  if (l.classe === "familiar_provavel") return true;
  return ehRendaComprovada(l);
}

function pagadoresDoMes(
  lancamentos: readonly LancamentoClassificado[],
  vezesPorMascara: ReadonlyMap<string, number>,
): PagadorRecorrente[] {
  const mapa = new Map<string, { mascara: string; total: number; lancamentos: number }>();
  for (const l of lancamentos) {
    if (!ehRendaComprovada(l)) continue;
    const chave = chaveFonte(l);
    const atual = mapa.get(chave) ?? { mascara: mascararPagador(chave), total: 0, lancamentos: 0 };
    atual.total += l.valorCentavos;
    atual.lancamentos += 1;
    mapa.set(chave, atual);
  }
  return [...mapa.values()]
    .map((v) => ({
      mascara: v.mascara,
      meses: vezesPorMascara.get(v.mascara) ?? 1,
      lancamentos: v.lancamentos,
      totalCentavos: v.total,
    }))
    .sort((a, b) => b.totalCentavos - a.totalCentavos)
    .slice(0, 8);
}

function mesesPorMascara(lancamentos: readonly LancamentoClassificado[]): Map<string, number> {
  const meses = new Map<string, Set<string>>();
  for (const l of lancamentos) {
    if (!ehRendaComprovada(l)) continue;
    const mes = mesDe(l.data);
    if (!mes) continue;
    const mascara = mascararPagador(chaveFonte(l));
    const set = meses.get(mascara) ?? new Set<string>();
    set.add(mes);
    meses.set(mascara, set);
  }
  return new Map([...meses].map(([k, v]) => [k, v.size]));
}

export function recorrenciaDePagadores(
  lancamentos: readonly LancamentoClassificado[],
): RecorrenciaPagador[] {
  const mapa = new Map<
    string,
    { mascara: string; porMes: Map<string, { lancamentos: number; total: number }> }
  >();
  for (const l of lancamentos) {
    if (!ehRendaComprovada(l)) continue;
    const mes = mesDe(l.data);
    if (!mes) continue;
    const chave = chaveFonte(l);
    const atual = mapa.get(chave) ?? {
      mascara: mascararPagador(chave),
      porMes: new Map(),
    };
    const noMes = atual.porMes.get(mes) ?? { lancamentos: 0, total: 0 };
    noMes.lancamentos += 1;
    noMes.total += l.valorCentavos;
    atual.porMes.set(mes, noMes);
    mapa.set(chave, atual);
  }
  return [...mapa.values()]
    .map((v) => {
      const porMes = [...v.porMes.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([mes, x]) => ({
          mes,
          lancamentos: x.lancamentos,
          totalCentavos: x.total,
        }));
      return {
        mascara: v.mascara,
        meses: porMes.map((p) => p.mes),
        lancamentos: porMes.reduce((a, p) => a + p.lancamentos, 0),
        totalCentavos: porMes.reduce((a, p) => a + p.totalCentavos, 0),
        porMes,
      };
    })
    .sort((a, b) => b.totalCentavos - a.totalCentavos)
    .slice(0, 12);
}

function listarFamiliaresProvaveis(
  lancamentos: readonly LancamentoClassificado[],
): FamiliarProvavel[] {
  const mapa = new Map<
    string,
    { mascara: string; total: number; lancamentos: number; motivo: FamiliarProvavel["motivo"] }
  >();
  for (const l of lancamentos) {
    if (l.direcao !== "C" || l.classe !== "familiar_provavel") continue;
    const chave = chaveFonte(l);
    const atual = mapa.get(chave) ?? {
      mascara: mascararPagador(chave),
      total: 0,
      lancamentos: 0,
      motivo: l.motivoFamiliar ?? "sobrenome",
    };
    atual.total += l.valorCentavos;
    atual.lancamentos += 1;
    mapa.set(chave, atual);
  }
  return [...mapa.values()]
    .map((v) => ({
      mascara: v.mascara,
      totalCentavos: v.total,
      lancamentos: v.lancamentos,
      motivo: v.motivo,
    }))
    .sort((a, b) => b.totalCentavos - a.totalCentavos);
}

function mediaCompletos(
  linhas: readonly LinhaMensal[],
  campo: "renda" | "comProvaveis",
): number | null {
  const completos = linhas.filter((l) => l.cobertura === "completo");
  if (completos.length === 0) return null;
  const soma = completos.reduce(
    (acc, l) =>
      acc + (campo === "renda" ? l.rendaConsideradaCentavos : l.rendaComProvaveisCentavos),
    0,
  );
  const media = Math.round(soma / completos.length);
  return media;
}

export function resumoVazio(motivo: MotivoSemRenda | null, avisos: string[] = []): ResumoMensal {
  return {
    linhas: [],
    rendaComprovadaCentavos: null,
    rendaComProvaveisCentavos: null,
    motivoSemRenda: motivo,
    volumePropriasCentavos: 0,
    volumeConjugeCentavos: 0,
    volumeFamiliarCentavos: 0,
    volumeFamiliarProvavelCentavos: 0,
    volumePixTerceirosCentavos: 0,
    volumeVendasCartaoCentavos: 0,
    aluguelAtual: {
      encontrado: false,
      valorCentavos: null,
      meses: 0,
      mascara: null,
      recado: ALUGUEL_AUSENTE,
    },
    despesasFixas: [],
    atipicas: [],
    recorrenciaPagadores: [],
    familiaresProvaveis: [],
    avisos,
  };
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

  const coberturaPorMes = new Map<string, CoberturaDoMes>();
  for (const [mes, itens] of porMes) {
    coberturaPorMes.set(mes, coberturaDoMes(itens, opcoes.paginasFaltando === true));
  }
  const vezesPorMascara = mesesPorMascara(lancamentos);

  const avisos: string[] = [];
  const linhas: LinhaMensal[] = [...porMes.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mes, itens]) => {
      const excluidos: Partial<Record<ClasseLancamento, number>> = {};
      let creditos = 0;
      let renda = 0;
      let rendaProv = 0;
      let pixTerceiros = 0;
      let vendasCartao = 0;
      let saidas = 0;
      for (const l of itens) {
        if (l.direcao === "D") {
          saidas += l.valorCentavos;
          continue;
        }
        creditos += l.valorCentavos;
        if (l.classe === "venda_cartao") vendasCartao += l.valorCentavos;
        if (l.classe === "terceiro_pf" || l.classe === "terceiro_pj") {
          pixTerceiros += l.valorCentavos;
        }
        if (CLASSES_EXCLUIDAS_DA_RENDA.has(l.classe)) {
          excluidos[l.classe] = (excluidos[l.classe] ?? 0) + l.valorCentavos;
        }
        if (ehRendaComprovada(l)) renda += l.valorCentavos;
        if (ehRendaComProvaveis(l)) rendaProv += l.valorCentavos;
      }
      return {
        mes,
        creditosBrutosCentavos: creditos,
        excluidos,
        rendaConsideradaCentavos: renda,
        rendaComProvaveisCentavos: rendaProv,
        pixTerceirosCentavos: pixTerceiros,
        vendasCartaoCentavos: vendasCartao,
        saidasCentavos: saidas,
        cobertura: coberturaPorMes.get(mes) ?? "parcial",
        pagadoresRecorrentes: pagadoresDoMes(itens, vezesPorMascara),
        entradasPorFonte: somarPorFonte(itens, "C"),
        saidasPorFonte: somarPorFonte(itens, "D"),
      };
    });

  const volumePropriasCentavos = lancamentos
    .filter((l) => l.classe === "propria")
    .reduce((a, l) => a + l.valorCentavos, 0);
  const volumeConjugeCentavos = lancamentos
    .filter((l) => l.classe === "conjuge")
    .reduce((a, l) => a + l.valorCentavos, 0);
  const volumeFamiliarCentavos = lancamentos
    .filter((l) => l.classe === "familiar" || l.classe === "conjuge")
    .reduce((a, l) => a + l.valorCentavos, 0);
  const volumeFamiliarProvavelCentavos = lancamentos
    .filter((l) => l.classe === "familiar_provavel")
    .reduce((a, l) => a + l.valorCentavos, 0);
  const volumePixTerceirosCentavos = linhas.reduce((a, l) => a + l.pixTerceirosCentavos, 0);
  const volumeVendasCartaoCentavos = linhas.reduce((a, l) => a + l.vendasCartaoCentavos, 0);
  const familiaresProvaveis = listarFamiliaresProvaveis(lancamentos);
  const recorrenciaPagadores = recorrenciaDePagadores(lancamentos);

  const completos = linhas.filter((l) => l.cobertura === "completo");
  let motivoSemRenda: MotivoSemRenda | null = null;
  let rendaComprovadaCentavos: number | null = null;
  let rendaComProvaveisCentavos: number | null = null;

  if (opcoes.paginasFaltando) {
    avisos.push("Página faltando: a renda do período incompleto não é estimada.");
    motivoSemRenda = "pagina_faltando";
  } else if (completos.length > 0) {
    rendaComprovadaCentavos = mediaCompletos(linhas, "renda");
    rendaComProvaveisCentavos = mediaCompletos(linhas, "comProvaveis");
    if (rendaComprovadaCentavos === 0) {
      rendaComprovadaCentavos = null;
      motivoSemRenda = "so_negocio";
      avisos.push(
        "Créditos do extrato, após exclusões (próprias, familiares, resgates, estornos, empréstimos), não identificam renda. Não estime.",
      );
    }
    if (rendaComProvaveisCentavos === 0) rendaComProvaveisCentavos = null;
  } else if (linhas.length > 0) {
    avisos.push("Só há mês parcial. Não estime a renda a partir de cobertura incompleta.");
  }

  if (volumePropriasCentavos > 0) {
    avisos.push(
      `Autotransferências do titular: ${formatarReais(volumePropriasCentavos)} (descontadas da renda).`,
    );
  }
  if (volumeFamiliarCentavos > 0) {
    avisos.push(
      `Transferências de familiares diretos (cônjuge/pais/filhos/tios): ${formatarReais(volumeFamiliarCentavos)} (descontadas da renda).`,
    );
  }
  if (familiaresProvaveis.length > 0) {
    const lista = familiaresProvaveis
      .map((f) => `${f.mascara} ${formatarReais(f.totalCentavos)} (${rotuloMotivo(f.motivo)})`)
      .join("; ");
    avisos.push(`familiar provável — conferir: ${lista}.`);
  }
  if (volumePixTerceirosCentavos > 0) {
    avisos.push(
      `PIX/TED de terceiros (entram na comprovada, inclusive avulsos): ${formatarReais(volumePixTerceirosCentavos)}.`,
    );
  }
  if (volumeVendasCartaoCentavos > 0) {
    avisos.push(
      `Vendas no cartão/maquininha (recebimento de clientes; entram na comprovada): ${formatarReais(volumeVendasCartaoCentavos)}.`,
    );
  }

  if (opcoes.periodo?.inicio && opcoes.periodo.fim) {
    avisos.push(`Período declarado no extrato: ${opcoes.periodo.inicio} a ${opcoes.periodo.fim}.`);
  }

  const despesasFixas = somarPorFonte(
    lancamentos.filter((l) => l.direcao === "D" && DESPESA_FIXA.test(l.descricao)),
    "D",
  );
  const medianaCredito = mediana(
    lancamentos.filter((l) => l.direcao === "C").map((l) => l.valorCentavos),
  );
  const atipicas = somarPorFonte(
    lancamentos.filter(
      (l) => l.direcao === "C" && medianaCredito > 0 && l.valorCentavos >= medianaCredito * 3,
    ),
    "C",
  );

  return {
    linhas,
    rendaComprovadaCentavos,
    rendaComProvaveisCentavos,
    motivoSemRenda,
    volumePropriasCentavos,
    volumeConjugeCentavos,
    volumeFamiliarCentavos,
    volumeFamiliarProvavelCentavos,
    volumePixTerceirosCentavos,
    volumeVendasCartaoCentavos,
    aluguelAtual: detectarAluguelAtual(lancamentos),
    despesasFixas,
    atipicas,
    recorrenciaPagadores,
    familiaresProvaveis,
    avisos,
  };
}

function mediana(valores: number[]): number {
  if (valores.length === 0) return 0;
  const o = [...valores].sort((a, b) => a - b);
  return o[Math.floor(o.length / 2)] ?? 0;
}

function rotuloCobertura(c: CoberturaDoMes): string {
  if (c === "completo") return "mês completo";
  if (c === "incompleto_pagina") return "incompleto (página faltando)";
  return "mês parcial";
}

function rotuloMotivo(motivo: FamiliarProvavel["motivo"]): string {
  if (motivo === "sobrenome_comum") return "sobrenome frequente";
  if (motivo === "nome_parcial") return "nome parcial";
  if (motivo === "sobrenome") return "sobrenome em comum";
  return motivo;
}

function excluidosTexto(excluidos: LinhaMensal["excluidos"]): string {
  const partes = (Object.entries(excluidos) as [ClasseLancamento, number][])
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${ROTULO_CLASSE[k]} ${formatarReais(v)}`);
  return partes.length > 0 ? partes.join("; ") : "nenhum";
}

function textoRecorrencia(p: RecorrenciaPagador): string {
  const porMes = p.porMes.map((m) => `${m.mes} ${formatarReais(m.totalCentavos)}`).join(", ");
  return `${p.mascara} (${p.meses.length} mês(es), ${p.lancamentos} lanç., total ${formatarReais(p.totalCentavos)}; ${porMes})`;
}

export function textoDoResumoParaIa(resumo: ResumoMensal, paginasPdf: number | null): string {
  const cabeca = [
    "TABELA MENSAL CALCULADA PELO SISTEMA (use estes números; não some o texto bruto do extrato).",
    "Renda comprovada = créditos de terceiros (PIX/TED, inclusive avulsos) + salário/pró-labore/holerite + vendas no cartão/maquininha.",
    "Saem, com volume à parte: próprias (mesmo CPF/nome); familiares diretos (ficha ou parentesco); poupança/resgates/aplicações/Rende Fácil; estornos; empréstimos.",
    "Só sobrenome em comum, sobrenome frequente ou nome parcial: lista 'familiar provável — conferir'; saem da comprovada e entram na renda COM prováveis.",
    "O valor declarado na conversa NÃO é comprovado.",
  ];
  if (paginasPdf != null) cabeca.push(`Páginas do PDF: ${paginasPdf}.`);
  const linhas = resumo.linhas.map((l) => {
    const pagadores =
      l.pagadoresRecorrentes.length > 0
        ? ` maiores entrantes: ${l.pagadoresRecorrentes.map((p) => `${p.mascara} (${p.meses} meses, ${p.lancamentos} lanç., ${formatarReais(p.totalCentavos)})`).join(", ")}`
        : "";
    const balanco = ` entradas ${formatarReais(l.creditosBrutosCentavos)} / saídas ${formatarReais(l.saidasCentavos)}`;
    const cartao =
      l.vendasCartaoCentavos > 0 ? `; vendas cartão ${formatarReais(l.vendasCartaoCentavos)}` : "";
    return `${l.mes}: créditos ${formatarReais(l.creditosBrutosCentavos)}; excluídos ${excluidosTexto(l.excluidos)}; renda considerada ${formatarReais(l.rendaConsideradaCentavos)}; renda com prováveis ${formatarReais(l.rendaComProvaveisCentavos)}; PIX/TED terceiros ${formatarReais(l.pixTerceirosCentavos)}${cartao}; cobertura ${rotuloCobertura(l.cobertura)};${balanco}.${pagadores}`;
  });
  const comprovada =
    resumo.rendaComprovadaCentavos != null
      ? `Renda comprovada (média dos meses completos, sem familiares prováveis): ${formatarReais(resumo.rendaComprovadaCentavos)}.`
      : `Sem renda comprovada. ${resumo.motivoSemRenda === "so_negocio" ? "Após exclusões, não há renda identificável." : resumo.motivoSemRenda === "pagina_faltando" ? "Página faltando." : "Extrato insuficiente para comprovar."} Não estime.`;
  const comProv =
    resumo.rendaComProvaveisCentavos != null &&
    resumo.rendaComProvaveisCentavos !== resumo.rendaComprovadaCentavos
      ? `Renda com familiares prováveis (se o analista reconsiderar): ${formatarReais(resumo.rendaComProvaveisCentavos)}.`
      : "";
  const recorrencia =
    resumo.recorrenciaPagadores.length > 0
      ? `Recorrência por pagador: ${resumo.recorrenciaPagadores.map(textoRecorrencia).join("; ")}.`
      : "";
  const provaveis =
    resumo.familiaresProvaveis.length > 0
      ? `familiar provável — conferir: ${resumo.familiaresProvaveis.map((f) => `${f.mascara} ${formatarReais(f.totalCentavos)} (${rotuloMotivo(f.motivo)})`).join("; ")}.`
      : "";
  const aviso = resumo.avisos.map((a) => `Aviso: ${a}`).join("\n");
  return mascararCpfNoTexto(
    [
      cabeca.join(" "),
      ...linhas,
      comprovada,
      comProv,
      recorrencia,
      provaveis,
      `Aluguel atual: ${resumo.aluguelAtual.recado}`,
      aviso,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}
