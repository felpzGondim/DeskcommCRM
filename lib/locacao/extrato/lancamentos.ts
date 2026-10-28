/**
 * Lê lançamentos de um extrato em texto (layout Stone e genérico C/D).
 * Confere saldo entre páginas para detectar página faltando.
 */
import { valoresNaLinha } from "./dinheiro";
import { cpfDe, dataBrValida } from "./texto";
import type { DirecaoLancamento, Lancamento, LeituraDeExtrato, TitularDoExtrato } from "./tipos";

const MARCA_STONE = /stone institui|conta stone|banco stone|stone ip s\.?a/i;
const MARCA_EXTRATO =
  /extrato|saldo anterior|lan[cç]amentos|cr[eé]dito|d[eé]bito|pix recebido|pix enviado/i;
const PAGINA_DE = /p[aá]gina\s+(\d+)\s+(?:de|\/)\s+(\d+)/i;
const SALDO_ANTERIOR = /saldo anterior/i;

function pareceLayoutStone(texto: string): boolean {
  return MARCA_STONE.test(texto);
}

export function pareceExtrato(texto: string, nomeArquivo?: string | null): boolean {
  if (nomeArquivo && /extrato/i.test(nomeArquivo)) return true;
  if (pareceLayoutStone(texto)) return true;
  const datas = texto.match(/\b\d{2}\/\d{2}\/\d{2,4}\b/g) ?? [];
  return datas.length >= 5 && MARCA_EXTRATO.test(texto);
}

function titularDoCabecalho(texto: string): TitularDoExtrato {
  const cabeca = texto.slice(0, 2500);
  const nomeLinha = cabeca.match(
    /\btitular\s*[:\-]\s*([A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇa-záéíóúâêôãõç .]{2,80})/i,
  );
  const nome = nomeLinha?.[1]?.replace(/\s+/g, " ").trim() ?? null;
  return { nome, cpfDigits: cpfDe(cabeca) };
}

function periodoDoCabecalho(texto: string): { inicio: string | null; fim: string | null } {
  const cabeca = texto.slice(0, 2500);
  const m = cabeca.match(
    /(?:per[ií]odo|de)\s+(\d{2}\/\d{2}\/\d{2,4})\s*(?:a|at[eé]|–|-)\s*(\d{2}\/\d{2}\/\d{2,4})/i,
  );
  return {
    inicio: m?.[1] ? dataBrValida(m[1]) : null,
    fim: m?.[2] ? dataBrValida(m[2]) : null,
  };
}

function paginasDeclaradas(texto: string): { vistas: Set<number>; total: number | null } {
  const vistas = new Set<number>();
  let total: number | null = null;
  for (const m of texto.matchAll(new RegExp(PAGINA_DE.source, "gi"))) {
    const n = Number(m[1]);
    const t = Number(m[2]);
    if (Number.isInteger(n) && n > 0) vistas.add(n);
    if (Number.isInteger(t) && t > 0) total = Math.max(total ?? 0, t);
  }
  return { vistas, total };
}

function direcaoNaLinha(linha: string): DirecaoLancamento | null {
  const sufixo = linha.match(/(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})\s*([CD])\b/i);
  if (sufixo?.[2]) return sufixo[2].toUpperCase() as DirecaoLancamento;
  const prefixo = linha.match(/\b([CD])\s+(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})/i);
  if (prefixo?.[1]) return prefixo[1].toUpperCase() as DirecaoLancamento;
  if (/\bcr[eé]dito\b/i.test(linha) && !/\bd[eé]bito\b/i.test(linha)) return "C";
  if (/\bd[eé]bito\b/i.test(linha) && !/\bcr[eé]dito\b/i.test(linha)) return "D";
  if (/\b(?:pix recebido|ted recebida|doc recebido|dep[oó]sito|proventos)\b/i.test(linha))
    return "C";
  if (/\b(?:pix enviado|ted enviada|pagamento|tarif)\b/i.test(linha)) return "D";
  return null;
}

function descricaoSemValores(linha: string, data: string): string {
  return linha
    .replace(data, " ")
    .replace(/(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})\s*[CD]?\b/gi, " ")
    .replace(/\b[CD]\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contraparteDe(descricao: string): string | null {
  const semPrefixo = descricao
    .replace(/^(?:pix|ted|doc|tef|tev)\s+(?:recebido|enviado|recebida|enviada|de|para)?\s*/i, "")
    .replace(/^(?:transf(?:erencia)?(?:\s+entre\s+contas)?)\s*/i, "")
    .replace(/^[-:–]\s*/, "")
    .trim();
  if (semPrefixo.length < 3) return null;
  return semPrefixo.slice(0, 80);
}

function lancamentoDeLinha(linha: string, pagina: number | null): Lancamento | null {
  const dataMatch = linha.match(/\b(\d{2}\/\d{2}\/\d{2,4})\b/);
  if (!dataMatch?.[1]) return null;
  const data = dataBrValida(dataMatch[1]);
  if (!data) return null;
  if (SALDO_ANTERIOR.test(linha)) return null;
  const valores = valoresNaLinha(linha);
  if (valores.length === 0) return null;
  const direcao = direcaoNaLinha(linha);
  if (!direcao) return null;
  const valorCentavos = valores[0];
  if (valorCentavos == null || valorCentavos === 0) return null;
  const saldoCentavos = valores.length >= 2 ? (valores[valores.length - 1] ?? null) : null;
  const descricao = descricaoSemValores(linha, dataMatch[1]);
  if (descricao.length < 2) return null;
  return {
    data,
    descricao: descricao.slice(0, 180),
    valorCentavos,
    direcao,
    saldoCentavos: saldoCentavos === valorCentavos && valores.length === 1 ? null : saldoCentavos,
    pagina,
    contraparte: contraparteDe(descricao),
  };
}

function completarLinhaQuebrada(linhas: string[]): string[] {
  const saida: string[] = [];
  for (let i = 0; i < linhas.length; i++) {
    const atual = linhas[i]?.trim() ?? "";
    if (!atual) continue;
    const temData = /\b\d{2}\/\d{2}\/\d{2,4}\b/.test(atual);
    const temValor = /(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})/.test(atual);
    if (temData && !temValor && i + 1 < linhas.length) {
      const proxima = linhas[i + 1]?.trim() ?? "";
      if (
        proxima &&
        !/\b\d{2}\/\d{2}\/\d{2,4}\b/.test(proxima) &&
        /(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})/.test(proxima)
      ) {
        saida.push(`${atual} ${proxima}`);
        i += 1;
        continue;
      }
    }
    saida.push(atual);
  }
  return saida;
}

function paginasDoTexto(texto: string): { texto: string; pagina: number | null }[] {
  const blocos = texto.split(/\n{2,}/);
  if (blocos.length <= 1) {
    return [{ texto, pagina: 1 }];
  }
  return blocos.map((bloco, i) => {
    const m = bloco.match(PAGINA_DE);
    return { texto: bloco, pagina: m?.[1] ? Number(m[1]) : i + 1 };
  });
}

function saldoInconsistente(lancamentos: readonly Lancamento[]): boolean {
  let anterior: Lancamento | null = null;
  for (const atual of lancamentos) {
    if (anterior?.saldoCentavos != null && atual.saldoCentavos != null) {
      const delta = atual.direcao === "C" ? atual.valorCentavos : -atual.valorCentavos;
      const esperado = anterior.saldoCentavos + delta;
      if (Math.abs(esperado - atual.saldoCentavos) > 1) {
        const paginaMudou =
          anterior.pagina != null && atual.pagina != null && atual.pagina !== anterior.pagina;
        if (paginaMudou || atual.pagina !== anterior.pagina) return true;
      }
    }
    anterior = atual;
  }
  return false;
}

function paginasFaltandoPorNumeracao(
  vistas: Set<number>,
  total: number | null,
  paginasPdf: number | null,
): boolean {
  const teto = total ?? paginasPdf;
  if (teto != null && teto > 0) {
    if (vistas.size > 0 && vistas.size < teto) return true;
    for (let i = 1; i <= teto; i++) {
      if (vistas.size > 0 && !vistas.has(i) && i <= Math.max(...vistas)) return true;
    }
  }
  return false;
}

export function lerLancamentos(
  texto: string,
  opcoes: { paginasPdf?: number | null; nomeArquivo?: string | null } = {},
): LeituraDeExtrato {
  const avisos: string[] = [];
  const layout = pareceLayoutStone(texto)
    ? "stone"
    : pareceExtrato(texto, opcoes.nomeArquivo)
      ? "generico"
      : "desconhecido";
  const titular = titularDoCabecalho(texto);
  const periodo = periodoDoCabecalho(texto);
  const declaradas = paginasDeclaradas(texto);
  const blocos = paginasDoTexto(texto);
  const lancamentos: Lancamento[] = [];
  const vistas = new Set<number>(declaradas.vistas);

  for (const bloco of blocos) {
    if (bloco.pagina != null) vistas.add(bloco.pagina);
    const linhas = completarLinhaQuebrada(bloco.texto.split(/\n/));
    for (const linha of linhas) {
      const l = lancamentoDeLinha(linha, bloco.pagina);
      if (l) lancamentos.push(l);
    }
  }

  const saldoQuebra = saldoInconsistente(lancamentos);
  const numeracaoQuebra = paginasFaltandoPorNumeracao(
    vistas,
    declaradas.total,
    opcoes.paginasPdf ?? null,
  );
  const paginasFaltando = saldoQuebra || numeracaoQuebra;
  if (paginasFaltando) {
    avisos.push(
      "Página faltando ou saldo inconsistente entre páginas. Não trate o extrato como completo.",
    );
  }
  const layoutFinal = layout === "desconhecido" && lancamentos.length >= 3 ? "generico" : layout;

  return {
    pareceExtrato: layoutFinal !== "desconhecido" || lancamentos.length >= 3,
    layout: layoutFinal,
    titular,
    periodo,
    paginasDeclaradas: declaradas.total,
    paginasVistas: Math.max(vistas.size, blocos.length),
    paginasFaltando,
    lancamentos,
    avisos,
  };
}
