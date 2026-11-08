/**
 * RFC 9728 — metadata do recurso delegado.
 *
 * Default deny: 404. Servir o documento anunciaria um AS que esta instalação
 * pode não ter ligado (`GOTRUE_OAUTH_SERVER_ENABLED` não está no env do app).
 * A montagem do JSON vive em `lib/auth/delegacao-recurso-metadata.ts`.
 */
import { fail } from "@/lib/api/wrappers";
import { ATIVACAO_DELEGADA_PADRAO } from "@/lib/auth/delegacao-empresarial";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function desligada() {
  return fail("not_found", "Não encontrado.", 404);
}

export async function GET(): Promise<Response> {
  void ATIVACAO_DELEGADA_PADRAO;
  return desligada();
}
