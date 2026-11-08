/**
 * Recorte congelado da spec oficial do Custom Access Token Hook
 * (2026-11-08, https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook).
 *
 * `claims.role` no JSON Schema publicado: enum só `anon` | `authenticated`.
 * O Auth recusa o token se as claims depois do hook saírem da spec.
 * Isto NÃO é um hook ligado. Nenhum CREATE FUNCTION de hook neste PR.
 */
export const HOOK_ACCESS_TOKEN_ROLE_ENUM_OFICIAL = ["anon", "authenticated"] as const;

export type RoleClaimOficialHook = (typeof HOOK_ACCESS_TOKEN_ROLE_ENUM_OFICIAL)[number];

export function roleClaimPermitidaPeloHookOficial(role: string): role is RoleClaimOficialHook {
  return (HOOK_ACCESS_TOKEN_ROLE_ENUM_OFICIAL as readonly string[]).includes(role);
}
