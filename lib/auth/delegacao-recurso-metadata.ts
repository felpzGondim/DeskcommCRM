/**
 * RFC 9728 — documento de Protected Resource Metadata da superfície
 * delegada. Montagem pura: nada é servido enquanto a ativação padrão
 * estiver desligada (a rota devolve 404).
 *
 * `authorization_servers` aponta para a origem do Auth (GoTrue), não para
 * um AS inventado neste app. Callbacks do Grok Bot / Cursor MCP ficam
 * para teste de interop posterior — este módulo não registra client OAuth.
 */
export const CAMINHO_SUPERFICIE_DELEGADA = "/api/mcp/delegacao";
export const CAMINHO_METADATA_RECURSO_DELEGADO =
  "/.well-known/oauth-protected-resource/api/mcp/delegacao";

export type DocumentoRecursoProtegido = {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported: ["header"];
  resource_documentation?: string;
};

export function origemHttp(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.host) return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

export function montarDocumentoRecursoDelegado(entrada: {
  origemDoApp: string;
  origemDoAuth: string;
}): DocumentoRecursoProtegido | null {
  const app = origemHttp(entrada.origemDoApp);
  const auth = origemHttp(entrada.origemDoAuth);
  if (!app || !auth) return null;
  return {
    resource: `${app}${CAMINHO_SUPERFICIE_DELEGADA}`,
    authorization_servers: [auth],
    bearer_methods_supported: ["header"],
  };
}
