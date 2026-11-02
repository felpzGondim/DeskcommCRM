/**
 * Superlógica confronta a ficha; não sobrescreve valor já preenchido.
 * Decisão do Felipe (01/11 10:12, reafirmado 19:36): só sinaliza
 * divergência. Campo vazio da ficha pode receber Superlógica com
 * origem "superlogica". Endereço/CEP nunca são gravados da Superlógica.
 */
import { normalizarLogradouro, soDigitosCep } from "@/lib/locacao/endereco";

import { formatarReais } from "./dinheiro";

export const CAMPOS_DE_DIVERGENCIA = [
  "aluguel",
  "condominio",
  "iptu",
  "seguro_incendio",
  "endereco",
  "cep",
] as const;

export type CampoDeDivergencia = (typeof CAMPOS_DE_DIVERGENCIA)[number];

export type DivergenciaDoPacote = {
  campo: CampoDeDivergencia;
  aviso: string;
};

export const PREFIXO_DIVERGENCIA: Record<CampoDeDivergencia, string> = {
  aluguel: "Aluguel diverge",
  condominio: "Condomínio diverge",
  iptu: "IPTU diverge",
  seguro_incendio: "Seguro-incêndio diverge",
  endereco: "Endereço diverge",
  cep: "CEP diverge",
};

const ROTULO_FICHA = "ficha";
const ROTULO_SUPERLOGICA = "Superlógica";

export function valorNumericoPreenchido(v: number | null | undefined): v is number {
  return v != null && Number.isFinite(v);
}

export function textoEnderecoParaConfronto(partes: {
  logradouro?: string | null;
  numero?: string | null;
  endereco?: string | null;
}): string | null {
  if (partes.endereco?.trim()) return partes.endereco.trim();
  const t = [partes.logradouro, partes.numero]
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean)
    .join(", ");
  return t || null;
}

export function divergenciaDeCentavos(
  campo: Exclude<CampoDeDivergencia, "endereco" | "cep">,
  fichaCentavos: number | null | undefined,
  superlogicaCentavos: number | null | undefined,
): DivergenciaDoPacote | null {
  if (!valorNumericoPreenchido(fichaCentavos) || !valorNumericoPreenchido(superlogicaCentavos)) {
    return null;
  }
  if (Math.round(fichaCentavos) === Math.round(superlogicaCentavos)) return null;
  return {
    campo,
    aviso: [
      PREFIXO_DIVERGENCIA[campo],
      ": ",
      ROTULO_FICHA,
      " ",
      formatarReais(fichaCentavos),
      " × ",
      ROTULO_SUPERLOGICA,
      " ",
      formatarReais(superlogicaCentavos),
      ".",
    ].join(""),
  };
}

export function divergenciaDeEndereco(
  ficha: string | null | undefined,
  superlogica: string | null | undefined,
): DivergenciaDoPacote | null {
  const a = typeof ficha === "string" ? ficha.trim() : "";
  const b = typeof superlogica === "string" ? superlogica.trim() : "";
  if (!a || !b) return null;
  if (normalizarLogradouro(a) === normalizarLogradouro(b)) return null;
  return {
    campo: "endereco",
    aviso: truncarAviso(
      `${PREFIXO_DIVERGENCIA.endereco}: ${ROTULO_FICHA} ${a} × ${ROTULO_SUPERLOGICA} ${b}.`,
    ),
  };
}

export function divergenciaDeCep(
  ficha: string | null | undefined,
  superlogica: string | null | undefined,
): DivergenciaDoPacote | null {
  const a = soDigitosCep(ficha);
  const b = soDigitosCep(superlogica);
  if (!a || !b || a === b) return null;
  return {
    campo: "cep",
    aviso: `${PREFIXO_DIVERGENCIA.cep}: ${ROTULO_FICHA} ${formatarCep(a)} × ${ROTULO_SUPERLOGICA} ${formatarCep(b)}.`,
  };
}

export function avisoDoCampoNasPendencias(
  pendencias: readonly string[] | null | undefined,
  campo: CampoDeDivergencia,
): string | undefined {
  const prefixo = PREFIXO_DIVERGENCIA[campo];
  return pendencias?.find((p) => p.startsWith(prefixo));
}

function formatarCep(digitos: string): string {
  return `${digitos.slice(0, 5)}-${digitos.slice(5)}`;
}

function truncarAviso(texto: string): string {
  if (texto.length <= 180) return texto;
  return `${texto.slice(0, 179)}…`;
}
