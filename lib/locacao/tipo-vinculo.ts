/** Tipo do Hub (`locatário`/`proprietário`/`fiador`) → vocabulário do vínculo. */
export function tipoParaVinculo(
  tipo: string,
): "locatario" | "fiador" | "proprietario" | undefined {
  const n = tipo.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (n === "inquilino" || n === "locatario") return "locatario";
  if (n === "fiador") return "fiador";
  if (n === "proprietario") return "proprietario";
  return undefined;
}
