/**
 * O update.sh reaplica o baseline inteiro. A 0774 antiga DROP da
 * delegacao_sessoes_empresariais e só reconcedia SELECT de storage se
 * USAGE faltasse. Este arquivo grava conta/vínculo/allowlist/grant
 * sintéticos (sem PII), reaplica o baseline como o update faz, e afirma
 * que as linhas e os privilégios de leitura continuam — e o download
 * positivo ainda passa.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vitest";

import { lastLine, sql } from "./psql-transporte";

const MIGRACAO = readFileSync(
  "supabase/migrations/20261108210000_0774_delegacao_papel_dedicado.sql",
  "utf8",
);
const ATIVAR = readFileSync("supabase/delegacao-storage-ativar.sql", "utf8");

const ORG = "eeeeeeee-0000-4000-8000-00000000000a";
const USER = "eeeeeeee-1111-4000-8000-00000000000a";
const SESS = "eeeeeeee-2222-4000-8000-00000000000a";
const CONTA = "eeeeeeee-8888-4000-8000-00000000000a";
const CT = "eeeeeeee-3333-4000-8000-00000000000a";
const CONV = "eeeeeeee-4444-4000-8000-00000000000a";
const MSG = "eeeeeeee-5555-4000-8000-00000000000a";
const IM = "eeeeeeee-6666-4000-8000-00000000000a";
const PROC = "eeeeeeee-7777-4000-8000-00000000000a";
const CLIENT = "eeeeeeee-1111-4111-8111-111111111111";
const SHA = "cd".repeat(32);
const PATH_CORP = `${ORG}/midia/corp.bin`;
const PATH_DOC = `${ORG}/processos/${PROC}/relatorio.pdf`;
const JWT = `{"sub":"${USER}","role":"oauth_delegado","client_id":"${CLIENT}"}`;

function flag(q: string): boolean {
  return lastLine(sql(q)) === "t";
}

function countAs(query: string): number {
  const out = sql(`
    set role oauth_delegado;
    select set_config('request.jwt.claims', '${JWT}', false);
    ${query}
  `);
  const last = lastLine(out);
  if (!/^\d+$/.test(last)) throw new Error(`saída inesperada: ${out}`);
  return Number(last);
}

function privs(): { usage: boolean; objects: boolean; buckets: boolean } {
  return {
    usage: flag(`select has_schema_privilege('oauth_delegado', 'storage', 'usage');`),
    objects: flag(`select has_table_privilege('oauth_delegado', 'storage.objects', 'select');`),
    buckets: flag(`select has_table_privilege('oauth_delegado', 'storage.buckets', 'select');`),
  };
}

function linhas(): {
  contas: string;
  sessoes: string;
  allowlist: string;
  grants: string;
} {
  return {
    contas: lastLine(
      sql(`select count(*) from public.delegacao_contas_empresariais where id = '${CONTA}';`),
    ),
    sessoes: lastLine(
      sql(
        `select count(*) from public.delegacao_sessoes_empresariais where channel_session_id = '${SESS}';`,
      ),
    ),
    allowlist: lastLine(
      sql(
        `select count(*) from public.delegacao_clientes_autorizados where oauth_client_id = '${CLIENT}';`,
      ),
    ),
    grants: lastLine(
      sql(
        `select count(*) from public.delegacao_visibilidade_corporativa where user_id = '${USER}' and oauth_client_id = '${CLIENT}';`,
      ),
    ),
  };
}

function reaplicarBaselineComoUpdate(): void {
  const container = process.env.TEST_DB_CONTAINER;
  const psqlLocal = process.env.TEST_DB_PSQL;
  if (psqlLocal) {
    const conn = process.env.TEST_DB_CONN ?? "postgres://postgres@localhost/postgres";
    execFileSync(psqlLocal, [conn, "-v", "ON_ERROR_STOP=1", "-q", "-f", "supabase/baseline.sql"], {
      timeout: 180_000,
    });
    execFileSync(
      psqlLocal,
      [conn, "-v", "ON_ERROR_STOP=1", "-q", "-f", "supabase/delegacao-storage-ativar.sql"],
      { timeout: 30_000 },
    );
    return;
  }
  if (!container) {
    throw new Error("nem TEST_DB_CONTAINER nem TEST_DB_PSQL — rode via pnpm test:db");
  }
  execFileSync("docker", ["cp", "supabase/baseline.sql", `${container}:/tmp/baseline-reapply.sql`]);
  execFileSync("docker", [
    "cp",
    "supabase/delegacao-storage-ativar.sql",
    `${container}:/tmp/delegacao-storage-ativar.sql`,
  ]);
  execFileSync(
    "docker",
    [
      "exec",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-q",
      "-f",
      "/tmp/baseline-reapply.sql",
    ],
    { timeout: 180_000 },
  );
  execFileSync(
    "docker",
    [
      "exec",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-q",
      "-f",
      "/tmp/delegacao-storage-ativar.sql",
    ],
    { timeout: 30_000 },
  );
}

beforeAll(() => {
  sql(MIGRACAO);
  sql(ATIVAR);
  sql(`
    insert into auth.users (id, email) values
      ('${USER}', 'deleg-reapply@invariant.test')
    on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG}', 'deleg-reapply', 'Deleg Reapply', 'Deleg Reapply')
    on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${USER}', '${ORG}', 'agent', now())
    on conflict do nothing;
    insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted, status) values
      ('${SESS}', '${ORG}', 'deleg-reapply', '\\x00', 'WORKING')
    on conflict (id) do nothing;
    insert into public.delegacao_contas_empresariais (id, organization_id) values
      ('${CONTA}', '${ORG}')
    on conflict (id) do nothing;
    insert into public.delegacao_sessoes_empresariais
      (channel_session_id, organization_id, conta_empresarial_id)
    values
      ('${SESS}', '${ORG}', '${CONTA}')
    on conflict (channel_session_id) do nothing;
    insert into public.contacts (id, organization_id, display_name, is_personal) values
      ('${CT}', '${ORG}', 'Contato corp reapply', false)
    on conflict (id) do nothing;
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status, is_group) values
      ('${CONV}', '${ORG}', '${CT}', '${SESS}', 'open', false)
    on conflict (id) do nothing;
    insert into public.messages (id, organization_id, conversation_id, channel_session_id, contact_id, type, direction, body, media_storage_path) values
      ('${MSG}', '${ORG}', '${CONV}', '${SESS}', '${CT}', 'image', 'inbound', 'corp', '${PATH_CORP}')
    on conflict (id) do nothing;
    insert into public.locacao_imoveis (id, organization_id, logradouro, chave_endereco) values
      ('${IM}', '${ORG}', 'Rua R', 'rua-r')
    on conflict (id) do nothing;
    insert into public.locacao_processos (id, organization_id, imovel_id, status) values
      ('${PROC}', '${ORG}', '${IM}', 'lead')
    on conflict (id) do nothing;
    insert into public.locacao_processo_conversas (organization_id, processo_id, conversation_id, origem) values
      ('${ORG}', '${PROC}', '${CONV}', 'criacao')
    on conflict do nothing;
    insert into public.locacao_processo_documentos (
      organization_id, processo_id, categoria, storage_path, mime, tamanho_bytes, sha256, origem
    ) values
      ('${ORG}', '${PROC}', 'relatorio', '${PATH_DOC}', 'application/pdf', 1, '${SHA}', 'relatorio');
    insert into storage.buckets (id, name, public) values
      ('whatsapp-media', 'whatsapp-media', false),
      ('locacao-processos', 'locacao-processos', false)
    on conflict (id) do nothing;
    insert into storage.objects (bucket_id, name) values
      ('whatsapp-media', '${PATH_CORP}'),
      ('locacao-processos', '${PATH_DOC}');
    insert into public.delegacao_clientes_autorizados (oauth_client_id, hook_version) values
      ('${CLIENT}', 1)
    on conflict do nothing;
    insert into public.delegacao_visibilidade_corporativa
      (organization_id, user_id, oauth_client_id, efeitos, expires_at)
    values
      ('${ORG}', '${USER}', '${CLIENT}', array['buscar','ler','baixar']::text[], now() + interval '1 day');
  `);
});

describe("0774 reaplicar o baseline preserva dados e GRANT de storage", () => {
  it("linhas sintéticas, privilégios e download positivo sobrevivem ao update", () => {
    const antes = linhas();
    expect(antes).toEqual({ contas: "1", sessoes: "1", allowlist: "1", grants: "1" });
    const aclAntes = privs();
    expect(aclAntes.usage).toBe(true);
    expect(aclAntes.objects).toBe(true);
    expect(aclAntes.buckets).toBe(true);
    expect(
      countAs(`select count(*) from storage.objects where name = '${PATH_CORP}';`),
    ).toBe(1);
    expect(
      countAs(`select count(*) from storage.objects where name = '${PATH_DOC}';`),
    ).toBe(1);
    expect(
      lastLine(
        sql(
          `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'fn_delegacao_access_token_hook';`,
        ),
      ),
    ).toBe("fn_delegacao_access_token_hook");

    reaplicarBaselineComoUpdate();

    expect(linhas()).toEqual(antes);
    const aclDepois = privs();
    expect(aclDepois).toEqual(aclAntes);
    expect(
      countAs(`select count(*) from storage.objects where name = '${PATH_CORP}';`),
    ).toBe(1);
    expect(
      countAs(`select count(*) from storage.objects where name = '${PATH_DOC}';`),
    ).toBe(1);
    expect(
      lastLine(
        sql(
          `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'fn_delegacao_access_token_hook';`,
        ),
      ),
    ).toBe("fn_delegacao_access_token_hook");
    expect(flag(`select has_table_privilege('oauth_delegado', 'storage.objects', 'insert');`)).toBe(
      false,
    );

    sql(`
      reset role;
      revoke select on storage.objects from oauth_delegado;
    `);
    expect(privs()).toEqual({ usage: true, objects: false, buckets: true });
    sql(MIGRACAO);
    sql(ATIVAR);
    expect(linhas()).toEqual(antes);
    expect(privs()).toEqual(aclAntes);
    expect(
      countAs(`select count(*) from storage.objects where name = '${PATH_CORP}';`),
    ).toBe(1);
  }, 180_000);
});
