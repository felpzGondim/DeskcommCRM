/**
 * Id numérico da pessoa na Superlógica (1–12 dígitos) e as chaves que o
 * contato guarda em `custom_fields`. Sem PII. Sem rede.
 */
export function idPessoaSuperlogica(v: unknown): string | null {
  if (typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 999_999_999_999) {
    return String(v);
  }
  if (typeof v === "string" && /^\d{1,12}$/.test(v.trim())) return v.trim();
  return null;
}

export function vinculoEmCustomFields(custom: unknown): {
  superlogica_id_pessoa: string | null;
  superlogica_tipo: string | null;
} {
  if (!custom || typeof custom !== "object" || Array.isArray(custom)) {
    return { superlogica_id_pessoa: null, superlogica_tipo: null };
  }
  const cf = custom as Record<string, unknown>;
  const id = idPessoaSuperlogica(cf.superlogica_id_pessoa);
  const tipo = typeof cf.superlogica_tipo === "string" ? cf.superlogica_tipo.slice(0, 40) : null;
  return { superlogica_id_pessoa: id, superlogica_tipo: tipo };
}
