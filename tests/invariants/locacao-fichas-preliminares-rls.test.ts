import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { countAs, sql } from "./gov-helpers";

/**
 * `locacao_fichas_preliminares` (0762, A1): membro lê a ficha da própria org;
 * membro de outra org não lê; authenticated não escreve; sem SECURITY DEFINER.
 */
const orgA = randomUUID(), orgB = randomUUID();
const membroA = randomUUID(), membroB = randomUUID();
const convA = randomUUID(), convB = randomUUID();
const fichaA = randomUUID(), fichaB = randomUUID();

const fichaJson = `{"versao":"preliminar-v1","pessoas":[],"renda":{"mensal":{"valor":null,"fonte":null,"trecho":null,"confianca":null,"message_id":null},"proposta_fc":{"valor":null,"fonte":null,"trecho":null,"confianca":null,"message_id":null},"documentos":[],"alertas":[]},"imovel":{},"garantia":{},"vigencia":{},"contrato":{},"documentos":{"encontrados":[],"faltantes":[]},"pendencias":[]}`;

beforeAll(() => {
  sql(`insert into auth.users (id, email) values ('${membroA}', 'ficha-a@invariant.test'), ('${membroB}', 'ficha-b@invariant.test');`);
  for (const [org, sess, membro, conv, ficha] of [
    [orgA, randomUUID(), membroA, convA, fichaA],
    [orgB, randomUUID(), membroB, convB, fichaB],
  ] as const) {
    const contact = randomUUID();
    sql(`insert into organizations (id, slug, legal_name, display_name) values ('${org}', '${org}', 'Ficha', 'Ficha');
      insert into user_organizations (user_id, organization_id, role, accepted_at) values ('${membro}', '${org}', 'admin', now());
      insert into channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted) values ('${sess}', '${org}', '${sess}', '\\x00');
      insert into contacts (id, organization_id, display_name) values ('${contact}', '${org}', 'Contato');
      insert into conversations (id, organization_id, contact_id, channel_session_id, status, is_group) values ('${conv}', '${org}', '${contact}', '${sess}', 'open', false);
      insert into locacao_fichas_preliminares (id, organization_id, conversation_id, versao, origem, ficha, relatorio)
        values ('${ficha}', '${org}', '${conv}', 1, 'preliminar_ia', '${fichaJson}'::jsonb, 'ok');`);
  }
});

describe("locacao_fichas_preliminares: RLS e escrita", () => {
  it("membro lê a ficha da própria organização e não a da outra", () => {
    expect(countAs(membroA, `select count(*) from locacao_fichas_preliminares where id = '${fichaA}';`)).toBe(1);
    expect(countAs(membroA, `select count(*) from locacao_fichas_preliminares where id = '${fichaB}';`)).toBe(0);
    expect(countAs(membroB, `select count(*) from locacao_fichas_preliminares where id = '${fichaA}';`)).toBe(0);
    expect(countAs(membroB, `select count(*) from locacao_fichas_preliminares where id = '${fichaB}';`)).toBe(1);
  });

  it("escrita só pelo service_role: authenticated e anon não inserem nem apagam", () => {
    expect(
      sql(`select has_table_privilege('authenticated','public.locacao_fichas_preliminares','insert'),
        has_table_privilege('authenticated','public.locacao_fichas_preliminares','update'),
        has_table_privilege('authenticated','public.locacao_fichas_preliminares','delete'),
        has_table_privilege('anon','public.locacao_fichas_preliminares','select'),
        has_table_privilege('service_role','public.locacao_fichas_preliminares','insert');`),
    ).toBe("f|f|f|f|t");
    expect(() =>
      sql(`set role authenticated;
        select set_config('request.jwt.claims', '{"sub":"${membroA}"}', false);
        insert into locacao_fichas_preliminares (organization_id, conversation_id, versao, origem, ficha)
          values ('${orgA}', '${convA}', 2, 'atendente', '{}'::jsonb);`),
    ).toThrow(/permission denied/);
  });

  it("não cria SECURITY DEFINER concedida a authenticated", () => {
    expect(
      sql(`select count(*) from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef and p.proname like '%ficha_preliminar%';`),
    ).toBe("0");
  });
});
