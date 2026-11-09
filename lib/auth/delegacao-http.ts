/**
 * HTTP JSON-RPC da superfície MCP individual (Bot). Isolada de /api/mcp (token de organização).
 * Não inicia OAuth. Identidade = Bearer JWT role=oauth_delegado.
 */
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import {
  buscarGrantViaClient,
  executarSuperficieDelegada,
  resumoOpacoDelegado,
  type ClienteLeitura,
  type DepsSuperficieDelegada,
  type EfeitoDelegado,
} from "@/lib/auth/delegacao-superficie";
import { issuerAuthConfigurado, verificarSujeitoOAuth } from "@/lib/auth/delegacao-oauth-sujeito";
import { logger } from "@/lib/logger";

const rpc = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string(), z.number(), z.null()]).optional(),
    method: z.string().min(1),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const tools = [
  {
    name: "delegacao_buscar",
    description: "Lista conversas da conta empresarial visíveis ao sujeito OAuth.",
    efeito: "buscar" as const,
  },
  {
    name: "delegacao_ler",
    description: "Lê uma conversa empresarial. Pessoal e sessão sem vínculo recusam.",
    efeito: "ler" as const,
  },
  {
    name: "delegacao_baixar",
    description: "Baixa anexo empresarial após SELECT no Storage com o JWT da pessoa.",
    efeito: "baixar" as const,
  },
];

export function metadadosRecursoProtegido(origem: string): Record<string, unknown> {
  const resource = `${origem.replace(/\/+$/, "")}/api/mcp/delegacao`;
  const auth = issuerAuthConfigurado();
  return {
    resource,
    authorization_servers: auth ? [auth] : [],
    bearer_methods_supported: ["header"],
    scopes_supported: ["buscar", "ler", "baixar"],
  };
}

export function wwwAuthenticate(origem: string): string {
  const url = `${origem.replace(/\/+$/, "")}/.well-known/oauth-protected-resource/api/mcp/delegacao`;
  return `Bearer realm="delegacao", resource_metadata="${url}"`;
}

function origemDaRequest(req: Request): string {
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost";
  return `${proto}://${host}`;
}

function rpcErro(id: unknown, code: number, message: string, status: number, headers?: HeadersInit) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }), {
    status,
    headers: { "content-type": "application/json", ...(headers ?? {}) },
  });
}

function efeitoDaTool(nome: string): EfeitoDelegado | null {
  return tools.find((t) => t.name === nome)?.efeito ?? null;
}

export async function handleDelegacaoHttp(
  req: Request,
  deps: Pick<DepsSuperficieDelegada, "leitorAuth" | "agora" | "clientDoUsuario" | "assinarAposRls"> & {
    buscarGrant?: DepsSuperficieDelegada["buscarGrant"];
  },
): Promise<Response> {
  const origem = origemDaRequest(req);
  const authz = req.headers.get("authorization");
  const wa = { "www-authenticate": wwwAuthenticate(origem) };

  if (req.method !== "GET" && req.method !== "POST") {
    return fail("invalid_request", "Método não suportado.", 405, { headers: { allow: "GET, POST" } });
  }

  const sujeito = await verificarSujeitoOAuth(authz, {
    leitor: deps.leitorAuth,
    agora: deps.agora,
  });
  if (!sujeito.ok) {
    return fail("unauthenticated", "Auth required.", 401, { headers: wa });
  }

  if (req.method === "GET") {
    return ok({ tools: tools.map((t) => ({ name: t.name, description: t.description })) });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return rpcErro(null, -32700, "Parse error", 400);
  }
  const parsed = rpc.safeParse(body);
  if (!parsed.success) return rpcErro(null, -32600, "Invalid Request", 400);

  const { id, method, params } = parsed.data;
  if (method === "initialize") {
    return Response.json({
      jsonrpc: "2.0",
      id: id ?? null,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "delegacao-oauth", version: "1" },
      },
    });
  }
  if (method === "notifications/initialized") {
    return new Response(null, { status: 202 });
  }
  if (method === "tools/list") {
    return Response.json({
      jsonrpc: "2.0",
      id: id ?? null,
      result: {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: { type: "object", properties: {} },
        })),
      },
    });
  }
  if (method !== "tools/call") {
    return rpcErro(id, -32601, "Method not found", 404);
  }

  const nome = typeof params?.name === "string" ? params.name : "";
  const efeito = efeitoDaTool(nome);
  if (!efeito) return rpcErro(id, -32601, "Unknown tool", 404);

  const args =
    params?.arguments && typeof params.arguments === "object"
      ? (params.arguments as Record<string, unknown>)
      : {};
  const conversationId = typeof args.conversation_id === "string" ? args.conversation_id : null;
  const anexo =
    efeito === "baixar"
      ? {
          conversaIdDoPedido: conversationId ?? "",
          bucket: typeof args.bucket === "string" ? args.bucket : "",
          path: typeof args.path === "string" ? args.path : "",
        }
      : null;

  const r = await executarSuperficieDelegada(
    { authorizationHeader: authz, efeito, conversationId, anexo },
    {
      leitorAuth: deps.leitorAuth,
      agora: deps.agora,
      clientDoUsuario: deps.clientDoUsuario,
      buscarGrant: deps.buscarGrant ?? buscarGrantViaClient,
      assinarAposRls:
        deps.assinarAposRls ??
        (async (q) => {
          const client = deps.clientDoUsuario(sujeito.sujeito.accessToken) as unknown as {
            storage?: {
              from: (bucket: string) => {
                createSignedUrl: (
                  path: string,
                  expires: number,
                ) => Promise<{ data: { signedUrl?: string } | null; error: unknown }>;
              };
            };
          };
          if (typeof client.storage?.from !== "function") return null;
          try {
            const { data, error } = await client.storage.from(q.bucket).createSignedUrl(q.path, 60);
            if (error || !data?.signedUrl) return null;
            return { signed_url: data.signedUrl, expires_in: 60 };
          } catch {
            return null;
          }
        }),
    },
  );

  const recuo = resumoOpacoDelegado(r);
  if (r.ok) logger.info("delegacao.mcp", recuo);
  else logger.warn("delegacao.mcp", recuo);

  if (!r.ok) {
    const status =
      r.motivo === "identidade_nao_provada" ||
      r.motivo === "token_invalido" ||
      r.motivo === "papel_nao_dedicado" ||
      r.motivo === "client_id_ausente" ||
      r.motivo === "audiencia_invalida"
        ? 401
        : 404;
    const headers = status === 401 ? wa : undefined;
    return rpcErro(id, -32001, "Não encontrado.", status, headers);
  }

  return Response.json({
    jsonrpc: "2.0",
    id: id ?? null,
    result: {
      content: [{ type: "text", text: JSON.stringify(r.dados) }],
      structuredContent: r.dados,
    },
  });
}

export function clientDoUsuarioDeToken(
  factory: (token: string) => ClienteLeitura,
): (token: string) => ClienteLeitura {
  return factory;
}
