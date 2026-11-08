import { beforeAll, describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

/**
 * Grant + policy extra OAuth da delegação (migration 0773).
 *
 * Roda só com `pnpm test:db` (Postgres efêmero). Não é prova no `test:unit`.
 * Sem dado pessoal: ids e e-mails @invariant.test.
 * Seed de `messages` NÃO usa `ON CONFLICT` — `messages_org_external_id_unique`
 * é DEFERRABLE e o Postgres recusa como árbitro (CI pg17 @ c748fb10ad).
 */
const orgA = "eeeeeeee-0000-4000-8000-000000000001";
const orgB = "eeeeeeee-0000-4000-8000-000000000002";
const marina = "eeeeeeee-1111-4000-8000-000000000001";
const felipe = "eeeeeeee-1111-4000-8000-000000000002";
const membroB = "eeeeeeee-1111-4000-8000-000000000003";
const sessCorp = "eeeeeeee-2222-4000-8000-000000000001";
const sessPessoal = "eeeeeeee-2222-4000-8000-000000000002";
const sessUnknown = "eeeeeeee-2222-4000-8000-000000000003";
const sessB = "eeeeeeee-2222-4000-8000-000000000004";
const ctOp = "eeeeeeee-3333-4000-8000-000000000001";
const ctPessoal = "eeeeeeee-3333-4000-8000-000000000002";
const ctUnknownSess = "eeeeeeee-3333-4000-8000-000000000003";
const ctB = "eeeeeeee-3333-4000-8000-000000000004";
const convCorp = "eeeeeeee-4444-4000-8000-000000000001";
const convPessoal = "eeeeeeee-4444-4000-8000-000000000002";
const convUnknown = "eeeeeeee-4444-4000-8000-000000000003";
const convB = "eeeeeeee-4444-4000-8000-000000000004";
const grantMarina = "eeeeeeee-5555-4000-8000-000000000001";
const grantFelipe = "eeeeeeee-5555-4000-8000-000000000002";
const msgCorp = "eeeeeeee-6666-4000-8000-000000000001";
const msgPessoal = "eeeeeeee-6666-4000-8000-000000000002";
const msgUnknown = "eeeeeeee-6666-4000-8000-000000000003";
const msgB = "eeeeeeee-6666-4000-8000-000000000004";
const imovelA = "eeeeeeee-7777-4000-8000-000000000001";
const procA = "eeeeeeee-7777-4000-8000-000000000002";
const docA = "eeeeeeee-7777-4000-8000-000000000003";
const clientId = "oauth-client-cursor-test";
const shaDoc = "ab".repeat(32);

function countJwt(claims: string, query: string): number {
  const out = sql(`
    set role authenticated;
    select set_config('request.jwt.claims', '${claims}', false);
    ${query}
  `);
  const last = lastLine(out);
  if (!/^\d+$/.test(last)) throw new Error(`unexpected psql output: ${out}`);
  return Number(last);
}

function cookie(userId: string, query: string): number {
  return countJwt(`{"sub":"${userId}","role":"authenticated"}`, query);
}

function oauth(userId: string, query: string, cid = clientId): number {
  return countJwt(
    `{"sub":"${userId}","role":"authenticated","client_id":"${cid}"}`,
    query,
  );
}

function writeJwt(claims: string, dml: string): number {
  try {
    const out = sql(`
      set role authenticated;
      select set_config('request.jwt.claims', '${claims}', false);
      with w as (${dml} returning 1) select count(*) from w;
    `);
    const last = lastLine(out);
    if (!/^\d+$/.test(last)) throw new Error(`unexpected psql output: ${out}`);
    return Number(last);
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? "";
    if (stderr.includes("row-level security")) return 0;
    throw err;
  }
}

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${marina}', 'marina-deleg@invariant.test'),
      ('${felipe}', 'felipe-deleg@invariant.test'),
      ('${membroB}', 'orgb-deleg@invariant.test')
      on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name, settings)
      values
        ('${orgA}', 'deleg-org-a', 'Deleg Org A', 'Deleg A', '{"visibility_mode":"own"}'::jsonb),
        ('${orgB}', 'deleg-org-b', 'Deleg Org B', 'Deleg B', '{"visibility_mode":"own"}'::jsonb)
      on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values
        ('${marina}', '${orgA}', 'agent', now()),
        ('${felipe}', '${orgA}', 'admin', now()),
        ('${membroB}', '${orgB}', 'admin', now())
      on conflict do nothing;
    do $d$ begin
      insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted, classificacao_empresarial)
        values
          ('${sessCorp}', '${orgA}', '${sessCorp}', '\\x00'::bytea, 'corporativa'),
          ('${sessPessoal}', '${orgA}', '${sessPessoal}', '\\x00'::bytea, 'pessoal'),
          ('${sessUnknown}', '${orgA}', '${sessUnknown}', '\\x00'::bytea, null),
          ('${sessB}', '${orgB}', '${sessB}', '\\x00'::bytea, 'corporativa');
    exception when unique_violation then null; end $d$;
    insert into public.contacts (id, organization_id, display_name, is_personal)
      values
        ('${ctOp}', '${orgA}', 'Contato op', false),
        ('${ctPessoal}', '${orgA}', 'Contato pessoal', true),
        ('${ctUnknownSess}', '${orgA}', 'Contato unknown sess', false),
        ('${ctB}', '${orgB}', 'Contato B', false)
      on conflict do nothing;
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status, assigned_to_user_id, assigned_at)
      values
        ('${convCorp}', '${orgA}', '${ctOp}', '${sessCorp}', 'claimed', '${felipe}', now()),
        ('${convPessoal}', '${orgA}', '${ctPessoal}', '${sessPessoal}', 'claimed', '${felipe}', now()),
        ('${convUnknown}', '${orgA}', '${ctUnknownSess}', '${sessUnknown}', 'claimed', '${felipe}', now()),
        ('${convB}', '${orgB}', '${ctB}', '${sessB}', 'claimed', '${membroB}', now())
      on conflict do nothing;
    update public.channel_sessions set classificacao_empresarial = 'corporativa' where id = '${sessCorp}';
    update public.channel_sessions set classificacao_empresarial = 'pessoal' where id = '${sessPessoal}';
    update public.channel_sessions set classificacao_empresarial = null where id = '${sessUnknown}';
    delete from public.delegacao_visibilidade_corporativa
      where id in ('${grantMarina}', '${grantFelipe}');
    insert into public.delegacao_visibilidade_corporativa
      (id, organization_id, user_id, oauth_client_id, efeitos, expires_at)
      values
        ('${grantMarina}', '${orgA}', '${marina}', '${clientId}',
         array['buscar','ler','baixar']::text[], now() + interval '1 day'),
        ('${grantFelipe}', '${orgA}', '${felipe}', 'outro-client',
         array['buscar']::text[], now() + interval '1 day');
    do $m$ begin
      insert into public.messages (id, organization_id, conversation_id, channel_session_id, contact_id, type, direction, body)
        values
          ('${msgCorp}', '${orgA}', '${convCorp}', '${sessCorp}', '${ctOp}', 'text', 'inbound', 'corp'),
          ('${msgPessoal}', '${orgA}', '${convPessoal}', '${sessPessoal}', '${ctPessoal}', 'text', 'inbound', 'pessoal'),
          ('${msgUnknown}', '${orgA}', '${convUnknown}', '${sessUnknown}', '${ctUnknownSess}', 'text', 'inbound', 'unknown'),
          ('${msgB}', '${orgB}', '${convB}', '${sessB}', '${ctB}', 'text', 'inbound', 'org-b');
    exception when unique_violation then null; end $m$;
    do $l$ begin
      insert into public.locacao_imoveis (id, organization_id, logradouro, chave_endereco)
        values ('${imovelA}', '${orgA}', 'Rua invariante', 'deleg-inv-a');
      insert into public.locacao_processos (id, organization_id, imovel_id, status)
        values ('${procA}', '${orgA}', '${imovelA}', 'lead');
      insert into public.locacao_processo_documentos (
        id, organization_id, processo_id, categoria, storage_path, mime, tamanho_bytes, sha256, origem
      ) values (
        '${docA}', '${orgA}', '${procA}', 'relatorio',
        '${orgA}/processos/${procA}/relatorio.pdf', 'application/pdf', 1, '${shaDoc}', 'relatorio'
      );
    exception when unique_violation then null; end $l$;
  `);
});

describe("delegacao_visibilidade_corporativa — RLS", () => {
  it("Marina lê o próprio grant e zero do Felipe; org B lê zero", () => {
    expect(
      cookie(marina, `select count(*) from public.delegacao_visibilidade_corporativa where id = '${grantMarina}';`),
    ).toBe(1);
    expect(
      cookie(marina, `select count(*) from public.delegacao_visibilidade_corporativa where id = '${grantFelipe}';`),
    ).toBe(0);
    expect(
      cookie(membroB, `select count(*) from public.delegacao_visibilidade_corporativa;`),
    ).toBe(0);
  });

  it("authenticated não escreve grant; anon não lê", () => {
    expect(
      sql(`select has_table_privilege('authenticated','public.delegacao_visibilidade_corporativa','insert'),
        has_table_privilege('authenticated','public.delegacao_visibilidade_corporativa','update'),
        has_table_privilege('authenticated','public.delegacao_visibilidade_corporativa','delete'),
        has_table_privilege('anon','public.delegacao_visibilidade_corporativa','select'),
        has_table_privilege('service_role','public.delegacao_visibilidade_corporativa','insert');`),
    ).toBe("f|f|f|f|t");
  });
});

describe.sequential("conversations — cookie Inbox vs OAuth + grant", () => {
  it("cookie da Marina (agent own) não vê conversa atribuída ao Felipe", () => {
    expect(cookie(marina, `select count(*) from public.conversations where id = '${convCorp}';`)).toBe(0);
  });

  it("cookie do Felipe (admin) vê a Inbox, inclusive pessoal — a coluna não aperta a Inbox", () => {
    expect(cookie(felipe, `select count(*) from public.conversations where id = '${convCorp}';`)).toBe(1);
    expect(cookie(felipe, `select count(*) from public.conversations where id = '${convPessoal}';`)).toBe(1);
  });

  it("OAuth da Marina + grant vê só corporativa operacional da org; recusa pessoal, unknown, outra org", () => {
    expect(oauth(marina, `select count(*) from public.conversations where id = '${convCorp}';`)).toBe(1);
    expect(oauth(marina, `select count(*) from public.conversations where id = '${convPessoal}';`)).toBe(0);
    expect(oauth(marina, `select count(*) from public.conversations where id = '${convUnknown}';`)).toBe(0);
    expect(oauth(marina, `select count(*) from public.conversations where id = '${convB}';`)).toBe(0);
  });

  it("OAuth do Felipe admin sem grant deste client_id não herda a Inbox (sem fallback de dono)", () => {
    expect(oauth(felipe, `select count(*) from public.conversations where id = '${convCorp}';`)).toBe(0);
    expect(oauth(felipe, `select count(*) from public.conversations where id = '${convPessoal}';`)).toBe(0);
    expect(oauth(felipe, `select count(*) from public.contacts where id = '${ctOp}';`)).toBe(0);
    expect(oauth(felipe, `select count(*) from public.channel_sessions where id = '${sessCorp}';`)).toBe(0);
  });

  it("OAuth+grant lê mensagem da corporativa por id e zero de pessoal, unknown, outra org", () => {
    expect(oauth(marina, `select count(*) from public.messages where id = '${msgCorp}';`)).toBe(1);
    expect(oauth(marina, `select count(*) from public.messages where id = '${msgPessoal}';`)).toBe(0);
    expect(oauth(marina, `select count(*) from public.messages where id = '${msgUnknown}';`)).toBe(0);
    expect(oauth(marina, `select count(*) from public.messages where id = '${msgB}';`)).toBe(0);
  });

  it("cookie da Inbox não aperta: Felipe admin vê mensagem pessoal; Marina agent own não vê a atribuída ao Felipe", () => {
    expect(cookie(felipe, `select count(*) from public.messages where id = '${msgCorp}';`)).toBe(1);
    expect(cookie(felipe, `select count(*) from public.messages where id = '${msgPessoal}';`)).toBe(1);
    expect(cookie(marina, `select count(*) from public.messages where id = '${msgCorp}';`)).toBe(0);
  });

  it("OAuth não escreve conversa nem mensagem; cookie do admin continua escrevendo conversa", () => {
    expect(
      writeJwt(
        `{"sub":"${marina}","role":"authenticated","client_id":"${clientId}"}`,
        `update public.conversations set tags = array['oauth'] where id = '${convCorp}'`,
      ),
    ).toBe(0);
    expect(
      writeJwt(
        `{"sub":"${marina}","role":"authenticated","client_id":"${clientId}"}`,
        `insert into public.messages (id, organization_id, conversation_id, channel_session_id, contact_id, type, direction, body) values ('eeeeeeee-6666-4000-8000-0000000000aa', '${orgA}', '${convCorp}', '${sessCorp}', '${ctOp}', 'text', 'outbound', 'oauth-write')`,
      ),
    ).toBe(0);
    expect(
      writeJwt(
        `{"sub":"${felipe}","role":"authenticated"}`,
        `update public.conversations set tags = array['cookie'] where id = '${convCorp}'`,
      ),
    ).toBe(1);
  });

  it("OAuth+grant lê contato operacional e sessão corporativa; recusa pessoal, unknown, outra org", () => {
    expect(oauth(marina, `select count(*) from public.contacts where id = '${ctOp}';`)).toBe(1);
    expect(oauth(marina, `select count(*) from public.contacts where id = '${ctPessoal}';`)).toBe(0);
    expect(oauth(marina, `select count(*) from public.contacts where id = '${ctB}';`)).toBe(0);
    expect(oauth(marina, `select count(*) from public.channel_sessions where id = '${sessCorp}';`)).toBe(1);
    expect(oauth(marina, `select count(*) from public.channel_sessions where id = '${sessPessoal}';`)).toBe(0);
    expect(oauth(marina, `select count(*) from public.channel_sessions where id = '${sessUnknown}';`)).toBe(0);
    expect(oauth(marina, `select count(*) from public.channel_sessions where id = '${sessB}';`)).toBe(0);
  });

  it("cookie do Felipe continua vendo contato pessoal e sessão pessoal (spec 21 não aperta a Inbox)", () => {
    expect(cookie(felipe, `select count(*) from public.contacts where id = '${ctPessoal}';`)).toBe(1);
    expect(cookie(felipe, `select count(*) from public.channel_sessions where id = '${sessPessoal}';`)).toBe(1);
    expect(cookie(felipe, `select count(*) from public.channel_sessions where id = '${sessUnknown}';`)).toBe(1);
  });

  it("locacao_processo_documentos: cookie da org lê; OAuth default-deny mesmo com grant", () => {
    expect(cookie(felipe, `select count(*) from public.locacao_processo_documentos where id = '${docA}';`)).toBe(1);
    expect(cookie(marina, `select count(*) from public.locacao_processo_documentos where id = '${docA}';`)).toBe(1);
    expect(oauth(marina, `select count(*) from public.locacao_processo_documentos where id = '${docA}';`)).toBe(0);
    expect(oauth(felipe, `select count(*) from public.locacao_processo_documentos where id = '${docA}';`)).toBe(0);
  });

  it("OAuth não escreve contato operacional; cookie do admin continua atualizando display_name", () => {
    expect(
      writeJwt(
        `{"sub":"${marina}","role":"authenticated","client_id":"${clientId}"}`,
        `update public.contacts set display_name = 'oauth' where id = '${ctOp}'`,
      ),
    ).toBe(0);
    expect(
      writeJwt(
        `{"sub":"${felipe}","role":"authenticated"}`,
        `update public.contacts set display_name = 'cookie' where id = '${ctOp}'`,
      ),
    ).toBe(1);
  });

  it("storage.objects: authenticated não ganha SELECT no bucket whatsapp-media por esta migration", () => {
    const priv = sql(
      `select has_table_privilege('authenticated','storage.objects','select');`,
    );
    if (priv === "f") {
      expect(priv).toBe("f");
      return;
    }
    expect(
      oauth(marina, `select count(*) from storage.objects where bucket_id = 'whatsapp-media';`),
    ).toBe(0);
  });

  it("grant expirado ou client_id errado não abre a conversa nem a mensagem", () => {
    sql(`update public.delegacao_visibilidade_corporativa
           set expires_at = now() - interval '1 minute'
         where id = '${grantMarina}';`);
    expect(oauth(marina, `select count(*) from public.conversations where id = '${convCorp}';`)).toBe(0);
    expect(oauth(marina, `select count(*) from public.messages where id = '${msgCorp}';`)).toBe(0);
    expect(oauth(marina, `select count(*) from public.contacts where id = '${ctOp}';`)).toBe(0);
    sql(`update public.delegacao_visibilidade_corporativa
           set expires_at = now() + interval '1 day', revoked_at = now()
         where id = '${grantMarina}';`);
    expect(oauth(marina, `select count(*) from public.conversations where id = '${convCorp}';`)).toBe(0);
    expect(oauth(marina, `select count(*) from public.messages where id = '${msgCorp}';`)).toBe(0);
    expect(oauth(marina, `select count(*) from public.channel_sessions where id = '${sessCorp}';`)).toBe(0);
    sql(`update public.delegacao_visibilidade_corporativa
           set revoked_at = null
         where id = '${grantMarina}';`);
    expect(
      oauth(marina, `select count(*) from public.conversations where id = '${convCorp}';`, "client-errado"),
    ).toBe(0);
    expect(oauth(marina, `select count(*) from public.conversations where id = '${convCorp}';`)).toBe(1);
    expect(oauth(marina, `select count(*) from public.messages where id = '${msgCorp}';`)).toBe(1);
  });
});
