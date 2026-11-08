/**
 * Client PostgREST com o JWT da pessoa (anon key + Bearer). RLS aplica
 * `auth.uid()` desse token. NÃO é service role. NÃO inventa JWT.
 *
 * Uso: token já emitido pelo Auth. Sem persistência, sem refresh.
 *
 * `accessToken` é o contrato do SDK para JWT de terceiro: o `fetchWithAuth`
 * manda esse Bearer ao PostgREST/Storage. `global.headers.Authorization` sozinho
 * não basta — sem sessão o SDK cai na anon key, SET ROLE `anon`, e a RLS
 * `TO oauth_delegado` recusa (grant "erro" → MCP 404). Com `accessToken` o
 * namespace `auth` do MESMO client vira Proxy e não pode chamar getUser —
 * o leitor Auth é `createAnonAuthLeitor()` (getUser(jwt) no argumento).
 */
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";
import { fetchDoServidor } from "@/lib/supabase/fetch-do-servidor";
import { urlDoSupabaseNoServidor } from "@/lib/supabase/url-do-servidor";

function transporteAnon() {
  return {
    auth: {
      autoRefreshToken: false as const,
      persistSession: false as const,
      detectSessionInUrl: false as const,
    },
    global: {
      fetch: fetchDoServidor(
        urlDoSupabaseNoServidor(env.SUPABASE_SERVER_URL, env.NEXT_PUBLIC_SUPABASE_URL),
        env.NEXT_PUBLIC_SUPABASE_URL,
      ),
    },
  };
}

/** Client só para Auth `/user` e `getClaims(jwt)`. Sem `accessToken`. */
export function createAnonAuthLeitor(): SupabaseClient {
  return createSupabaseClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    transporteAnon(),
  );
}

export function createUserClientFromAccessToken(accessToken: string): SupabaseClient {
  const jwt = accessToken.trim();
  if (!jwt) {
    throw new Error("token ausente");
  }
  const base = transporteAnon();
  return createSupabaseClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    ...base,
    accessToken: async () => jwt,
    global: {
      ...base.global,
      headers: {
        Authorization: `Bearer ${jwt}`,
        "X-Client-Info": "crm/oauth-user",
      },
    },
  });
}
