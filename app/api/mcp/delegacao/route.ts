/**
 * Superfície MCP delegada, isolada de `/api/mcp` (dsk_ + admin client).
 *
 * Default deny: 404 antes de Auth, grant, busca, leitura ou assinatura.
 * Não registra tools no catálogo. Não inicia OAuth. Não emite token.
 * A biblioteca `lib/auth/delegacao-superficie.ts` existe para revisão; esta
 * rota não a chama enquanto a ativação padrão estiver desligada.
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

export async function POST(): Promise<Response> {
  void ATIVACAO_DELEGADA_PADRAO;
  return desligada();
}
