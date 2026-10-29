/**
 * Id numérico da pessoa na Superlógica (1–12 dígitos).
 * Fonte de verdade do vínculo ativo: `contato_superlogica_vinculos`.
 * `custom_fields` é legado (migration 0765 copiou para a tabela).
 */
export function idPessoaSuperlogica(v: unknown): string | null {
  if (typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 999_999_999_999) {
    return String(v);
  }
  if (typeof v === "string" && /^\d{1,12}$/.test(v.trim())) return v.trim();
  return null;
}

export type ResumoVinculoSuperlogica = {
  superlogica_id_pessoa: string | null;
  superlogica_tipo: string | null;
};

const SEM_VINCULO: ResumoVinculoSuperlogica = {
  superlogica_id_pessoa: null,
  superlogica_tipo: null,
};

/** Linha ativa de `contato_superlogica_vinculos`. */
export function vinculoDaLinha(row: unknown): ResumoVinculoSuperlogica {
  if (!row || typeof row !== "object" || Array.isArray(row)) return SEM_VINCULO;
  const r = row as Record<string, unknown>;
  const id = idPessoaSuperlogica(r.superlogica_pessoa_id);
  const tipos = Array.isArray(r.tipos) ? r.tipos : [];
  const tipoBruto = tipos.find((t) => typeof t === "string");
  const tipo = typeof tipoBruto === "string" ? tipoBruto.slice(0, 40) : null;
  return { superlogica_id_pessoa: id, superlogica_tipo: tipo };
}

export function vinculoEmCustomFields(custom: unknown): ResumoVinculoSuperlogica {
  if (!custom || typeof custom !== "object" || Array.isArray(custom)) return SEM_VINCULO;
  const cf = custom as Record<string, unknown>;
  const id = idPessoaSuperlogica(cf.superlogica_id_pessoa);
  const tipo = typeof cf.superlogica_tipo === "string" ? cf.superlogica_tipo.slice(0, 40) : null;
  return { superlogica_id_pessoa: id, superlogica_tipo: tipo };
}
