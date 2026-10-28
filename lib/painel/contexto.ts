import type { SupabaseClient } from "@supabase/supabase-js";

import type { ContextoDaFerramenta, OrigemDaFerramenta } from "@/lib/painel/ferramentas/tipos";

export function montarContexto(input: {
  orgId: string;
  conversationId: string;
  contactId: string;
  userId: string;
  requestId: string;
  dbSessao: SupabaseClient;
  admin: SupabaseClient;
  settings: unknown;
  idioma: string;
  phoneNumber?: string | null;
  origem: OrigemDaFerramenta;
  onAndamento?: ContextoDaFerramenta["onAndamento"];
}): ContextoDaFerramenta {
  return input;
}
