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
 * RPC do **produto** não é confinada: o hook e o papel dedicado não estão
 * ligados no CRM. M1/M2 medidos só no harness descartável
 * (`scripts/disposable-delegacao-auth/`, evidência
 * `docs/evidencias/delegacao-m1-m2-vm-2026-11-08.md`). Ver
 * docs/decisoes/delegacao-papel-dedicado.md. Revogar EXECUTE de authenticated
 * quebra a Inbox. PUBLIC alcança NOINHERIT.
 */
export const RPC_OAUTH = {
  estado: "nao_confinado",
  motivo:
    "Produto: JWT OAuth e cookie ainda compartilhariam authenticated (hook/CREATE ROLE não ligados). M1 medido em Auth descartável v2.196.0: o runtime EMITE role=oauth_delegado. verificarSujeitoOAuth exigir authenticated continua escolha local. REVOKE EXECUTE de authenticated quebra a Inbox. GRANT TO PUBLIC alcança qualquer papel NOINHERIT.",
  alternativas: [
    "M1 MEDIDO (VM 2026-11-08): GoTrue v2.196.0 authorization_code+PKCE e refresh emitiram role=oauth_delegado só no client mapeado; cookie/outro client ficaram authenticated; omitir client_id no output do hook remove o claim (replace). Produto sem hook.",
    "M2 MEDIDO no sintético: PUBLIC alcança NOINHERIT; authenticator SET ROLE exige GRANT; policies TO oauth_delegado + policy no grant isolam; cookie intacta. Produto sem CREATE ROLE.",
    "0773 permanece tabelas/Storage; RPC do produto segue authenticated compartilhado até hook+papel no CRM (aprovação à parte)",
  ],
  decisao_fora_de_escopo:
    "Felipe autorizou M1/M2 descartáveis. Não ligar hook/CREATE ROLE no CRM sem aprovação nova. Não mandar o JWT ao PostgREST não corta /rest/v1 /rpc de quem tem o Bearer.",
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
