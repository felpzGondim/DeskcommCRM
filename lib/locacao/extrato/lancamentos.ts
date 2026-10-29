/**
 * Lê lançamentos de um extrato em texto.
 *
 * O leitor Stone é atalho: a análise não depende dele. Extrato de qualquer
 * banco/fintech cai no parser genérico e, se o saldo não fechar, na extração
 * por IA (`extrair-ia.ts`). Confere saldo entre páginas para detectar falta.
 */
import { lerCentavos, valoresNaLinha } from "./dinheiro";
import { conferirSaldo } from "./saldo";
import { cpfDe, dataBrValida } from "./texto";
import type { DirecaoLancamento, Lancamento, LeituraDeExtrato, TitularDoExtrato } from "./tipos";

/** Blocos menores: 2–3 páginas cabem na saída da IA sem cortar o JSON. */
export const PAGINAS_POR_LOTE_EXTRACAO = 3;
export const CHARS_POR_LOTE_EXTRACAO = 8_000;

const MARCA_STONE = /stone institui|conta stone|banco stone|stone ip s\.?a/i;
const MARCA_EXTRATO =
  /extrato|saldo anterior|lan[cç]amentos|cr[eé]dito|d[eé]bito|pix recebido|pix enviado/i;
const PAGINA_DE = /p[aá]gina\s+(\d+)\s+(?:de|\/)\s+(\d+)/i;
const SALDO_ANTERIOR = /saldo anterior/i;
const INICIO_LANCAMENTO = /^\s*(\d{2}\/\d{2}\/\d{2,4})\b/;
const CABECALHO_COLUNAS = /^\s*DATA\s+TIPO\b/i;

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
  const nomeBloco = cabeca.match(
    /\bNome\s*[:\-]?\s*\n+\s*([A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇa-záéíóúâêôãõç .]{2,80})/i,
  );
  const nome = (nomeLinha?.[1] ?? nomeBloco?.[1])?.replace(/\s+/g, " ").trim() ?? null;
  const docBloco = cabeca.match(/\bDocumento\s*[:\-]?\s*\n+\s*([\d.\-\/\s]{11,22})/i);
  return { nome, cpfDigits: cpfDe(cabeca) ?? (docBloco?.[1] ? cpfDe(docBloco[1]) : null) };
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
  if (/\bentrada\b/i.test(linha) && !/\bsa[ií]da\b/i.test(linha)) return "C";
  if (/\bsa[ií]da\b/i.test(linha)) return "D";
  if (/-\s*R\$/i.test(linha)) return "D";
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
    .replace(/\b(?:entrada|sa[ií]da)\b/gi, " ")
    .replace(/R\$/gi, " ")
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

function ehRuidoDePagina(linha: string): boolean {
  const t = linha.trim();
  if (!t) return true;
  if (PAGINA_DE.test(t) && t.length < 40) return true;
  if (CABECALHO_COLUNAS.test(t)) return true;
  return false;
}

function temValorESaldoNaLinha(linha: string): boolean {
  return valoresNaLinha(linha).length >= 2 || /-\s*R\$/i.test(linha);
}

/**
 * Atalho Stone: cada lançamento ocupa 2–5 linhas (data+Entrada/Saída … até
 * `R$ valor R$ saldo`). Junta o bloco numa linha que o parser genérico lê.
 */
function completarBlocosStone(linhas: string[]): string[] {
  const saida: string[] = [];
  let i = 0;
  while (i < linhas.length) {
    const t = (linhas[i] ?? "").trim();
    if (ehRuidoDePagina(t)) {
      i += 1;
      continue;
    }
    if (INICIO_LANCAMENTO.test(t)) {
      const partes = [t];
      const jaCompleto = valoresNaLinha(t).length >= 1 && direcaoNaLinha(t) != null;
      if (jaCompleto) {
        saida.push(partes.join(" "));
        i += 1;
        continue;
      }
      i += 1;
      while (i < linhas.length && partes.length < 6) {
        const n = (linhas[i] ?? "").trim();
        if (INICIO_LANCAMENTO.test(n)) break;
        if (ehRuidoDePagina(n) && !temValorESaldoNaLinha(n)) {
          i += 1;
          continue;
        }
        if (n) partes.push(n);
        i += 1;
        if (temValorESaldoNaLinha(n)) break;
      }
      saida.push(partes.join(" "));
      continue;
    }
    if (t) saida.push(t);
    i += 1;
  }
  return saida;
}

export function paginasDoTexto(texto: string): { texto: string; pagina: number | null }[] {
  if (texto.includes("\f")) {
    return texto
      .split("\f")
      .filter((bloco) => bloco.trim())
      .map((bloco, i) => {
        const m = bloco.match(PAGINA_DE);
        return { texto: bloco, pagina: m?.[1] ? Number(m[1]) : i + 1 };
      });
  }
  const comMarcador = texto.split(new RegExp(`(?=${PAGINA_DE.source})`, "i"));
  const marcadas = comMarcador.filter((bloco) => PAGINA_DE.test(bloco));
  if (marcadas.length >= 2) {
    const preambulo = comMarcador[0] && !PAGINA_DE.test(comMarcador[0]) ? comMarcador[0] : "";
    const corpo = comMarcador.filter((bloco) => PAGINA_DE.test(bloco));
    if (preambulo.trim() && corpo[0]) {
      corpo[0] = `${preambulo.trim()}\n${corpo[0]}`;
    }
    return corpo.map((bloco, i) => {
      const m = bloco.match(PAGINA_DE);
      return { texto: bloco, pagina: m?.[1] ? Number(m[1]) : i + 1 };
    });
  }
  const blocos = texto.split(/\n{2,}/);
  if (blocos.length <= 1) {
    return [{ texto, pagina: 1 }];
  }
  return blocos.map((bloco, i) => {
    const m = bloco.match(PAGINA_DE);
    return { texto: bloco, pagina: m?.[1] ? Number(m[1]) : i + 1 };
  });
}

/** Lotes de páginas para a extração por IA, sem cortar no meio de uma página. */
export function lotesDePaginas(
  texto: string,
  opcoes: { paginasPorLote?: number; charsPorLote?: number } = {},
): string[] {
  const paginasPorLote = opcoes.paginasPorLote ?? PAGINAS_POR_LOTE_EXTRACAO;
  const charsPorLote = opcoes.charsPorLote ?? CHARS_POR_LOTE_EXTRACAO;
  const paginas = paginasDoTexto(texto);
  const lotes: string[] = [];
  let atual: string[] = [];
  let chars = 0;
  for (const p of paginas) {
    const caberia = atual.length >= paginasPorLote || chars + p.texto.length > charsPorLote;
    if (caberia && atual.length > 0) {
      lotes.push(atual.join("\n\n"));
      atual = [];
      chars = 0;
    }
    atual.push(p.texto);
    chars += p.texto.length;
  }
  if (atual.length > 0) lotes.push(atual.join("\n\n"));
  return lotes.length > 0 ? lotes : [texto];
}

/** Parte um lote ao meio (páginas, senão na quebra de linha) para retry após corte. */
export function dividirLoteAoMeio(texto: string): [string, string] | null {
  const paginas = paginasDoTexto(texto);
  if (paginas.length >= 2) {
    const meio = Math.ceil(paginas.length / 2);
    const a = paginas
      .slice(0, meio)
      .map((p) => p.texto)
      .join("\n\n");
    const b = paginas
      .slice(meio)
      .map((p) => p.texto)
      .join("\n\n");
    if (a.trim() && b.trim()) return [a, b];
  }
  const corte = texto.lastIndexOf("\n", Math.floor(texto.length / 2));
  if (corte < 80) return null;
  const a = texto.slice(0, corte);
  const b = texto.slice(corte + 1);
  if (!a.trim() || !b.trim()) return null;
  return [a, b];
}

function saldoAnteriorDoTexto(texto: string): number | null {
  const m = texto.match(/saldo anterior[^\d]*(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})/i);
  return m?.[1] ? lerCentavos(m[1]) : null;
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
    const brutas = bloco.texto.split(/\n/);
    const linhas =
      layout === "stone" ? completarBlocosStone(brutas) : completarLinhaQuebrada(brutas);
    for (const linha of linhas) {
      const l = lancamentoDeLinha(linha, bloco.pagina);
      if (l) lancamentos.push(l);
    }
  }

  if (layout === "stone" && lancamentos.length === 0) {
    for (const bloco of blocos) {
      const linhas = completarLinhaQuebrada(bloco.texto.split(/\n/));
      for (const linha of linhas) {
        const l = lancamentoDeLinha(linha, bloco.pagina);
        if (l) lancamentos.push(l);
      }
    }
  }

  const saldoAnteriorCentavos = saldoAnteriorDoTexto(texto);
  const conferencia = conferirSaldo(lancamentos, { saldoAnteriorCentavos, periodo });
  const saldoQuebra = saldoInconsistente(lancamentos) || (conferencia.conferido && !conferencia.fecha);
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
    saldoAnteriorCentavos,
    conferencia,
    lancamentos,
    avisos,
  };
}
