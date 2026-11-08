/**
 * Papel dedicado oauth_delegado no schema real do CRM (migration 0774).
 *
 * Duas identidades sintéticas (sem PII): uid-a na org A, uid-b na org B.
 * SET ROLE + request.jwt.claims = o mesmo caminho PostgREST (authenticator
 * SET ROLE). JWT mock NÃO é prova do Auth; o hook SQL é exercido por SELECT.
 * Storage.objects tem de ter RLS ligada — skip ≠ prova.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { lastLine, motivoDoErro, sql } from "./psql-transporte";

const ORG_A = "dddddddd-0000-4000-8000-00000000000a";
const ORG_B = "dddddddd-0000-4000-8000-00000000000b";
const USER_A = "dddddddd-1111-4000-8000-00000000000a";
const USER_B = "dddddddd-1111-4000-8000-00000000000b";
const SESS_A = "dddddddd-2222-4000-8000-00000000000a";
const SESS_B = "dddddddd-2222-4000-8000-00000000000b";
const CT_CORP_A = "dddddddd-3333-4000-8000-0000000000c1";
const CT_PESS_A = "dddddddd-3333-4000-8000-0000000000a1";
const CT_CORP_B = "dddddddd-3333-4000-8000-0000000000c2";
const CONV_CORP_A = "dddddddd-4444-4000-8000-0000000000c1";
const CONV_PESS_A = "dddddddd-4444-4000-8000-0000000000a1";
const CONV_CORP_B = "dddddddd-4444-4000-8000-0000000000c2";
const MSG_CORP_A = "dddddddd-5555-4000-8000-0000000000c1";
const MSG_PESS_A = "dddddddd-5555-4000-8000-0000000000a1";
const IM_A = "dddddddd-6666-4000-8000-00000000000a";
const IM_B = "dddddddd-6666-4000-8000-00000000000b";
const PROC_A = "dddddddd-7777-4000-8000-00000000000a";
const PROC_B = "dddddddd-7777-4000-8000-00000000000b";
const CLIENT_OK = "11111111-1111-4111-8111-111111111111";
const CLIENT_OUTRO = "22222222-2222-4222-8222-222222222222";
const SHA = "ab".repeat(32);
const PATH_CORP = `${ORG_A}/midia/corp.bin`;
const PATH_PESS = `${ORG_A}/midia/pess.bin`;
const PATH_DOC = `${ORG_A}/processos/${PROC_A}/relatorio.pdf`;

function claims(user: string, role: string, client?: string): string {
  const extra = client ? `,"client_id":"${client}"` : "";
  return `{"sub":"${user}","role":"${role}"${extra}}`;
}

function countAs(role: string, jwt: string, query: string): number {
  const out = sql(`
    set role ${role};
    select set_config('request.jwt.claims', '${jwt}', false);
    ${query}
  `);
  const last = lastLine(out);
  if (!/^\d+$/.test(last)) throw new Error(`saída inesperada: ${out}`);
  return Number(last);
}

function priv(role: string, rel: string, p: string): boolean {
  return lastLine(sql(`select has_table_privilege('${role}', '${rel}', '${p}');`)) === "t";
}

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${USER_A}', 'deleg-a@invariant.test'),
      ('${USER_B}', 'deleg-b@invariant.test')
    on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'deleg-a', 'Deleg A', 'Deleg A'),
      ('${ORG_B}', 'deleg-b', 'Deleg B', 'Deleg B')
    on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${USER_A}', '${ORG_A}', 'agent', now()),
      ('${USER_B}', '${ORG_B}', 'agent', now())
    on conflict do nothing;
    insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted) values
      ('${SESS_A}', '${ORG_A}', 'deleg-a', '\\x00'),
      ('${SESS_B}', '${ORG_B}', 'deleg-b', '\\x00')
    on conflict (id) do nothing;
    insert into public.contacts (id, organization_id, display_name, is_personal) values
      ('${CT_CORP_A}', '${ORG_A}', 'Contato corp A', false),
      ('${CT_PESS_A}', '${ORG_A}', 'Contato pess A', true),
      ('${CT_CORP_B}', '${ORG_B}', 'Contato corp B', false)
    on conflict (id) do nothing;
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status, is_group) values
      ('${CONV_CORP_A}', '${ORG_A}', '${CT_CORP_A}', '${SESS_A}', 'open', false),
      ('${CONV_PESS_A}', '${ORG_A}', '${CT_PESS_A}', '${SESS_A}', 'open', false),
      ('${CONV_CORP_B}', '${ORG_B}', '${CT_CORP_B}', '${SESS_B}', 'open', false)
    on conflict (id) do nothing;
    insert into public.messages (id, organization_id, conversation_id, channel_session_id, contact_id, type, direction, body, media_storage_path) values
      ('${MSG_CORP_A}', '${ORG_A}', '${CONV_CORP_A}', '${SESS_A}', '${CT_CORP_A}', 'image', 'inbound', 'corp', '${PATH_CORP}'),
      ('${MSG_PESS_A}', '${ORG_A}', '${CONV_PESS_A}', '${SESS_A}', '${CT_PESS_A}', 'image', 'inbound', 'pess', '${PATH_PESS}')
    on conflict (id) do nothing;
    insert into public.locacao_imoveis (id, organization_id, logradouro, chave_endereco) values
      ('${IM_A}', '${ORG_A}', 'Rua A', 'rua-a'),
      ('${IM_B}', '${ORG_B}', 'Rua B', 'rua-b')
    on conflict (id) do nothing;
    insert into public.locacao_processos (id, organization_id, imovel_id, status) values
      ('${PROC_A}', '${ORG_A}', '${IM_A}', 'lead'),
      ('${PROC_B}', '${ORG_B}', '${IM_B}', 'lead')
    on conflict (id) do nothing;
    insert into public.locacao_processo_conversas (organization_id, processo_id, conversation_id, origem) values
      ('${ORG_A}', '${PROC_A}', '${CONV_CORP_A}', 'criacao'),
      ('${ORG_B}', '${PROC_B}', '${CONV_CORP_B}', 'criacao');
    insert into public.locacao_processo_documentos (
      organization_id, processo_id, categoria, storage_path, mime, tamanho_bytes, sha256, origem
    ) values
      ('${ORG_A}', '${PROC_A}', 'relatorio', '${PATH_DOC}', 'application/pdf', 1, '${SHA}', 'relatorio');
    insert into storage.buckets (id, name, public) values
      ('whatsapp-media', 'whatsapp-media', false),
      ('locacao-processos', 'locacao-processos', false)
    on conflict (id) do nothing;
    insert into storage.objects (bucket_id, name) values
      ('whatsapp-media', '${PATH_CORP}'),
      ('whatsapp-media', '${PATH_PESS}'),
      ('locacao-processos', '${PATH_DOC}');
    insert into public.delegacao_clientes_autorizados (oauth_client_id, hook_version) values
      ('${CLIENT_OK}', 1);
    insert into public.delegacao_visibilidade_corporativa
      (organization_id, user_id, oauth_client_id, efeitos, expires_at)
    values
      ('${ORG_A}', '${USER_A}', '${CLIENT_OK}', array['buscar','ler','baixar']::text[], now() + interval '1 day'),
      ('${ORG_B}', '${USER_B}', '${CLIENT_OK}', array['buscar','ler','baixar']::text[], now() + interval '1 day');
  `);
});

const jwtA = claims(USER_A, "oauth_delegado", CLIENT_OK);
const jwtB = claims(USER_B, "oauth_delegado", CLIENT_OK);
const jwtCookieA = claims(USER_A, "authenticated");
const jwtOutro = claims(USER_A, "oauth_delegado", CLIENT_OUTRO);

describe("0774 papel dedicado — catálogo", () => {
  it("oauth_delegado existe NOINHERIT e não é membro de authenticated", () => {
    expect(lastLine(sql(`select rolname from pg_roles where rolname = 'oauth_delegado';`))).toBe(
      "oauth_delegado",
    );
    expect(lastLine(sql(`select rolinherit from pg_roles where rolname = 'oauth_delegado';`))).toBe(
      "f",
    );
    expect(
      lastLine(sql(`select pg_has_role('oauth_delegado', 'authenticated', 'member');`)),
    ).toBe("f");
  });

  it("authenticator pode SET ROLE oauth_delegado", () => {
    expect(lastLine(sql(`select pg_has_role('authenticator', 'oauth_delegado', 'member');`))).toBe(
      "t",
    );
  });

  it("storage.objects tem RLS ligada (não skip)", () => {
    expect(
      lastLine(
        sql(`select c.relrowsecurity::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'storage' and c.relname = 'objects';`),
      ),
    ).toBe("true");
  });

  it("TRUNCATE é ACL, não RLS: oauth_delegado não tem TRUNCATE", () => {
    expect(priv("oauth_delegado", "public.conversations", "truncate")).toBe(false);
    expect(priv("oauth_delegado", "public.messages", "truncate")).toBe(false);
    expect(priv("oauth_delegado", "storage.objects", "truncate")).toBe(false);
  });

  it("oauth_delegado não herda EXECUTE de fn_conversation_scope (DEFINER cookie)", () => {
    expect(
      lastLine(
        sql(`select has_function_privilege('oauth_delegado', 'public.fn_conversation_scope()', 'execute');`),
      ),
    ).toBe("f");
  });

  it("SELECT da cookie em conversations/messages/contacts é TO authenticated, não PUBLIC", () => {
    expect(
      lastLine(
        sql(`select coalesce(array_agg(r.rolname order by r.rolname)::text, '{}')
               from pg_policy p
               join pg_roles r on r.oid = any (p.polroles)
              where p.polrelid = 'public.conversations'::regclass
                and p.polname = 'conversations_select';`),
      ),
    ).toBe("{authenticated}");
  });
});

describe("0774 — cookie intacta", () => {
  it("authenticated da org A lê conversa pessoal (Inbox)", () => {
    expect(
      countAs(
        "authenticated",
        jwtCookieA,
        `select count(*) from public.conversations where id = '${CONV_PESS_A}';`,
      ),
    ).toBe(1);
  });

  it("authenticated da org A lê conversa corporativa", () => {
    expect(
      countAs(
        "authenticated",
        jwtCookieA,
        `select count(*) from public.conversations where id = '${CONV_CORP_A}';`,
      ),
    ).toBe(1);
  });

  it("authenticated da org A lê o documento de locação (tabela CRM)", () => {
    expect(
      countAs(
        "authenticated",
        jwtCookieA,
        `select count(*) from public.locacao_processo_documentos where organization_id = '${ORG_A}';`,
      ),
    ).toBe(1);
  });
});

describe("0774 — duas identidades sintéticas", () => {
  it("identidade A vê só a conversa corporativa da org A", () => {
    expect(
      countAs(
        "oauth_delegado",
        jwtA,
        `select count(*) from public.conversations where id = '${CONV_CORP_A}';`,
      ),
    ).toBe(1);
    expect(
      countAs(
        "oauth_delegado",
        jwtA,
        `select count(*) from public.conversations where id = '${CONV_PESS_A}';`,
      ),
    ).toBe(0);
    expect(
      countAs(
        "oauth_delegado",
        jwtA,
        `select count(*) from public.conversations where id = '${CONV_CORP_B}';`,
      ),
    ).toBe(0);
  });

  it("identidade B vê só a conversa corporativa da org B", () => {
    expect(
      countAs(
        "oauth_delegado",
        jwtB,
        `select count(*) from public.conversations where id = '${CONV_CORP_B}';`,
      ),
    ).toBe(1);
    expect(
      countAs(
        "oauth_delegado",
        jwtB,
        `select count(*) from public.conversations where id = '${CONV_CORP_A}';`,
      ),
    ).toBe(0);
  });

  it("client desconhecido recusa corporativa", () => {
    expect(
      countAs(
        "oauth_delegado",
        jwtOutro,
        `select count(*) from public.conversations where id = '${CONV_CORP_A}';`,
      ),
    ).toBe(0);
  });

  it("mensagem/anexo corporativo sim, pessoal não", () => {
    expect(
      countAs(
        "oauth_delegado",
        jwtA,
        `select count(*) from public.messages where id = '${MSG_CORP_A}';`,
      ),
    ).toBe(1);
    expect(
      countAs(
        "oauth_delegado",
        jwtA,
        `select count(*) from public.messages where id = '${MSG_PESS_A}';`,
      ),
    ).toBe(0);
  });

  it("documento de locação corporativo visível; identidade B não vê o da A", () => {
    expect(
      countAs(
        "oauth_delegado",
        jwtA,
        `select count(*) from public.locacao_processo_documentos where organization_id = '${ORG_A}';`,
      ),
    ).toBe(1);
    expect(
      countAs(
        "oauth_delegado",
        jwtB,
        `select count(*) from public.locacao_processo_documentos where organization_id = '${ORG_A}';`,
      ),
    ).toBe(0);
  });

  it("storage corporativo sim, pessoal e cross-org não", () => {
    expect(
      countAs(
        "oauth_delegado",
        jwtA,
        `select count(*) from storage.objects where name = '${PATH_CORP}';`,
      ),
    ).toBe(1);
    expect(
      countAs(
        "oauth_delegado",
        jwtA,
        `select count(*) from storage.objects where name = '${PATH_PESS}';`,
      ),
    ).toBe(0);
    expect(
      countAs(
        "oauth_delegado",
        jwtB,
        `select count(*) from storage.objects where name = '${PATH_CORP}';`,
      ),
    ).toBe(0);
    expect(
      countAs(
        "oauth_delegado",
        jwtA,
        `select count(*) from storage.objects where name = '${PATH_DOC}';`,
      ),
    ).toBe(1);
  });
});

describe("0774 — revogação, escrita, RPC, TRUNCATE, hook", () => {
  it("grant revogado zera a conversa; restaurar devolve", () => {
    sql(`update public.delegacao_visibilidade_corporativa
           set revoked_at = now()
         where user_id = '${USER_A}' and oauth_client_id = '${CLIENT_OK}';`);
    expect(
      countAs(
        "oauth_delegado",
        jwtA,
        `select count(*) from public.conversations where id = '${CONV_CORP_A}';`,
      ),
    ).toBe(0);
    sql(`update public.delegacao_visibilidade_corporativa
           set revoked_at = null
         where user_id = '${USER_A}' and oauth_client_id = '${CLIENT_OK}';`);
    expect(
      countAs(
        "oauth_delegado",
        jwtA,
        `select count(*) from public.conversations where id = '${CONV_CORP_A}';`,
      ),
    ).toBe(1);
  });

  it("oauth_delegado não INSERT/UPDATE em conversations (ACL)", () => {
    expect(priv("oauth_delegado", "public.conversations", "insert")).toBe(false);
    expect(priv("oauth_delegado", "public.conversations", "update")).toBe(false);
    expect(priv("oauth_delegado", "public.messages", "insert")).toBe(false);
    expect(priv("oauth_delegado", "storage.objects", "insert")).toBe(false);
    expect(priv("oauth_delegado", "public.user_organizations", "select")).toBe(false);
    expect(priv("authenticated", "public.delegacao_visibilidade_corporativa", "select")).toBe(
      false,
    );
  });

  it("EXECUTE de RPC DEFINER cookie recusa na sessão", () => {
    let recusou = false;
    try {
      sql(`
        set role oauth_delegado;
        select set_config('request.jwt.claims', '${jwtA}', false);
        select * from public.fn_conversation_scope();
      `);
    } catch (err) {
      recusou = /permission denied|42501/i.test(motivoDoErro(err));
    }
    expect(recusou).toBe(true);
  });

  it("TRUNCATE na sessão oauth_delegado recusa (ACL, não RLS)", () => {
    let recusou = false;
    try {
      sql(`
        set role oauth_delegado;
        truncate public.conversations;
      `);
    } catch (err) {
      recusou = /permission denied|must be owner|42501/i.test(motivoDoErro(err));
    }
    expect(recusou).toBe(true);
  });

  it("hook: client autorizado vira oauth_delegado; cookie permanece authenticated", () => {
    const mapped = lastLine(
      sql(`select public.fn_delegacao_access_token_hook(
        '{"claims":{"role":"authenticated","sub":"${USER_A}","client_id":"${CLIENT_OK}"}}'::jsonb
      )->'claims'->>'role';`),
    );
    expect(mapped).toBe("oauth_delegado");
    const cookie = lastLine(
      sql(`select public.fn_delegacao_access_token_hook(
        '{"claims":{"role":"authenticated","sub":"${USER_A}"}}'::jsonb
      )->'claims'->>'role';`),
    );
    expect(cookie).toBe("authenticated");
    const unknown = lastLine(
      sql(`select public.fn_delegacao_access_token_hook(
        '{"claims":{"role":"authenticated","sub":"${USER_A}","client_id":"${CLIENT_OUTRO}"}}'::jsonb
      )->'claims'->>'role';`),
    );
    expect(unknown).toBe("authenticated");
  });

  it("hook não descarta client_id no replace", () => {
    expect(
      lastLine(
        sql(`select public.fn_delegacao_access_token_hook(
          '{"claims":{"role":"authenticated","sub":"${USER_A}","client_id":"${CLIENT_OK}"}}'::jsonb
        )->'claims'->>'client_id';`),
      ),
    ).toBe(CLIENT_OK);
  });

  it("authenticator SET ROLE lê a corporativa (caminho PostgREST)", () => {
    const n = lastLine(
      sql(`
        set session authorization authenticator;
        set role oauth_delegado;
        select set_config('request.jwt.claims', '${jwtA}', false);
        select count(*) from public.conversations where id = '${CONV_CORP_A}';
      `),
    );
    expect(n).toBe("1");
  });
});
