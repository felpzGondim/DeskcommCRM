/**
 * CPF do participante do processo: máscara para a tela, hash para achar
 * duplicado, ciphertext via o mesmo `encrypt_cpf` dos contatos.
 * Nunca loga o valor.
 */
import { camposCpfParaGravar, hashCpf, normalizeCpf } from "@/lib/contacts/cpf";
import type { SupabaseClient } from "@supabase/supabase-js";

export function mascararCpf(bruto: string): string | null {
  const d = normalizeCpf(bruto);
  if (d.length !== 11) return null;
  return `***.***.**${d[8]}-${d.slice(9)}`;
}

export async function camposCpfDoParticipante(
  admin: SupabaseClient,
  bruto: string,
): Promise<{ cpf_hash?: string; cpf_encrypted?: Uint8Array; cpf_mascarado?: string }> {
  const d = normalizeCpf(bruto);
  if (d.length !== 11) return {};
  const par = await camposCpfParaGravar(admin, d);
  if (!par.cpf_hash) return {};
  return { ...par, cpf_mascarado: mascararCpf(d) ?? undefined };
}

export function hashCpfDoParticipante(bruto: string): string | null {
  const d = normalizeCpf(bruto);
  if (d.length !== 11) return null;
  return hashCpf(d);
}
