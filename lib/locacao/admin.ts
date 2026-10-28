/**
 * Acesso às tabelas de locação. A maior parte não está no `database.types`
 * gerado do upstream; `locacao_analises_seguro` (0770) entra à mão. Service
 * role + filtro de organization_id da sessão.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export function tabelaLocacao(admin: SupabaseClient, nome: string) {
  return admin.from(nome as never);
}
