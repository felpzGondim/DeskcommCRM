/**
 * Recorte congelado do JSON Schema de **input** na página de docs
 * (2026-11-08, https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook).
 *
 * `claims.role` nessa página: enum `anon` | `authenticated`. A **mesma** página
 * tem exemplo HTTP que copia `app_metadata.role` para `claims.role` (valor
 * arbitrário). O schema de **runtime** do GoTrue v2.196.0 é `role: { type:
 * "string" }` sem enum — ver docs/decisoes/delegacao-papel-dedicado.md.
 * Isto NÃO é um hook ligado. Nenhum CREATE FUNCTION de hook neste PR.
 */
export const HOOK_ACCESS_TOKEN_ROLE_ENUM_OFICIAL = ["anon", "authenticated"] as const;

export type RoleClaimOficialHook = (typeof HOOK_ACCESS_TOKEN_ROLE_ENUM_OFICIAL)[number];

export function roleClaimPermitidaPeloHookOficial(role: string): role is RoleClaimOficialHook {
  return (HOOK_ACCESS_TOKEN_ROLE_ENUM_OFICIAL as readonly string[]).includes(role);
}
