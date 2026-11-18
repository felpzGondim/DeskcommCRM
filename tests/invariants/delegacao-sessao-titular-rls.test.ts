/** A 0775 amplia a leitura para um vínculo da titular e preserva os vetos da 0774. */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

import { lastLine, motivoDoErro, sql } from "./psql-transporte";

const titular = randomUUID();
const outraPessoa = randomUUID();
const org = randomUUID();
const orgAlheia = randomUUID();
const sessao = randomUUID();
const alheia = randomUUID();
const desconhecida = randomUUID();
const empresarial = randomUUID();
const conta = randomUUID();
const client = randomUUID();
const c1 = randomUUID();
const c2 = randomUUID();
const c3 = randomUUID();
const c4 = randomUUID();
const c5 = randomUUID();
const ct1 = randomUUID();
const ct2 = randomUUID();
const ctPessoal = randomUUID();
const mensagem = randomUUID();
const m = readFileSync(
  "supabase/migrations/20261118140000_0775_delegacao_envio_sessao_titular.sql",
  "utf8",
);
const anexo = `${org}/${c1}/prova.pdf`;

function comoTitular(consulta: string): string {
  const claims = JSON.stringify({ sub: titular, role: "oauth_delegado", client_id: client });
  return lastLine(
    sql(`
    set role oauth_delegado;
    select set_config('request.jwt.claims', '${claims}', false);
    ${consulta}
  `),
  );
}

function vincular(s: string, o: string, u: string) {
  return sql(`
    insert into public.delegacao_sessoes_titular (channel_session_id, organization_id, user_id)
    values ('${s}', '${o}', '${u}');
  `);
}

function motivoDoVinculo(s: string, o: string, u: string): string {
  try {
    vincular(s, o, u);
    return "";
  } catch (e) {
    return motivoDoErro(e);
  }
}

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${titular}', 'delegacao-a-${titular}@example.test'), ('${outraPessoa}', 'delegacao-b-${outraPessoa}@example.test');
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${org}', 'delegacao-a-${org}', 'Organização sintética A', 'Organização sintética A'),
      ('${orgAlheia}', 'delegacao-b-${orgAlheia}', 'Organização sintética B', 'Organização sintética B');
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${titular}', '${org}', 'admin', now()),
      ('${titular}', '${orgAlheia}', 'agent', now()),
      ('${outraPessoa}', '${orgAlheia}', 'admin', now());
    insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted, status) values
      ('${sessao}', '${org}', 'titular-${sessao}', '\\x00', 'WORKING'),
      ('${alheia}', '${orgAlheia}', 'alheia-${alheia}', '\\x00', 'WORKING'),
      ('${desconhecida}', '${org}', 'desconhecida-${desconhecida}', '\\x00', 'WORKING'),
      ('${empresarial}', '${org}', 'empresarial-${empresarial}', '\\x00', 'WORKING');
    insert into public.delegacao_contas_empresariais (id, organization_id) values ('${conta}', '${org}');
    insert into public.delegacao_sessoes_empresariais (channel_session_id, organization_id, conta_empresarial_id)
      values ('${empresarial}', '${org}', '${conta}');
    insert into public.delegacao_clientes_autorizados (oauth_client_id) values ('${client}');
    insert into public.delegacao_visibilidade_corporativa
      (organization_id, user_id, oauth_client_id, efeitos, expires_at)
    values
      ('${org}', '${titular}', '${client}', array['buscar','ler','baixar','enviar'], now() + interval '1 day'),
      ('${orgAlheia}', '${titular}', '${client}', array['buscar','ler'], now() + interval '1 day'),
      ('${orgAlheia}', '${outraPessoa}', '${client}', array['buscar','ler'], now() + interval '1 day');
    insert into public.contacts (id, organization_id, display_name, phone_number, is_personal) values
      ('${ct1}', '${org}', 'Contato sintético A', '+12025550101', false),
      ('${ct2}', '${orgAlheia}', 'Contato sintético B', '+12025550102', false),
      ('${ctPessoal}', '${org}', 'Contato sintético pessoal', '+12025550103', true);
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status, is_group) values
      ('${c1}', '${org}', '${ct1}', '${sessao}', 'open', false),
      ('${c2}', '${orgAlheia}', '${ct2}', '${alheia}', 'open', false),
      ('${c3}', '${org}', '${ct1}', '${desconhecida}', 'open', false),
      ('${c4}', '${org}', '${ctPessoal}', '${sessao}', 'open', false),
      ('${c5}', '${org}', '${ct1}', '${empresarial}', 'open', false);
    insert into public.messages (id, organization_id, conversation_id, channel_session_id, contact_id, type, direction, media_storage_path)
    values ('${mensagem}', '${org}', '${c1}', '${sessao}', '${ct1}', 'document', 'inbound', '${anexo}');
    insert into storage.buckets (id, name, public)
      values ('whatsapp-media', 'whatsapp-media', false) on conflict (id) do nothing;
    insert into storage.objects (bucket_id, name) values ('whatsapp-media', '${anexo}');
  `);
  vincular(sessao, org, titular);
  vincular(alheia, orgAlheia, outraPessoa);
});

describe("0775 — leitura e exclusividade de sessão", () => {
  it("lê conversa, mensagem e mídia titulares; preserva a leitura empresarial", () => {
    expect(comoTitular(`select count(*) from conversations where id in ('${c1}', '${c5}');`)).toBe(
      "2",
    );
    expect(comoTitular(`select count(*) from messages where id = '${mensagem}';`)).toBe("1");
    expect(comoTitular(`select count(*) from storage.objects where name = '${anexo}';`)).toBe("1");
    expect(
      comoTitular(`select origem || ':' || status from fn_delegacao_listar_sessoes('${sessao}');`),
    ).toBe("titular:WORKING");
  });

  it("outro vínculo, sessão desconhecida e contato pessoal seguem invisíveis", () => {
    expect(
      comoTitular(`select count(*) from conversations where id in ('${c2}', '${c3}', '${c4}');`),
    ).toBe("0");
    expect(
      comoTitular(
        `select count(*) from delegacao_sessoes_titular where channel_session_id = '${alheia}';`,
      ),
    ).toBe("0");
    expect(comoTitular(`select count(*) from fn_delegacao_listar_sessoes('${alheia}');`)).toBe("0");
    expect(
      comoTitular(`select has_table_privilege(current_user, 'public.channel_sessions', 'select');`),
    ).toBe("f");
  });

  it("trigger recusa papel insuficiente, sessão de outra org e origem empresarial", () => {
    expect(motivoDoVinculo(alheia, orgAlheia, titular)).toMatch(/membership ativa owner ou admin/);
    expect(motivoDoVinculo(desconhecida, orgAlheia, outraPessoa)).toMatch(/não pertence/);
    expect(motivoDoVinculo(empresarial, org, titular)).toMatch(/vínculo empresarial ativo/);
    expect(() =>
      sql(`
      insert into public.delegacao_sessoes_empresariais (channel_session_id, organization_id, conta_empresarial_id)
      values ('${sessao}', '${org}', '${conta}');
    `),
    ).toThrow(/vínculo titular ativo/);
  });

  it("perde acesso quando membership deixa de ser admin com a mesma sessão", () => {
    sql(
      `update public.user_organizations set role = 'agent' where user_id = '${titular}' and organization_id = '${org}';`,
    );
    try {
      expect(comoTitular(`select count(*) from conversations where id = '${c1}';`)).toBe("0");
      expect(comoTitular(`select count(*) from fn_delegacao_listar_sessoes('${sessao}');`)).toBe(
        "0",
      );
    } finally {
      sql(
        `update public.user_organizations set role = 'admin' where user_id = '${titular}' and organization_id = '${org}';`,
      );
    }
  });

  it("efeito enviar mantém o papel sem INSERT/UPDATE de mensagens", () => {
    expect(
      comoTitular(`select has_table_privilege(current_user, 'public.messages', 'insert')::int
                             + has_table_privilege(current_user, 'public.messages', 'update')::int;`),
    ).toBe("0");
  });

  it("reaplicar preserva linhas de sessão, grant enviar e RLS", () => {
    sql(m);
    sql(m);
    expect(
      comoTitular(
        `select count(*) from delegacao_sessoes_titular where channel_session_id = '${sessao}';`,
      ),
    ).toBe("1");
    expect(
      comoTitular(`select count(*) from delegacao_visibilidade_corporativa
       where organization_id = '${org}' and 'enviar' = any(efeitos);`),
    ).toBe("1");
    expect(comoTitular(`select count(*) from conversations where id = '${c1}';`)).toBe("1");
  });
});
