import { formatCentsBRL, parseReaisToCents } from "@/lib/money";

const VALOR_BRL = /(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})/g;

export function lerCentavos(bruto: string): number | null {
  const limpo = bruto.replace(/[R$\s]/gi, "").replace(/^[+-]/, "");
  return parseReaisToCents(limpo, "BRL");
}

export function valoresNaLinha(linha: string): number[] {
  const achados: number[] = [];
  for (const m of linha.matchAll(VALOR_BRL)) {
    const v = m[0] ? lerCentavos(m[0]) : null;
    if (v != null) achados.push(v);
  }
  return achados;
}

export function formatarReais(centavos: number): string {
  return formatCentsBRL(centavos);
}
