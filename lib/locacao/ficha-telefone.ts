import type { FichaPreliminar } from "@/lib/locacao/ficha-schema";

/**
 * Celular do inquilino principal da ficha — nunca o telefone de quem está
 * conversando (pode ser parente ou corretor). Sem número, o atendente preenche.
 */
export function telefoneDoInquilinoPrincipal(ficha: FichaPreliminar | null | undefined): string | null {
  if (!ficha) return null;
  const inquilinos = ficha.pessoas.filter((p) => p.papel === "inquilino");
  const escolhido = inquilinos.find((p) => p.principal) ?? inquilinos[0];
  const bruto = escolhido?.celular.valor?.trim() ?? "";
  const digitos = bruto.replace(/\D/g, "");
  if (digitos.length < 8) return null;
  return bruto;
}
