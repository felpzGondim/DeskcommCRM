/**
 * Cópia fiel da `chave_telefone()` do Hub: DDD + 8 últimos dígitos.
 * As duas pontas precisam dar a mesma chave. Sem dado pessoal — só dígitos.
 *
 * Padrão sujeito à revisão do Felipe (Fase 3.5, pergunta 4 = a): número sem
 * DDD vale como DDD 11, mas o casamento vai para revisão (`ddd_presumido`).
 */
import type { QualidadeDoVinculo } from "@/lib/locacao/vocabulario";

export const DDD_PRESUMIDO = "11";

export interface ChaveDeTelefone {
  readonly chave: string;
  readonly ddd: string;
  readonly oito: string;
  readonly nove: string | null;
  readonly dddPresumido: boolean;
}

const DDD_OK = /^[1-9][1-9]$/;

export function soDigitos(bruto: string): string {
  return bruto.replace(/\D+/g, "");
}

/**
 * Um campo da Superlógica pode trazer vários números ("11 9999-0000; 11 3333-4444").
 * Separa por `; , / |` e as palavras `e` / `ou`.
 */
export function separarNumeros(bruto: string): string[] {
  return bruto
    .split(/\s*(?:[;,/|]| e | ou )\s*/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export function chaveTelefone(bruto: string): ChaveDeTelefone | null {
  let d = soDigitos(bruto);
  if (!d) return null;
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  if (d.startsWith("0")) {
    d = d.slice(1);
    if (d.length >= 12) d = d.slice(2);
  }
  let dddPresumido = false;
  if (d.length === 8 || d.length === 9) {
    d = DDD_PRESUMIDO + d;
    dddPresumido = true;
  }
  if (d.length !== 10 && d.length !== 11) return null;
  const ddd = d.slice(0, 2);
  const local = d.slice(2);
  if (!DDD_OK.test(ddd)) return null;
  if (local.length === 9 && !local.startsWith("9")) return null;
  const oito = local.slice(-8);
  const nove = local.length === 9 ? local : null;
  return { chave: `${ddd}${oito}`, ddd, oito, nove, dddPresumido };
}

export function qualidadeDoCasamento(
  crm: ChaveDeTelefone,
  superlogica: ChaveDeTelefone,
): QualidadeDoVinculo | null {
  if (crm.chave !== superlogica.chave) return null;
  if (superlogica.dddPresumido || crm.dddPresumido) return "ddd_presumido";
  const umTemNove = (crm.nove === null) !== (superlogica.nove === null);
  if (umTemNove) return "sem_9";
  return "exato";
}

export function contatoForaDoCasamento(input: {
  phone?: string | null;
  isGroup?: boolean;
  isAnonymized?: boolean;
  isMergedInto?: string | null;
}): boolean {
  if (input.isGroup || input.isAnonymized || input.isMergedInto) return true;
  const p = (input.phone ?? "").trim();
  if (!p) return true;
  const d = soDigitos(p);
  if (!d) return true;
  if (d.startsWith("55")) return false;
  if (d.length <= 11) return false;
  return true;
}
