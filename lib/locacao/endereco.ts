/**
 * Normalização do endereço do imóvel (Fase 3 §2.2). Função pura: a chave
 * `chave_endereco` é a identidade enquanto o imóvel ainda não tem id da
 * Superlógica. Sem dado pessoal — endereço de carteira não é dado de pessoa.
 *
 * Formato: `logradouro|numero|complemento|<cep só dígitos ou vazio>`.
 * CEP entra na chave só se estiver presente; ausência de CEP não diferencia.
 */

const TIPOS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(r\.|r\b|rua)\b/g, "rua"],
  [/\b(av\.|av\b|avenida)\b/g, "avenida"],
  [/\b(al\.|al\b|alameda)\b/g, "alameda"],
  [/\b(trav\.|trav\b|travessa)\b/g, "travessa"],
  [/\b(pç\.|pç\b|praca|praça)\b/g, "praca"],
  [/\b(rod\.|rod\b|rodovia)\b/g, "rodovia"],
  [/\b(est\.|est\b|estrada)\b/g, "estrada"],
];

function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}+/gu, "");
}

function soLetrasNumerosEspaco(texto: string): string {
  return texto.replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

export function normalizarLogradouro(bruto: string): string {
  let s = soLetrasNumerosEspaco(semAcento(bruto).toLowerCase());
  for (const [re, troca] of TIPOS) s = s.replace(re, troca);
  return soLetrasNumerosEspaco(s);
}

/** Número só com dígitos e, se houver, um sufixo de letra. */
export function normalizarNumero(bruto: string): string {
  const s = semAcento(bruto).toLowerCase().trim();
  const m = s.match(/(\d+)\s*-?\s*([a-z])?(?![a-z0-9])/i);
  if (!m) return s.replace(/\D+/g, "");
  return `${m[1]}${m[2] ? m[2].toLowerCase() : ""}`;
}

export function normalizarComplemento(bruto: string): string {
  let s = soLetrasNumerosEspaco(semAcento(bruto).toLowerCase());
  s = s.replace(/\b(apartamento|apto|apt|ap\.|ap)\b/g, "ap");
  s = s.replace(/\b(bloco|bl\.|bl)\b/g, "bl");
  s = s.replace(/\b(casa|cs\.|cs)\b/g, "cs");
  s = s.replace(/\b(sala|sl\.|sl)\b/g, "sl");
  s = s.replace(/\b(fundos|fds)\b/g, "fundos");
  return soLetrasNumerosEspaco(s);
}

export function soDigitosCep(bruto: string | null | undefined): string {
  if (!bruto) return "";
  const d = bruto.replace(/\D+/g, "");
  return d.length === 8 ? d : "";
}

export interface PartesDoEndereco {
  logradouro: string;
  numero?: string | null;
  complemento?: string | null;
  cep?: string | null;
}

export function chaveEndereco(partes: PartesDoEndereco): string {
  const logradouro = normalizarLogradouro(partes.logradouro);
  const numero = normalizarNumero(partes.numero ?? "");
  const complemento = normalizarComplemento(partes.complemento ?? "");
  const cep = soDigitosCep(partes.cep);
  return `${logradouro}|${numero}|${complemento}|${cep}`;
}

/**
 * Compara duas chaves. CEP só diferencia quando os DOIS lados o têm;
 * se um lado está vazio, o CEP é ignorado.
 */
export function enderecosIguais(a: string, b: string): boolean {
  const pa = a.split("|");
  const pb = b.split("|");
  if (pa.length < 4 || pb.length < 4) return a === b;
  const [la, na, ca, cepa] = pa;
  const [lb, nb, cb, cepb] = pb;
  if (la !== lb || na !== nb || ca !== cb) return false;
  if (!cepa || !cepb) return true;
  return cepa === cepb;
}

/** Primeira palavra da rua + número do apto — só para a FC, não é identidade. */
export function codigoFc(partes: PartesDoEndereco): string {
  const rua = normalizarLogradouro(partes.logradouro).split(" ")[0] ?? "";
  const complemento = normalizarComplemento(partes.complemento ?? "");
  const apto = complemento.match(/\bap\s*(\d+[a-z]?)/)?.[1]
    ?? normalizarNumero(partes.numero ?? "");
  return `${rua}${apto}`.slice(0, 40);
}
