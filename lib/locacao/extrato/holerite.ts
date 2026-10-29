/**
 * Renda líquida de holerite. Não some o mesmo salário no holerite e no extrato
 * (conservador: se os dois existem e o extrato tem salário/pró-labore, usa o maior).
 */
import { lerCentavos } from "./dinheiro";

export function rendaLiquidaDeHolerite(texto: string, nomeArquivo?: string | null): number | null {
  const nome = nomeArquivo ?? "";
  const parece = /holerite|contracheque|folha de pagamento|proventos/i.test(nome + "\n" + texto.slice(0, 400));
  if (!parece) return null;
  const m =
    texto.match(/l[ií]quido[\s:]*r?\$?\s*(\d{1,3}(?:\.\d{3})+,\d{2}|\d{3,7})/i) ??
    texto.match(/valor\s+l[ií]quido[\s:]*r?\$?\s*(\d{1,3}(?:\.\d{3})+,\d{2}|\d{3,7})/i);
  const bruto = m?.[1];
  if (!bruto) return null;
  const centavos = bruto.includes(",")
    ? lerCentavos(bruto)
    : Number(bruto.replace(/\D/g, "")) * 100;
  if (centavos == null || !Number.isFinite(centavos) || centavos < 50_000) return null;
  return Math.round(centavos);
}

export function combinarHoleriteEExtrato(
  holeriteCentavos: number | null,
  extratoCentavos: number | null,
  extratoTemSalario: boolean,
): number | null {
  if (holeriteCentavos == null) return extratoCentavos;
  if (extratoCentavos == null) return holeriteCentavos;
  if (extratoTemSalario) return Math.max(holeriteCentavos, extratoCentavos);
  return holeriteCentavos + extratoCentavos;
}
