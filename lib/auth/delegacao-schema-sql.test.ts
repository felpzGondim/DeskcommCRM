import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRACAO = "supabase/migrations/20261108210000_0774_delegacao_papel_dedicado.sql";
const sql = readFileSync(MIGRACAO, "utf8");
const BASELINE = readFileSync("supabase/baseline.sql", "utf8");

describe("0774 não é a 0773 experimental", () => {
  it("tem -- manifest:", () => {
    expect(sql.startsWith("-- manifest:")).toBe(true);
  });

  it("não pinta oauth_cookie_only nem FOR ALL global", () => {
    expect(sql).not.toMatch(/oauth_cookie_only/);
    expect(sql).not.toMatch(/for all\s+to authenticated/i);
    expect(sql).not.toMatch(/classificacao_empresarial/);
  });

  it("recorta SELECT da cookie TO authenticated nas tabelas concedidas ao papel", () => {
    expect(sql).toMatch(/create policy "conversations_select"[\s\S]*for select to authenticated/);
    expect(sql).toMatch(/create policy "messages_select"[\s\S]*for select to authenticated/);
  });

  it("cria papel NOINHERIT e policies TO oauth_delegado", () => {
    expect(sql).toMatch(/create role oauth_delegado nologin noinherit/);
    expect(sql).toMatch(/grant oauth_delegado to authenticator/);
    expect(sql).toMatch(/to oauth_delegado/);
    expect(sql).toMatch(/fn_delegacao_access_token_hook/);
  });

  it("o apêndice do baseline carrega o mesmo rótulo", () => {
    expect(BASELINE).toMatch(/delegação papel dedicado \(migration 0774\)/);
    const ultimo = BASELINE.lastIndexOf("fn_delegacao_access_token_hook");
    expect(ultimo).toBeGreaterThan(0);
  });

  it("apêndice da 0774 entra antes da varredura de anon", () => {
    const apendice = BASELINE.indexOf("delegação papel dedicado (migration 0774)");
    const varredura = BASELINE.search(/^-- ---- VARREDURA anon:/m);
    expect(apendice).toBeGreaterThan(-1);
    expect(varredura).toBeGreaterThan(apendice);
  });

  it("conta empresarial + vínculo de sessão; herda pelo conta_id, não por telefone", () => {
    expect(sql).toMatch(/delegacao_contas_empresariais/);
    expect(sql).toMatch(/delegacao_sessoes_empresariais/);
    expect(sql).toMatch(/fn_delegacao_sessao_empresarial/);
    expect(sql).toMatch(/fn_delegacao_contato_corporativo/);
    expect(sql).toMatch(/Substituição herda pelo mesmo conta_id/);
    expect(sql).not.toMatch(/\bphone_number\b|\be164\b|\bwhatsapp_id\b/i);
    const apendice = BASELINE.slice(BASELINE.lastIndexOf("delegação papel dedicado"));
    expect(sql).not.toMatch(/Marina|Brisa|okMarina/i);
    expect(apendice).not.toMatch(/Marina|Brisa|okMarina/i);
  });

  it("allowlist de client vazia copia claims; não-vazia mapeia role — sem desfazer recast", () => {
    expect(sql).toMatch(/allowlist VAZIA \(zero linhas vivas\) = copia claims/);
    expect(sql).toMatch(/NÃO-VAZIA = client_id vivo vira oauth_delegado/);
    expect(sql).toMatch(/Ligar o hook no Auth não desfaz recast/);
  });

  it("pre-request do PostgREST é executável pelo papel (sem isso a cadeia HTTP é 42501)", () => {
    expect(sql).toMatch(
      /grant execute on function public\.fn_pgrst_recusar_replay_do_gateway\(\) to oauth_delegado/,
    );
    const apendice = BASELINE.slice(BASELINE.lastIndexOf("delegação papel dedicado"));
    expect(apendice).toMatch(
      /grant execute on function public\.fn_pgrst_recusar_replay_do_gateway\(\) to oauth_delegado/,
    );
  });

  it("is_personal existe antes das funções/policies da 0774", () => {
    const col = sql.search(/add column if not exists is_personal/);
    const fn = sql.search(/fn_delegacao_contato_corporativo/);
    expect(col).toBeGreaterThan(-1);
    expect(fn).toBeGreaterThan(col);
  });

  it("WORKING/created_by/nome não classificam origem", () => {
    expect(sql).toMatch(/Não olha status\/created_by\/nome\/telefone/);
    expect(sql).toMatch(/WORKING\/STOPPED\/created_by\/display_name\/org NÃO autorizam origem/);
  });

  it("ENABLE RLS off+42501 aborta antes de GRANT SELECT; já ON não ALTER", () => {
    expect(sql).toMatch(
      /storage\.objects com RLS off e sem privilégio para ENABLE — abortar antes de GRANT SELECT/,
    );
    expect(sql).toMatch(/GRANT SELECT em storage\.objects recusado — RLS off/);
    const enable = sql.search(/alter table storage\.objects enable row level security/);
    const swallow = sql.search(/when insufficient_privilege then null/);
    expect(enable).toBeGreaterThan(-1);
    expect(sql.slice(enable, enable + 400)).toMatch(/raise exception/);
    expect(sql.slice(enable, enable + 400)).not.toMatch(/then null/);
    expect(swallow).toBeGreaterThan(enable);
  });

  it("POST de novo número não classifica sessão empresarial", () => {
    const post = readFileSync("app/api/v1/channel-sessions/route.ts", "utf8");
    const connect = readFileSync("lib/channels/connect-waha.ts", "utf8");
    expect(post).toMatch(/POST \/api\/v1\/channel-sessions/);
    expect(post).not.toMatch(/delegacao_sessoes_empresariais/);
    expect(connect).not.toMatch(/delegacao_sessoes_empresariais/);
    expect(readFileSync("app/api/v1/channel-sessions/[id]/conta-empresarial/route.ts", "utf8")).toMatch(
      /vincularSessaoContaEmpresarial/,
    );
  });
});
