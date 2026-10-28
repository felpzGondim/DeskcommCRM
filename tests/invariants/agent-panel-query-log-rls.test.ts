import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { countAs, sql } from "./gov-helpers";

/**
 * `agent_panel_query_log` (0769): membro lê a linha da própria org; membro de
 * outra org não lê; authenticated não escreve; a única SECURITY DEFINER é o
 * expurgo, revogada de anon/authenticated.
 */
const orgA = randomUUID(), orgB = randomUUID();
const membroA = randomUUID(), membroB = randomUUID();
const logA = randomUUID(), logB = randomUUID();

beforeAll(() => {
  sql(`insert into auth.users (id, email) values ('${membroA}', 'painel-a@invariant.test'), ('${membroB}', 'painel-b@invariant.test');`);
  for (const [org, sess, membro, conv, log] of [
    [orgA, randomUUID(), membroA, randomUUID(), logA],
    [orgB, randomUUID(), membroB, randomUUID(), logB],
  ] as const) {
    const contact = randomUUID();
    sql(`
      insert into organizations (id, slug, legal_name, display_name)
        values ('${org}', '${org}', 'Painel', 'Painel');
      insert into user_organizations (user_id, organization_id, role, accepted_at)
        values ('${membro}', '${org}', 'admin', now());
      insert into channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
        values ('${sess}', '${org}', '${sess}', '\\x00');
      insert into contacts (id, organization_id, display_name)
        values ('${contact}', '${org}', 'Contato');
      insert into conversations (id, organization_id, contact_id, channel_session_id, status, is_group)
        values ('${conv}', '${org}', '${contact}', '${sess}', 'open', false);
      insert into agent_panel_query_log
        (id, organization_id, conversation_id, contact_id, user_id, pergunta, modo, status)
        values ('${log}', '${org}', '${conv}', '${contact}', '${membro}', 'qual o aluguel?', 'normal', 'pronto');
    `);
  }
});

describe("agent_panel_query_log: RLS e escrita", () => {
  it("membro lê a consulta da própria organização e não a da outra", () => {
    expect(countAs(membroA, `select count(*) from agent_panel_query_log where id = '${logA}';`)).toBe(1);
    expect(countAs(membroA, `select count(*) from agent_panel_query_log where id = '${logB}';`)).toBe(0);
    expect(countAs(membroB, `select count(*) from agent_panel_query_log where id = '${logA}';`)).toBe(0);
    expect(countAs(membroB, `select count(*) from agent_panel_query_log where id = '${logB}';`)).toBe(1);
  });

  it("escrita só pelo service_role: authenticated e anon não inserem nem apagam", () => {
    expect(
      sql(`select has_table_privilege('authenticated','public.agent_panel_query_log','insert'),
        has_table_privilege('authenticated','public.agent_panel_query_log','update'),
        has_table_privilege('authenticated','public.agent_panel_query_log','delete'),
        has_table_privilege('anon','public.agent_panel_query_log','select'),
        has_table_privilege('service_role','public.agent_panel_query_log','insert');`),
    ).toBe("f|f|f|f|t");
    expect(() =>
      sql(`set role authenticated;
        select set_config('request.jwt.claims', '{"sub":"${membroA}"}', false);
        insert into agent_panel_query_log (organization_id, conversation_id, contact_id, user_id, pergunta)
          values ('${orgA}', '${randomUUID()}', '${randomUUID()}', '${membroA}', 'x');`),
    ).toThrow(/permission denied/);
  });

  it("funções de expurgo SECURITY DEFINER não estão concedidas a authenticated nem anon", () => {
    expect(
      sql(`select count(*) from information_schema.routine_privileges
        where routine_schema = 'public'
          and routine_name = 'fn_expurgar_consultas_do_painel_vencidas'
          and privilege_type = 'EXECUTE'
          and grantee in ('anon','authenticated','PUBLIC');`),
    ).toBe("0");
  });
});
