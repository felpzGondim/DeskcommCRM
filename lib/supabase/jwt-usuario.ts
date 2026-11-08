/**
 * Client PostgREST com o JWT da pessoa (anon key + Bearer). RLS aplica
 * `auth.uid()` desse token. NÃO é service role. NÃO inventa JWT.
 *
 * Uso: token já emitido pelo Auth. Sem persistência, sem refresh.
 */
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";
import { fetchDoServidor } from "@/lib/supabase/fetch-do-servidor";
import { urlDoSupabaseNoServidor } from "@/lib/supabase/url-do-servidor";

export function createUserClientFromAccessToken(accessToken: string): SupabaseClient {
  const jwt = accessToken.trim();
  if (!jwt) {
    throw new Error("token ausente");
  }
  return createSupabaseClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: fetchDoServidor(
        urlDoSupabaseNoServidor(env.SUPABASE_SERVER_URL, env.NEXT_PUBLIC_SUPABASE_URL),
        env.NEXT_PUBLIC_SUPABASE_URL,
      ),
      headers: {
        Authorization: `Bearer ${jwt}`,
        "X-Client-Info": "crm/oauth-user",
      },
    },
  });
}
