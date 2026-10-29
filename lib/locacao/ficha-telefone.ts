import type { FichaPreliminar, PessoaDaFicha } from "@/lib/locacao/ficha-schema";

/** Inquilino principal da ficha — nunca quem só conversa (parente/corretor). */
export function inquilinoPrincipalDaFicha(
  ficha: FichaPreliminar | null | undefined,
): PessoaDaFicha | null {
  if (!ficha) return null;
  const inquilinos = ficha.pessoas.filter((p) => p.papel === "inquilino");
  return inquilinos.find((p) => p.principal) ?? inquilinos[0] ?? null;
}

/**
 * Celular do inquilino principal da ficha — nunca o telefone de quem está
 * conversando (pode ser parente ou corretor). Sem número, o atendente preenche.
 */
export function telefoneDoInquilinoPrincipal(ficha: FichaPreliminar | null | undefined): string | null {
  const escolhido = inquilinoPrincipalDaFicha(ficha);
  const bruto = escolhido?.celular.valor?.trim() ?? "";
  const digitos = bruto.replace(/\D/g, "");
  if (digitos.length < 8) return null;
  return bruto;
}
