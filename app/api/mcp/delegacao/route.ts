/**
 * Superfície MCP individual (Bot). Isolada de /api/mcp (dsk_ + admin).
 * Bearer JWT de usuário, role=oauth_delegado. Nunca service role como identidade.
 */
import type { NextRequest } from "next/server";

import { handleDelegacaoHttp } from "@/lib/auth/delegacao-http";
import { createUserClientFromAccessToken } from "@/lib/supabase/jwt-usuario";
import type { ClienteLeitura } from "@/lib/auth/delegacao-superficie";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<Response> {
  return handleDelegacaoHttp(req, {
    clientDoUsuario: (token) => createUserClientFromAccessToken(token) as unknown as ClienteLeitura,
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return handleDelegacaoHttp(req, {
    clientDoUsuario: (token) => createUserClientFromAccessToken(token) as unknown as ClienteLeitura,
  });
}
