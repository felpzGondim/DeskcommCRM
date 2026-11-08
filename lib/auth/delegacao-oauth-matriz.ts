/**
 * Matriz allow/deny da Data API / RPC para JWT OAuth
 * (`role=authenticated` + `client_id` presente). Fail-closed.
 *
 * Não é ativação. Nenhum token é emitido. Rotas HTTP seguem 404.
 * Cookie (`client_id` nulo) não usa esta matriz: as restritivas
 * `(auth.jwt() ->> 'client_id') is null` são verdadeiras na Inbox.
 *
 * Inventário de runtime (grants + RLS permissiva-OR + restritiva-AND +
 * view invoker + RPC definer), não de filtro de rota MCP.
 */

/** Tabelas em que o JWT OAuth pode SELECT — só com grant vivo, salvo o próprio grant. */
export const TABELAS_OAUTH_LEITURA_COM_GRANT = [
  "delegacao_visibilidade_corporativa",
  "conversations",
  "messages",
  "contacts",
  "channel_sessions",
] as const;

export const POLITICA_DEFAULT_DENY_OAUTH = "oauth_cookie_only";

export const STORAGE_OAUTH = "default_deny" as const;

/**
 * RPC não é confinada pelo mesmo JWT. Cookie e OAuth compartilham o papel
 * `authenticated`. Revogar EXECUTE desse papel quebra a Inbox. Funções
 * SECURITY DEFINER voláteis do allowlist existente não leem `client_id`.
 */
export const RPC_OAUTH = {
  estado: "nao_confinado",
  motivo:
    "JWT OAuth usa o mesmo papel authenticated da sessão cookie. REVOKE EXECUTE de authenticated quebra a Inbox. SECURITY DEFINER volátil permitida a authenticated não consulta client_id.",
  alternativas: [
    "Custom Access Token Hook do Auth: claim role distinto (ex. oauth_delegado) + GRANT mínimo; cookie permanece authenticated",
    "Nunca apresentar o JWT OAuth ao PostgREST/Data API — o Bearer ainda funciona contra /rest/v1 se o cliente o enviar; a rota 404 do app não impede isso",
    "Guardar client_id no corpo de cada SECURITY DEFINER volátil — amplo demais para este PR",
  ],
  decisao_fora_de_escopo:
    "Felipe escolhe role split via Auth hook OU proibir Data API para tokens OAuth. Sem isso não há confinamento uniforme de RPC.",
} as const;

/** Acesso que esta migration INTRODUZ para client_id presente (não existia na cookie policy). */
export const ACESSO_NOVO_DESTA_MIGRATION = [
  "conversations SELECT via conversations_select_delegacao_oauth (agent own com grant vê corporativa operacional atribuída a outro)",
  "messages SELECT via messages_select_delegacao_oauth quando grant+sessão corporativa+is_personal false",
  "contacts SELECT de is_personal false da org do grant (não o contato pessoal)",
  "channel_sessions SELECT de classificacao_empresarial=corporativa da org do grant",
] as const;

/** Capacidade authenticated que a cookie já tinha e que o JWT OAuth PERDE com as restritivas. */
export const ACESSO_HERDADO_AGORA_NEGADO = [
  "contacts SELECT org-wide com is_personal true",
  "channel_sessions SELECT org-wide pessoal/NULL",
  "locacao_* SELECT org-wide (inclui locacao_processo_documentos)",
  "demais tabelas public com RLS (notes, leads, …)",
  "storage.objects SELECT (whatsapp-media, locacao-processos, demais buckets com policy de org)",
] as const;

/** Continua aberto porque o papel é o mesmo. Não foi alargado por 0773. */
export const ACESSO_HERDADO_AINDA_ABERTO = [
  "EXECUTE de SECURITY DEFINER volátil listado em tests/invariants/hardening-definer-varredura.test.ts AUTHENTICATED_PERMITIDO",
  "EXECUTE de DEFINER estável de helpers de RLS (necessário para cookie e para as policies desta matriz)",
] as const;
