/**
 * Normalização interna de nome/CPF para classificar lançamentos.
 * Não loga; o valor original não sai daqui.
 */

const PARTICULAS = new Set(["DE", "DA", "DO", "DOS", "DAS", "E", "DI"]);

export function soDigitos(texto: string): string {
  return texto.replace(/\D/g, "");
}

export function cpfDe(texto: string): string | null {
  const pontuado = texto.match(/\d{3}\.\d{3}\.\d{3}-\d{2}/);
  if (pontuado) {
    const d = soDigitos(pontuado[0]);
    return d.length === 11 ? d : null;
  }
  const n = soDigitos(texto);
  if (n.length === 11) return n;
  return null;
}

export function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "");
}

export function normalizarNome(texto: string): string {
  return semAcento(texto)
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokensDeNome(texto: string): string[] {
  return normalizarNome(texto)
    .split(" ")
    .filter((t) => t.length > 1 && !PARTICULAS.has(t));
}

export function parecePessoaJuridica(texto: string): boolean {
  if (/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/.test(texto)) return true;
  const d = soDigitos(texto);
  if (d.length === 14) return true;
  return /\b(ltda|s\.?\s*a\.?|eireli|mei|me\b|epp|ss\b|associacao|associação|cooperativa|autarquia)\b/i.test(
    texto,
  );
}

export function nomesDoMesmoTitular(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const ta = tokensDeNome(a);
  const tb = tokensDeNome(b);
  if (ta.length === 0 || tb.length === 0) return false;
  if (normalizarNome(a) === normalizarNome(b)) return true;
  if (
    ta.length >= 2 &&
    tb.length >= 2 &&
    ta[0] === tb[0] &&
    ta[ta.length - 1] === tb[tb.length - 1]
  ) {
    return true;
  }
  const na = ta.join(" ");
  const nb = tb.join(" ");
  return na.includes(nb) || nb.includes(na);
}

export function mascararPagador(nome: string): string {
  const tokens = tokensDeNome(nome);
  const primeiro = tokens[0];
  if (!primeiro) return "***";
  const cabeca = primeiro.slice(0, Math.min(4, primeiro.length));
  return `${cabeca}***`;
}

export function mesDe(dataIsoOuBr: string): string | null {
  const br = dataIsoOuBr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}`;
  const iso = dataIsoOuBr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  return null;
}

export function diaDe(dataBr: string): number | null {
  const m = dataBr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  return Number.isInteger(d) && d >= 1 && d <= 31 ? d : null;
}

export function dataBrValida(texto: string): string | null {
  const m = texto.match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  const dd = m[1];
  const mm = m[2];
  let aaaa = m[3];
  if (!dd || !mm || !aaaa) return null;
  if (aaaa.length === 2) aaaa = Number(aaaa) >= 70 ? `19${aaaa}` : `20${aaaa}`;
  const dia = Number(dd);
  const mes = Number(mm);
  const ano = Number(aaaa);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || ano < 1990 || ano > 2100) return null;
  return `${dd}/${mm}/${aaaa}`;
}
