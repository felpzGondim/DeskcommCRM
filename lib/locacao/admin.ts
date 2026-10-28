/**
 * Acesso às tabelas de locação. Elas não estão no `database.types` gerado
 * (só deste fork). Service role + filtro de organization_id da sessão.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export function tabelaLocacao(admin: SupabaseClient, nome: string) {
  return admin.from(nome as never);
}
