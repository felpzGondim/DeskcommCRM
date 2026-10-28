/**
 * Trava dos botões 2 e 3 (seguro/FC): sem renda confirmada, recusam.
 * Os PRs 4.2, 4.3 e 4.4 chamam `exigirRendaConfirmada` antes de qualquer efeito.
 */
import type { ResultadoDaFerramenta } from "@/lib/painel/ferramentas/tipos";

export function processoTemRendaConfirmada(
  processo: Record<string, unknown> | null | undefined,
): boolean {
  const em = processo?.renda_confirmada_em;
  return typeof em === "string" && em.length > 0;
}

export const TEXTO_SEM_RENDA_CONFIRMADA =
  "Confirme a renda antes de analisar o seguro-fiança ou a FC.";

export function recusaSemRendaConfirmada(): ResultadoDaFerramenta {
  return {
    ok: false,
    texto: TEXTO_SEM_RENDA_CONFIRMADA,
    codigo: "validation_error",
  };
}

export function exigirRendaConfirmada(
  processo: Record<string, unknown> | null | undefined,
): ResultadoDaFerramenta | null {
  if (processoTemRendaConfirmada(processo)) return null;
  return recusaSemRendaConfirmada();
}
