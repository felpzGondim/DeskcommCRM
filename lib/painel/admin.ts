/**
 * Tabelas do painel do agente (0769) não estão no `database.types` gerado.
 * Service role + filtro de organization_id da sessão.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export function tabelaPainel(admin: SupabaseClient, nome: string) {
  return admin.from(nome as never);
}
