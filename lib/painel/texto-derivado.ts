/**
 * Recorte da derivação universal (8000 chars) visto pelo painel.
 * O agente de WhatsApp continua no teto de `deriveMediaText`; aqui só avisamos
 * a IA do painel para não tratar o corte como ausência de crédito/depósito.
 */
import { textoDerivadoTruncado } from "@/lib/messaging/media/derive";

export const AVISO_DERIVADO_TRUNCADO =
  "TEXTO CORTADO NO TETO DE DERIVAÇÃO. Não conclua ausência de créditos, depósitos ou trechos posteriores — o restante não está neste recorte.";

export function derivadoEstaTruncado(
  texto: string | null | undefined,
  originalCompleto?: boolean,
): boolean {
  return originalCompleto !== true && textoDerivadoTruncado(texto);
}

export function comAvisoSeTruncado(texto: string, truncado: boolean): string {
  if (!truncado || texto.length === 0) return texto;
  return `${AVISO_DERIVADO_TRUNCADO}\n${texto}`;
}
