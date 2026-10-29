/**
 * Diligência de aluguel atual: ALUGUEL, imobiliária, PIX/TED recorrentes
 * do mesmo valor ao mesmo destinatário. Se não achar, declara.
 */
import { mascararPagador, mesDe, normalizarNome } from "./texto";
import type { AluguelAtualDetectado, LancamentoClassificado } from "./tipos";

const MARCA_ALUGUEL = /\bALUGUEL\b|\bALUGUER\b|\bLOCA[CÇ][AÃ]O\b/i;
const MARCA_IMOB =
  /\bIMOBILI[AÁ]RIA\b|\bADM(?:INISTRADORA)?\s+DE\s+IM[OÓ]VEIS\b|\bLOCADORA\b|\bCONDOMINIO\b/i;

function chaveDestino(l: LancamentoClassificado): string {
  return (l.contraparte ?? l.descricao).slice(0, 80);
}

export function detectarAluguelAtual(
  lancamentos: readonly LancamentoClassificado[],
): AluguelAtualDetectado {
  const saidas = lancamentos.filter((l) => l.direcao === "D");
  const porPalavra = saidas.filter(
    (l) => MARCA_ALUGUEL.test(l.descricao) || MARCA_IMOB.test(l.descricao),
  );
  if (porPalavra.length > 0) {
    const meses = new Set(porPalavra.map((l) => mesDe(l.data)).filter(Boolean));
    const soma = porPalavra.reduce((a, l) => a + l.valorCentavos, 0);
    const media = Math.round(soma / porPalavra.length);
    return {
      encontrado: true,
      valorCentavos: media,
      meses: meses.size,
      mascara: mascararPagador(chaveDestino(porPalavra[0]!)),
      recado: `Aluguel atual identificado: média ${media / 100} em ${meses.size} mês(es).`,
    };
  }

  const porChave = new Map<string, LancamentoClassificado[]>();
  for (const l of saidas) {
    const k = `${normalizarNome(chaveDestino(l))}|${l.valorCentavos}`;
    const lista = porChave.get(k) ?? [];
    lista.push(l);
    porChave.set(k, lista);
  }
  let melhor: LancamentoClassificado[] = [];
  for (const lista of porChave.values()) {
    const meses = new Set(lista.map((l) => mesDe(l.data)).filter(Boolean));
    if (meses.size >= 2 && lista.length > melhor.length) melhor = lista;
  }
  if (melhor.length >= 2) {
    const valor = melhor[0]!.valorCentavos;
    const meses = new Set(melhor.map((l) => mesDe(l.data)).filter(Boolean)).size;
    return {
      encontrado: true,
      valorCentavos: valor,
      meses,
      mascara: mascararPagador(chaveDestino(melhor[0]!)),
      recado: `Aluguel atual identificado por recorrência de mesmo valor (${meses} meses).`,
    };
  }

  return {
    encontrado: false,
    valorCentavos: null,
    meses: 0,
    mascara: null,
    recado:
      "Não foi possível identificar o pagamento de aluguel nos documentos fornecidos.",
  };
}
