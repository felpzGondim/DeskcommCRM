import type { NextRequest } from "next/server";

import { metadadosRecursoProtegido } from "@/lib/auth/delegacao-http";

export const dynamic = "force-dynamic";

function origem(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost";
  return `${proto}://${host}`;
}

export async function GET(req: NextRequest): Promise<Response> {
  return Response.json(metadadosRecursoProtegido(origem(req)), {
    headers: { "cache-control": "no-store" },
  });
}
