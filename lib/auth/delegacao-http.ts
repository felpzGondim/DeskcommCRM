/** JSON-RPC da superfície MCP individual. Identidade via JWT com papel oauth_delegado. */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { fail, ok } from "@/lib/api/wrappers";
import {
  buscarGrantsViaClient,
  executarSuperficieDelegada,
  resumoOpacoDelegado,
  ESCOPOS_OAUTH_DELEGADOS,
  type DepsSuperficieDelegada,
} from "@/lib/auth/delegacao-superficie";
import { issuerAuthConfigurado, verificarSujeitoOAuth } from "@/lib/auth/delegacao-oauth-sujeito";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

import {
  delegacaoEnviarSchema,
  delegacaoIniciarConversaSchema,
  LIMITE_BASE64_DELEGADO,
} from "./delegacao-envio-entrada";

const rpc = z.strictObject({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
});
const conversa = z.object({ conversation_id: z.uuid() });
const baixar = conversa.extend({ bucket: z.string().min(1), path: z.string().min(1).max(500) });
const vazio = z.strictObject({});

const toolsLeitura = [
  {
    name: "delegacao_buscar",
    description: "Lista conversas visíveis nas organizações autorizadas.",
    efeito: "buscar",
    schema: z.object({}),
  },
  {
    name: "delegacao_ler",
    description: "Lê uma conversa de uma sessão empresarial ou da titular vinculada.",
    efeito: "ler",
    schema: conversa,
  },
  {
    name: "delegacao_baixar",
    description: "Baixa anexo visível no Storage com o JWT da pessoa.",
    efeito: "baixar",
    schema: baixar,
  },
] as const;

const toolsEnvio = [
  {
    name: "delegacao_enviar",
    description:
      "Envia WhatsApp para uma conversa autorizada. Reuse a chave para consultar o recibo.",
    schema: delegacaoEnviarSchema,
  },
  {
    name: "delegacao_iniciar_conversa",
    description: "Confirma um número, abre a conversa na sessão autorizada e envia WhatsApp.",
    schema: delegacaoIniciarConversaSchema,
  },
  {
    name: "delegacao_listar_sessoes",
    description: "Lista sessões com efeito de envio e seu estado.",
    schema: vazio,
  },
] as const;

export function metadadosRecursoProtegido(origem: string): Record<string, unknown> {
  const resource = `${origem.replace(/\/+$/, "")}/api/mcp/delegacao`;
  const auth = issuerAuthConfigurado();
  return {
    resource,
    authorization_servers: auth ? [auth] : [],
    bearer_methods_supported: ["header"],
    scopes_supported: ESCOPOS_OAUTH_DELEGADOS,
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

function rpcErro(
  id: unknown,
  code: number,
  message: string,
  status: number,
  headers?: HeadersInit,
  data?: unknown,
) {
  return Response.json(
    { jsonrpc: "2.0", id: id ?? null, error: { code, message, data } },
    { status, headers },
  );
}

function rpcDados(id: unknown, dados: unknown) {
  return Response.json({
    jsonrpc: "2.0",
    id: id ?? null,
    result: { content: [{ type: "text", text: JSON.stringify(dados) }], structuredContent: dados },
  });
}

/** O limite também vale quando o conector usa transferência sem Content-Length. */
async function lerJsonLimitado(req: Request): Promise<{ body: unknown } | { status: 400 | 422 }> {
  const limite = LIMITE_BASE64_DELEGADO + 64 * 1024;
  if (Number(req.headers.get("content-length")) > limite) return { status: 422 };
  if (!req.body) return { status: 400 };
  const reader = req.body.getReader();
  const partes: Buffer[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limite) {
        await reader.cancel().catch(() => undefined);
        return { status: 422 };
      }
      partes.push(Buffer.from(value));
    }
    return { body: JSON.parse(Buffer.concat(partes, bytes).toString("utf8")) };
  } catch {
    return { status: 400 };
  } finally {
    reader.releaseLock();
  }
}

export async function handleDelegacaoHttp(
  req: Request,
  deps: Omit<DepsSuperficieDelegada, "buscarGrants"> & {
    buscarGrants?: DepsSuperficieDelegada["buscarGrants"];
  },
): Promise<Response> {
  const origem = origemDaRequest(req);
  const authz = req.headers.get("authorization");
  const wa = { "www-authenticate": wwwAuthenticate(origem) };

  if (req.method !== "GET" && req.method !== "POST") {
    return fail("invalid_request", "Método não suportado.", 405, {
      headers: { allow: "GET, POST" },
    });
  }
  const sujeito = await verificarSujeitoOAuth(authz, {
    leitor: deps.leitorAuth,
    agora: deps.agora,
  });
  if (!sujeito.ok) return fail("unauthenticated", "Auth required.", 401, { headers: wa });

  const tools = env.DELEGACAO_ENVIO_HABILITADO ? [...toolsLeitura, ...toolsEnvio] : toolsLeitura;
  if (req.method === "GET") {
    return ok({ tools: tools.map(({ name, description }) => ({ name, description })) });
  }

  const json = await lerJsonLimitado(req);
  if ("status" in json) {
    return json.status === 422
      ? rpcErro(null, -32602, "Parâmetros inválidos.", 422)
      : rpcErro(null, -32700, "Parse error", 400);
  }
  const parsed = rpc.safeParse(json.body);
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
  if (method === "notifications/initialized") return new Response(null, { status: 202 });
  if (method === "tools/list") {
    return Response.json({
      jsonrpc: "2.0",
      id: id ?? null,
      result: {
        tools: tools.map(({ name, description, schema }) => ({
          name,
          description,
          inputSchema: z.toJSONSchema(schema, { io: "input" }),
        })),
      },
    });
  }
  if (method !== "tools/call") return rpcErro(id, -32601, "Method not found", 404);

  const tool = tools.find((t) => t.name === params?.name);
  if (!tool) {
    if (toolsEnvio.some((t) => t.name === params?.name)) {
      logger.warn("delegacao.envio_recusado", { motivo: "envio_desligado" });
    }
    return rpcErro(id, -32001, "Não encontrado.", 404);
  }
  const args = params?.arguments === undefined ? {} : params.arguments;
  const depsCompletas = { ...deps, buscarGrants: deps.buscarGrants ?? buscarGrantsViaClient };

  if (!("efeito" in tool)) {
    const requestId = z.uuid().safeParse(req.headers.get("x-request-id")).data ?? randomUUID();
    const registrarFalha = () => ({
      ok: false as const,
      status: 503,
      motivo: "envio_indisponivel",
      retry_after: undefined,
    });
    const operacao = async () => {
      if (tool.name === "delegacao_listar_sessoes") {
        if (!tool.schema.safeParse(args).success) {
          return {
            ok: false as const,
            status: 422,
            motivo: "parametros_invalidos",
            retry_after: undefined,
          };
        }
        const { listarSessoesParaEnvioDelegado } = await import("./delegacao-envio");
        return listarSessoesParaEnvioDelegado(sujeito.sujeito, depsCompletas);
      }
      const entrada = tool.schema.safeParse(args);
      if (!entrada.success) {
        return {
          ok: false as const,
          status: 422,
          motivo: "parametros_invalidos",
          retry_after: undefined,
        };
      }
      // O caminho de escrita só é carregado depois de o HTTP provar o JWT.
      const { executarEnvioDelegado } = await import("./delegacao-envio");
      return executarEnvioDelegado(sujeito.sujeito, entrada.data, depsCompletas, requestId);
    };
    const r = await operacao().catch(registrarFalha);
    if (r.ok) return rpcDados(id, r.dados);
    logger.warn("delegacao.mcp", {
      ok: false,
      efeito: tool.name,
      motivo: r.motivo,
      request_id: requestId,
    });
    if (r.status === 429) {
      return rpcErro(
        id,
        -32029,
        "Limite de envio atingido.",
        429,
        { "retry-after": String(r.retry_after) },
        { retry_after: r.retry_after },
      );
    }
    if (r.status === 409) {
      return rpcErro(
        id,
        -32009,
        r.motivo === "chave_em_conflito" ? "Chave em conflito." : "Envio em curso.",
        409,
      );
    }
    if (r.status === 422) return rpcErro(id, -32602, "Parâmetros inválidos.", 422);
    if (r.status === 503) return rpcErro(id, -32003, "Envio indisponível.", 503);
    return rpcErro(id, -32001, "Não encontrado.", 404);
  }

  const entrada = tool.schema.safeParse(args);
  if (!entrada.success) return rpcErro(id, -32602, "Parâmetros inválidos.", 422);
  const campos = entrada.data;
  const conversationId = "conversation_id" in campos ? campos.conversation_id : null;
  const anexo =
    "bucket" in campos && "path" in campos && conversationId
      ? { conversaIdDoPedido: conversationId, bucket: campos.bucket, path: campos.path }
      : null;

  const r = await executarSuperficieDelegada(
    { authorizationHeader: authz, efeito: tool.efeito, conversationId, anexo },
    {
      ...depsCompletas,
      assinarAposRls:
        deps.assinarAposRls ??
        (async (q) => {
          const client = deps.clientDoUsuario(
            sujeito.sujeito.accessToken,
          ) as unknown as SupabaseClient;
          try {
            const { data, error } = await client.storage.from(q.bucket).createSignedUrl(q.path, 60);
            return !error && data?.signedUrl
              ? { signed_url: data.signedUrl, expires_in: 60 }
              : null;
          } catch {
            return null;
          }
        }),
    },
    sujeito.sujeito,
  );

  const recuo = resumoOpacoDelegado(r);
  if (r.ok) {
    logger.info("delegacao.mcp", recuo);
    return rpcDados(id, r.dados);
  }
  logger.warn("delegacao.mcp", recuo);
  return rpcErro(id, -32001, "Não encontrado.", 404);
}
