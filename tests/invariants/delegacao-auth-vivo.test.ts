/**
 * Cadeia viva: GoTrue tag v2.197.0 → JWT (authorization_code+PKCE+refresh) →
 * PostgREST HTTP → Storage API GET bytes → RLS do CRM. Não é SET ROLE.
 * Skip ≠ prova. Revoke Auth: refresh falha; access JWT até exp (limite).
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { execFileSync, execSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { SignJWT } from "jose";
import { afterAll, describe, expect, it } from "vitest";

import { handleDelegacaoHttp } from "@/lib/auth/delegacao-http";
import { GOTRUE_PROVA_VIVO } from "@/lib/auth/delegacao-gotrue-prova";
import type { ClienteLeitura } from "@/lib/auth/delegacao-superficie";
import { lastLine, sql } from "./psql-transporte";

const JWT_SECRET = "delegacao-vivo-secret-min-32-chars!!";
const HOOK_SECRET = `v1,whsec_${Buffer.from("delegacao-vivo-hook-secret-32b!").toString("base64")}`;
const SUFIXO = `${process.pid}-${Date.now()}`;
const GOTRUE_NOME = `deleg-gotrue-${SUFIXO}`;
const PGRST_NOME = `deleg-pgrst-${SUFIXO}`;
const STORAGE_NOME = `deleg-storage-${SUFIXO}`;
const STORAGE_IMAGEM = "supabase/storage-api:v1.74.0";
const BYTES_CORP = Buffer.from("deleg-corp-vivo-bytes");
const BYTES_PESS = Buffer.from("deleg-pess-vivo-bytes");
const GOTRUE_DB = `gotrue_deleg_${process.pid}`;
const API_EXTERNAL_URL = "http://127.0.0.1:9999";

const USER_A = "dddddddd-1111-4000-8000-00000000000a";
const USER_B = "dddddddd-1111-4000-8000-00000000000b";
const ORG_A = "dddddddd-0000-4000-8000-00000000000a";
const ORG_B = "dddddddd-0000-4000-8000-00000000000b";
const SESS_A = "dddddddd-2222-4000-8000-00000000000a";
const SESS_B = "dddddddd-2222-4000-8000-00000000000b";
const SESS_UNK = "dddddddd-2222-4000-8000-00000000000e";
const CONTA_A = "dddddddd-8888-4000-8000-00000000000a";
const CONTA_B = "dddddddd-8888-4000-8000-00000000000b";
const CT_CORP_A = "dddddddd-3333-4000-8000-0000000000c1";
const CT_PESS_A = "dddddddd-3333-4000-8000-0000000000a1";
const CT_CORP_B = "dddddddd-3333-4000-8000-0000000000c2";
const CT_UNK_A = "dddddddd-3333-4000-8000-0000000000e1";
const CONV_CORP_A = "dddddddd-4444-4000-8000-0000000000c1";
const CONV_PESS_A = "dddddddd-4444-4000-8000-0000000000a1";
const CONV_CORP_B = "dddddddd-4444-4000-8000-0000000000c2";
const CONV_UNK_A = "dddddddd-4444-4000-8000-0000000000e1";
const MSG_CORP_A = "dddddddd-5555-4000-8000-0000000000c1";
const MSG_PESS_A = "dddddddd-5555-4000-8000-0000000000a1";
const MSG_UNK_A = "dddddddd-5555-4000-8000-0000000000e1";
const PATH_CORP = `${ORG_A}/midia/corp.bin`;
const PATH_PESS = `${ORG_A}/midia/pess.bin`;
const PATH_UNK = `${ORG_A}/midia/unk.bin`;

const limpar: string[] = [];
let hookServer: ReturnType<typeof createServer> | null = null;
let clientIdPermitido = "";
const hookVisto: Array<{ client_id?: unknown; role?: unknown; method?: unknown }> = [];

function docker(args: string[], opts: { allowFail?: boolean } = {}): string {
  try {
    return execFileSync("docker", args, { encoding: "utf8", timeout: 180_000 }).trim();
  } catch (err) {
    if (opts.allowFail) {
      const stderr = (err as { stderr?: string }).stderr ?? "";
      const msg = err instanceof Error ? err.message : String(err);
      return `${msg}\n${stderr}`;
    }
    throw err;
  }
}

function imagemExiste(nome: string): boolean {
  const id = docker(["image", "inspect", "-f", "{{.Id}}", nome], { allowFail: true }).trim();
  return /^sha256:[0-9a-f]{64}$/i.test(id);
}

function psqlDb(db: string, script: string): string {
  const container = process.env.TEST_DB_CONTAINER;
  if (!container) throw new Error("recurso ausente: TEST_DB_CONTAINER (rode via pnpm test:db)");
  return execFileSync(
    "docker",
    ["exec", "-i", container, "psql", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-tA", "-f", "-"],
    { input: script, encoding: "utf8" },
  ).trim();
}

function ipDoPostgres(): string {
  const container = process.env.TEST_DB_CONTAINER;
  if (!container) throw new Error("recurso ausente: TEST_DB_CONTAINER");
  const ip = docker([
    "inspect",
    "-f",
    "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
    container,
  ]);
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    throw new Error(`recurso ausente: IP do Postgres de teste (inspect=${ip})`);
  }
  return ip;
}

function portaPublicada(nome: string, interna: number): number {
  const out = docker(["port", nome, `${interna}/tcp`]);
  const m = /:(\d+)$/.exec(out.split("\n")[0] ?? "");
  if (!m?.[1]) throw new Error(`recurso ausente: porta publicada de ${nome} (${out})`);
  return Number(m[1]);
}

async function esperar(url: string, ok: (body: string, status: number) => boolean): Promise<string> {
  const inicio = Date.now();
  let ultimo = "";
  while (Date.now() - inicio < 90_000) {
    try {
      const r = await fetch(url);
      const body = await r.text();
      ultimo = `${r.status} ${body}`;
      if (ok(body, r.status)) return body;
    } catch (err) {
      ultimo = err instanceof Error ? err.message : String(err);
    }
    execSync("sleep 1");
  }
  throw new Error(`recurso ausente: ${url} não ficou pronto (${ultimo})`);
}

async function adminJwt(): Promise<string> {
  const secret = new TextEncoder().encode(JWT_SECRET);
  return new SignJWT({ role: "service_role" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setAudience("authenticated")
    .setIssuer(API_EXTERNAL_URL)
    .setExpirationTime("2h")
    .sign(secret);
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function jwtPayload(token: string): { role?: string; client_id?: string; sub?: string } {
  return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as {
    role?: string;
    client_id?: string;
    sub?: string;
  };
}

afterAll(() => {
  hookServer?.close();
  for (const nome of limpar) docker(["rm", "-f", nome], { allowFail: true });
  try {
    psqlDb("template1", `drop database if exists ${GOTRUE_DB} with (force);\n`);
  } catch {
    /* container já saiu */
  }
});

describe("cadeia Auth viva GoTrue v2.197.0 + PostgREST HTTP", () => {
  it(
    "emite JWT dedicado por PKCE e o PostgREST lê só a conversa corporativa da identidade",
    { timeout: 360_000 },
    async () => {
      expect(GOTRUE_PROVA_VIVO.gitSha).toBe("4eee58f296d9698a1c2c0ae14d7a0b379c7622d3");

      if (!imagemExiste(GOTRUE_PROVA_VIVO.imagem)) {
        const pull = docker(["pull", GOTRUE_PROVA_VIVO.imagem], { allowFail: true });
        if (!imagemExiste(GOTRUE_PROVA_VIVO.imagem)) {
          throw new Error(
            `recurso ausente: imagem ${GOTRUE_PROVA_VIVO.imagem} (git ${GOTRUE_PROVA_VIVO.gitSha}). pull=${pull.slice(0, 400)}`,
          );
        }
      }
      if (!imagemExiste("postgrest/postgrest:v12.2.12")) {
        docker(["pull", "postgrest/postgrest:v12.2.12"], { allowFail: true });
        if (!imagemExiste("postgrest/postgrest:v12.2.12")) {
          throw new Error("recurso ausente: imagem postgrest/postgrest:v12.2.12");
        }
      }

      const ip = ipDoPostgres();

      sql(`
        alter role authenticator with login password 'authenticator';
        grant connect on database postgres to authenticator;
        grant usage on schema public, auth, storage to authenticator;
        grant authenticated to authenticator;
        grant anon to authenticator;
        grant oauth_delegado to authenticator;
        grant usage on schema storage to service_role, authenticated, anon, oauth_delegado;
        grant select on storage.buckets to service_role, authenticated, anon, oauth_delegado;
        grant select, insert, update, delete on storage.objects to service_role;
      `);

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
        insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted, status) values
          ('${SESS_A}', '${ORG_A}', 'deleg-a', '\\x00', 'WORKING'),
          ('${SESS_B}', '${ORG_B}', 'deleg-b', '\\x00', 'WORKING'),
          ('${SESS_UNK}', '${ORG_A}', 'deleg-unk', '\\x00', 'WORKING')
        on conflict (id) do nothing;
        insert into public.delegacao_contas_empresariais (id, organization_id) values
          ('${CONTA_A}', '${ORG_A}'),
          ('${CONTA_B}', '${ORG_B}')
        on conflict (id) do nothing;
        insert into public.delegacao_sessoes_empresariais
          (channel_session_id, organization_id, conta_empresarial_id)
        values
          ('${SESS_A}', '${ORG_A}', '${CONTA_A}'),
          ('${SESS_B}', '${ORG_B}', '${CONTA_B}')
        on conflict (channel_session_id) do nothing;
        insert into public.contacts (id, organization_id, display_name, is_personal) values
          ('${CT_CORP_A}', '${ORG_A}', 'Contato corp A', false),
          ('${CT_PESS_A}', '${ORG_A}', 'Contato pess A', true),
          ('${CT_CORP_B}', '${ORG_B}', 'Contato corp B', false),
          ('${CT_UNK_A}', '${ORG_A}', 'Contato unk A', false)
        on conflict (id) do nothing;
        insert into public.conversations (id, organization_id, contact_id, channel_session_id, status, is_group) values
          ('${CONV_CORP_A}', '${ORG_A}', '${CT_CORP_A}', '${SESS_A}', 'open', false),
          ('${CONV_PESS_A}', '${ORG_A}', '${CT_PESS_A}', '${SESS_A}', 'open', false),
          ('${CONV_CORP_B}', '${ORG_B}', '${CT_CORP_B}', '${SESS_B}', 'open', false),
          ('${CONV_UNK_A}', '${ORG_A}', '${CT_UNK_A}', '${SESS_UNK}', 'open', false)
        on conflict (id) do nothing;
        insert into public.messages (id, organization_id, conversation_id, channel_session_id, contact_id, type, direction, body, media_storage_path) values
          ('${MSG_CORP_A}', '${ORG_A}', '${CONV_CORP_A}', '${SESS_A}', '${CT_CORP_A}', 'image', 'inbound', 'corp', '${PATH_CORP}'),
          ('${MSG_PESS_A}', '${ORG_A}', '${CONV_PESS_A}', '${SESS_A}', '${CT_PESS_A}', 'image', 'inbound', 'pess', '${PATH_PESS}'),
          ('${MSG_UNK_A}', '${ORG_A}', '${CONV_UNK_A}', '${SESS_UNK}', '${CT_UNK_A}', 'image', 'inbound', 'unk', '${PATH_UNK}')
        on conflict (id) do nothing;
        insert into storage.buckets (id, name, public) values
          ('whatsapp-media', 'whatsapp-media', false)
        on conflict (id) do nothing;
        insert into storage.objects (bucket_id, name)
        select 'whatsapp-media', x.name
          from (values ('${PATH_CORP}'), ('${PATH_PESS}'), ('${PATH_UNK}')) as x(name)
         where not exists (
           select 1 from storage.objects o where o.bucket_id = 'whatsapp-media' and o.name = x.name
         );
        alter table storage.objects add column if not exists version text;
        alter table storage.objects add column if not exists archived_at timestamptz;
        create unique index if not exists storage_objects_name_bucket_uidx
          on storage.objects (name, bucket_id);
      `);

      psqlDb(
        "template1",
        `drop database if exists ${GOTRUE_DB} with (force);\ncreate database ${GOTRUE_DB};\n`,
      );
      psqlDb(
        GOTRUE_DB,
        `create schema if not exists auth;\nalter database ${GOTRUE_DB} set search_path = auth, public;\n`,
      );

      hookServer = createServer((req, res) => {
        const pedacos: Buffer[] = [];
        req.on("data", (c: Buffer) => pedacos.push(c));
        req.on("end", () => {
          let event: {
            claims?: Record<string, unknown>;
            authentication_method?: unknown;
            client_id?: unknown;
          } = {};
          try {
            event = JSON.parse(Buffer.concat(pedacos).toString("utf8")) as typeof event;
          } catch {
            event = {};
          }
          const claims = { ...(event.claims ?? {}) };
          const method = String(event.authentication_method ?? "");
          let clientId = String(claims.client_id ?? event.client_id ?? "");
          const oauth =
            (Boolean(clientIdPermitido) && clientId === clientIdPermitido) ||
            /oauth/i.test(method);
          if (oauth && clientIdPermitido) {
            clientId = clientId || clientIdPermitido;
            claims.role = "oauth_delegado";
            claims.client_id = clientId;
          }
          hookVisto.push({
            client_id: clientId || undefined,
            role: claims.role,
            method: event.authentication_method,
          });
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ claims }));
        });
      });
      await new Promise<void>((resolve) => hookServer!.listen(0, "0.0.0.0", resolve));
      const hookPort = (hookServer.address() as AddressInfo).port;

      docker(["rm", "-f", GOTRUE_NOME, PGRST_NOME, STORAGE_NOME], { allowFail: true });
      docker([
        "run",
        "-d",
        "--name",
        GOTRUE_NOME,
        "--add-host=host.docker.internal:host-gateway",
        "-p",
        "127.0.0.1::9999",
        "-e",
        "GOTRUE_API_HOST=0.0.0.0",
        "-e",
        "GOTRUE_API_PORT=9999",
        "-e",
        `API_EXTERNAL_URL=${API_EXTERNAL_URL}`,
        "-e",
        `GOTRUE_DB_DATABASE_URL=postgres://postgres:postgres@${ip}:5432/${GOTRUE_DB}?sslmode=disable`,
        "-e",
        "GOTRUE_DB_DRIVER=postgres",
        "-e",
        "GOTRUE_DB_NAMESPACE=auth",
        "-e",
        `GOTRUE_JWT_SECRET=${JWT_SECRET}`,
        "-e",
        "GOTRUE_JWT_EXP=3600",
        "-e",
        "GOTRUE_JWT_AUD=authenticated",
        "-e",
        "GOTRUE_JWT_ADMIN_ROLES=service_role",
        "-e",
        "GOTRUE_SITE_URL=http://127.0.0.1",
        "-e",
        "GOTRUE_URI_ALLOW_LIST=http://127.0.0.1/*",
        "-e",
        "GOTRUE_DISABLE_SIGNUP=false",
        "-e",
        "GOTRUE_MAILER_AUTOCONFIRM=true",
        "-e",
        "GOTRUE_EXTERNAL_EMAIL_ENABLED=true",
        "-e",
        "GOTRUE_OAUTH_SERVER_ENABLED=true",
        "-e",
        "GOTRUE_OAUTH_SERVER_AUTHORIZATION_PATH=/oauth/consent",
        "-e",
        "GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED=true",
        "-e",
        `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI=http://host.docker.internal:${hookPort}/`,
        "-e",
        `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_SECRETS=${HOOK_SECRET}`,
        "-e",
        `GOTRUE_JWT_ISSUER=${API_EXTERNAL_URL}/auth/v1`,
        GOTRUE_PROVA_VIVO.imagem,
      ]);
      limpar.push(GOTRUE_NOME);
      const gotruePort = portaPublicada(GOTRUE_NOME, 9999);
      let healthBody: string;
      try {
        healthBody = await esperar(
          `http://127.0.0.1:${gotruePort}/health`,
          (body, status) => status === 200 && /2\.197\.0/.test(body),
        );
      } catch (err) {
        const logs = docker(["logs", "--tail", "80", GOTRUE_NOME], { allowFail: true });
        throw new Error(
          `${err instanceof Error ? err.message : String(err)}\nlogs:\n${logs.slice(0, 1500)}`,
        );
      }
      expect(healthBody).toMatch(/2\.197\.0/);

      docker([
        "run",
        "-d",
        "--name",
        PGRST_NOME,
        "-p",
        "127.0.0.1::3000",
        "-e",
        `PGRST_DB_URI=postgres://authenticator:authenticator@${ip}:5432/postgres?sslmode=disable`,
        "-e",
        "PGRST_DB_SCHEMAS=public,storage",
        "-e",
        "PGRST_DB_ANON_ROLE=anon",
        "-e",
        `PGRST_JWT_SECRET=${JWT_SECRET}`,
        "-e",
        "PGRST_JWT_AUD=authenticated",
        "postgrest/postgrest:v12.2.12",
      ]);
      limpar.push(PGRST_NOME);
      const pgrstPort = portaPublicada(PGRST_NOME, 3000);
      await esperar(
        `http://127.0.0.1:${pgrstPort}/`,
        (_body, status) => status === 200 || status === 401,
      );

      if (!imagemExiste(STORAGE_IMAGEM)) {
        docker(["pull", STORAGE_IMAGEM], { allowFail: true });
        if (!imagemExiste(STORAGE_IMAGEM)) {
          throw new Error(`recurso ausente: imagem ${STORAGE_IMAGEM}`);
        }
      }
      const serviceJwt = await adminJwt();
      const anonJwt = await new SignJWT({ role: "anon" })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setAudience("authenticated")
        .setIssuer(API_EXTERNAL_URL)
        .setExpirationTime("2h")
        .sign(new TextEncoder().encode(JWT_SECRET));
      docker([
        "run",
        "-d",
        "--name",
        STORAGE_NOME,
        "--add-host=host.docker.internal:host-gateway",
        "-p",
        "127.0.0.1::5000",
        "-e",
        `DATABASE_URL=postgres://postgres:postgres@${ip}:5432/postgres?sslmode=disable`,
        "-e",
        `PGRST_JWT_SECRET=${JWT_SECRET}`,
        "-e",
        `JWT_SECRET=${JWT_SECRET}`,
        "-e",
        `ANON_KEY=${anonJwt}`,
        "-e",
        `SERVICE_KEY=${serviceJwt}`,
        "-e",
        `POSTGREST_URL=http://host.docker.internal:${pgrstPort}`,
        "-e",
        "STORAGE_BACKEND=file",
        "-e",
        "FILE_STORAGE_BACKEND_PATH=/var/lib/storage",
        "-e",
        "FILE_SIZE_LIMIT=5242880",
        "-e",
        "TENANT_ID=stub",
        "-e",
        "REGION=local",
        "-e",
        "GLOBAL_S3_BUCKET=stub",
        "-e",
        "IS_MULTITENANT=false",
        "-e",
        "ENABLE_AUTO_MIGRATION=false",
        "-e",
        "ENABLE_IMAGE_TRANSFORMATION=false",
        "-e",
        `AUTH_JWT_SECRET=${JWT_SECRET}`,
        "-e",
        "DATABASE_SEARCH_PATH=storage,public",
        "-e",
        "DB_MIGRATIONS_FREEZE_AT=create-migrations-table",
        STORAGE_IMAGEM,
      ]);
      limpar.push(STORAGE_NOME);
      const storagePort = portaPublicada(STORAGE_NOME, 5000);
      try {
        await esperar(
          `http://127.0.0.1:${storagePort}/status`,
          (_body, status) => status === 200 || status === 204,
        );
      } catch {
        try {
          await esperar(
            `http://127.0.0.1:${storagePort}/bucket`,
            (_body, status) => status === 200 || status === 400 || status === 401,
          );
        } catch (err) {
          const logs = docker(["logs", "--tail", "80", STORAGE_NOME], { allowFail: true });
          throw new Error(
            `recurso ausente: ${STORAGE_IMAGEM} não ficou pronto ` +
              `(${err instanceof Error ? err.message : String(err)})\nlogs:\n${logs.slice(0, 1500)}`,
          );
        }
      }

      const admin = await adminJwt();
      const authHeaders = {
        Authorization: `Bearer ${admin}`,
        apikey: admin,
        "Content-Type": "application/json",
      };

      async function criarUsuario(email: string, password: string, id: string): Promise<void> {
        const r = await fetch(`http://127.0.0.1:${gotruePort}/admin/users`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            email,
            password,
            email_confirm: true,
            role: "authenticated",
            id,
          }),
        });
        if (!r.ok && r.status !== 422 && r.status !== 409) {
          throw new Error(
            `recurso ausente: POST /admin/users (${r.status} ${await r.text()}) — GoTrue admin API`,
          );
        }
      }

      await criarUsuario("deleg-a@invariant.test", "SenhaA-vivo-1", USER_A);
      await criarUsuario("deleg-b@invariant.test", "SenhaB-vivo-1", USER_B);

      const clientRes = await fetch(`http://127.0.0.1:${gotruePort}/admin/oauth/clients`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          name: "delegacao-bot",
          redirect_uris: ["http://127.0.0.1/callback"],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        }),
      });
      const clientBody = await clientRes.text();
      if (!clientRes.ok) {
        throw new Error(
          `recurso ausente: POST /admin/oauth/clients (${clientRes.status} ${clientBody.slice(0, 400)}). ` +
            `GOTRUE_OAUTH_SERVER_ENABLED na imagem ${GOTRUE_PROVA_VIVO.imagem} (git ${GOTRUE_PROVA_VIVO.gitSha}).`,
        );
      }
      const clientJson = JSON.parse(clientBody) as { client_id?: string };
      const clientId: string = clientJson.client_id ?? "";
      if (clientId === "") {
        throw new Error(`recurso ausente: client_id na resposta (${clientBody.slice(0, 300)})`);
      }
      clientIdPermitido = clientId;

      sql(`
        insert into public.delegacao_clientes_autorizados (oauth_client_id, hook_version) values
          ('${clientId}', 1)
        on conflict (oauth_client_id) do nothing;
        insert into public.delegacao_visibilidade_corporativa
          (organization_id, user_id, oauth_client_id, efeitos, expires_at)
        values
          ('${ORG_A}', '${USER_A}', '${clientId}', array['buscar','ler','baixar']::text[], now() + interval '1 day'),
          ('${ORG_B}', '${USER_B}', '${clientId}', array['buscar','ler','baixar']::text[], now() + interval '1 day')
        on conflict do nothing;
      `);

      async function pkce(
        email: string,
        password: string,
      ): Promise<{ access: string; refresh: string; role: string }> {
        const signIn = await fetch(`http://127.0.0.1:${gotruePort}/token?grant_type=password`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const signInBody = await signIn.text();
        if (!signIn.ok) {
          throw new Error(
            `recurso ausente: POST /token password (${signIn.status} ${signInBody.slice(0, 300)})`,
          );
        }
        const sess = JSON.parse(signInBody) as { access_token: string };
        const verifier = b64url(randomBytes(32));
        const challenge = b64url(createHash("sha256").update(verifier).digest());
        const authorizeUrl =
          `http://127.0.0.1:${gotruePort}/oauth/authorize?` +
          new URLSearchParams({
            client_id: clientId,
            redirect_uri: "http://127.0.0.1/callback",
            response_type: "code",
            code_challenge: challenge,
            code_challenge_method: "S256",
            scope: "email",
          }).toString();
        const authz = await fetch(authorizeUrl, { redirect: "manual" });
        const loc = authz.headers.get("location") ?? "";
        const authzBody = await authz.text();
        let authorizationId: string | null = null;
        try {
          authorizationId = new URL(loc, "http://127.0.0.1").searchParams.get("authorization_id");
        } catch {
          authorizationId = null;
        }
        if (!authorizationId) {
          throw new Error(
            `recurso ausente: GET /oauth/authorize não devolveu authorization_id ` +
              `(status=${authz.status} loc=${loc} body=${authzBody.slice(0, 300)}). ` +
              `GOTRUE_OAUTH_SERVER_AUTHORIZATION_PATH na imagem ${GOTRUE_PROVA_VIVO.imagem}.`,
          );
        }
        const detalhes = await fetch(
          `http://127.0.0.1:${gotruePort}/oauth/authorizations/${authorizationId}`,
          {
            headers: {
              Authorization: `Bearer ${sess.access_token}`,
              Accept: "application/json",
            },
          },
        );
        if (!detalhes.ok) {
          throw new Error(
            `recurso ausente: GET /oauth/authorizations (${detalhes.status} ${await detalhes.text()})`,
          );
        }
        const consent = await fetch(
          `http://127.0.0.1:${gotruePort}/oauth/authorizations/${authorizationId}/consent`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${sess.access_token}`,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({ action: "approve" }),
          },
        );
        const consentBody = await consent.text();
        if (!consent.ok) {
          throw new Error(
            `recurso ausente: POST /oauth/authorizations/consent (${consent.status} ${consentBody.slice(0, 300)})`,
          );
        }
        const consentJson = JSON.parse(consentBody) as { redirect_url?: string };
        let code: string | null = null;
        try {
          code = new URL(
            consentJson.redirect_url ?? "",
            "http://127.0.0.1/callback",
          ).searchParams.get("code");
        } catch {
          code = null;
        }
        if (!code) {
          throw new Error(
            `recurso ausente: consent não devolveu code (body=${consentBody.slice(0, 300)})`,
          );
        }
        const tokenRes = await fetch(`http://127.0.0.1:${gotruePort}/oauth/token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: "http://127.0.0.1/callback",
            client_id: clientId,
            code_verifier: verifier,
          }).toString(),
        });
        const tokenBody = await tokenRes.text();
        if (!tokenRes.ok) {
          throw new Error(
            `recurso ausente: POST /oauth/token (${tokenRes.status} ${tokenBody.slice(0, 300)}) hook=${JSON.stringify(hookVisto.slice(-3))}`,
          );
        }
        const tokens = JSON.parse(tokenBody) as { access_token: string; refresh_token: string };
        const payload = jwtPayload(tokens.access_token);
        if (payload.role !== "oauth_delegado") {
          throw new Error(
            `hook não mapeou role (role=${payload.role} client_id=${payload.client_id} visto=${JSON.stringify(hookVisto.slice(-4))}). ` +
              `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI http na imagem ${GOTRUE_PROVA_VIVO.imagem}.`,
          );
        }
        const refreshRes = await fetch(`http://127.0.0.1:${gotruePort}/oauth/token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: tokens.refresh_token,
            client_id: clientId,
          }).toString(),
        });
        const refreshBody = await refreshRes.text();
        if (!refreshRes.ok) {
          throw new Error(
            `recurso ausente: refresh_token (${refreshRes.status} ${refreshBody.slice(0, 300)})`,
          );
        }
        const refreshed = JSON.parse(refreshBody) as {
          access_token: string;
          refresh_token?: string;
        };
        const payload2 = jwtPayload(refreshed.access_token);
        if (payload2.role !== "oauth_delegado") {
          throw new Error(`refresh não preservou role dedicado (role=${payload2.role})`);
        }
        return {
          access: refreshed.access_token,
          refresh: refreshed.refresh_token ?? tokens.refresh_token,
          role: payload2.role,
        };
      }

      const tokA = await pkce("deleg-a@invariant.test", "SenhaA-vivo-1");
      const tokB = await pkce("deleg-b@invariant.test", "SenhaB-vivo-1");
      expect(tokA.role).toBe("oauth_delegado");
      expect(tokB.role).toBe("oauth_delegado");

      async function rest(
        token: string,
        path: string,
        opts: { method?: string; schema?: string; body?: unknown } = {},
      ): Promise<{ status: number; body: unknown }> {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        };
        if (opts.schema) {
          headers["Accept-Profile"] = opts.schema;
          headers["Content-Profile"] = opts.schema;
        }
        if (opts.body !== undefined) headers["Content-Type"] = "application/json";
        const r = await fetch(`http://127.0.0.1:${pgrstPort}${path}`, {
          method: opts.method ?? "GET",
          headers,
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        });
        const text = await r.text();
        let body: unknown = text;
        try {
          body = JSON.parse(text);
        } catch {
          /* texto */
        }
        return { status: r.status, body };
      }

      async function storagePut(objectPath: string, bytes: Buffer): Promise<number> {
        const headers = {
          Authorization: `Bearer ${serviceJwt}`,
          apikey: serviceJwt,
          "Content-Type": "application/octet-stream",
          "x-upsert": "true",
        };
        const url = `http://127.0.0.1:${storagePort}/object/whatsapp-media/${objectPath}`;
        const corpo = new Uint8Array(bytes);
        let r = await fetch(url, { method: "POST", headers, body: corpo });
        if (r.status >= 400) {
          r = await fetch(url, { method: "PUT", headers, body: corpo });
        }
        return r.status;
      }

      async function storageGet(
        token: string,
        objectPath: string,
      ): Promise<{ status: number; body: Buffer }> {
        const caminhos = [
          `/object/authenticated/whatsapp-media/${objectPath}`,
          `/object/whatsapp-media/${objectPath}`,
        ];
        let ultimo: { status: number; body: Buffer } = { status: 0, body: Buffer.alloc(0) };
        for (const caminho of caminhos) {
          const r = await fetch(`http://127.0.0.1:${storagePort}${caminho}`, {
            headers: { Authorization: `Bearer ${token}`, apikey: anonJwt },
          });
          ultimo = { status: r.status, body: Buffer.from(await r.arrayBuffer()) };
          if (r.status === 200) return ultimo;
        }
        return ultimo;
      }

      function assertBytesNegados(
        r: { status: number; body: Buffer },
        bytes: Buffer,
        rotulo: string,
      ): void {
        if (r.status === 200 && r.body.equals(bytes)) {
          throw new Error(`${rotulo}: Storage API devolveu os bytes (status ${r.status})`);
        }
      }

      const bytesUnk = Buffer.from("deleg-unk-vivo-bytes");
      const putCorp = await storagePut(PATH_CORP, BYTES_CORP);
      const putPess = await storagePut(PATH_PESS, BYTES_PESS);
      const putUnk = await storagePut(PATH_UNK, bytesUnk);
      function gravarNoDisco(objectPath: string, bytes: Buffer): void {
        const version = lastLine(
          sql(
            `select coalesce(version, '') from storage.objects
              where name = '${objectPath}' and bucket_id = 'whatsapp-media' limit 1;`,
          ),
        );
        if (version === "") {
          throw new Error(`recurso ausente: version de ${objectPath} após POST /object`);
        }
        const dest = `/var/lib/storage/stub/stub/whatsapp-media/${objectPath}/${version}`;
        const b64 = bytes.toString("base64");
        docker([
          "exec",
          STORAGE_NOME,
          "sh",
          "-c",
          `dest='${dest}'; parent=$(dirname "$dest"); if [ -f "$parent" ]; then rm -f "$parent"; fi; mkdir -p "$parent"; printf '%s' '${b64}' | base64 -d > "$dest"`,
        ]);
      }
      gravarNoDisco(PATH_CORP, BYTES_CORP);
      gravarNoDisco(PATH_PESS, BYTES_PESS);
      gravarNoDisco(PATH_UNK, bytesUnk);

      function clientePostgrest(token: string): ClienteLeitura {
        const cadeia = (schema: string, table: string) => {
          const state = {
            cols: "*",
            eqs: [] as Array<[string, string]>,
            isNull: [] as string[],
            limit: 100,
            single: false,
          };
          const self: Record<string, unknown> = {};
          const run = async () => {
            const qs = new URLSearchParams();
            qs.set("select", state.cols);
            for (const [col, val] of state.eqs) qs.set(col, `eq.${val}`);
            for (const col of state.isNull) qs.set(col, "is.null");
            qs.set("limit", String(state.limit));
            const r = await rest(token, `/${table}?${qs.toString()}`, { schema });
            if (r.status >= 400) return { data: null, error: { status: r.status, body: r.body } };
            const rows = Array.isArray(r.body) ? r.body : [];
            return { data: state.single ? (rows[0] ?? null) : rows, error: null };
          };
          self.select = (cols: string) => {
            state.cols = cols;
            return self;
          };
          self.eq = (col: string, val: string) => {
            state.eqs.push([col, val]);
            return self;
          };
          self.in = () => self;
          self.is = (col: string, val: null) => {
            if (val === null) state.isNull.push(col);
            return self;
          };
          self.limit = (n: number) => {
            state.limit = n;
            return self;
          };
          self.maybeSingle = async () => {
            state.single = true;
            return run();
          };
          self.then = (
            resolve: (v: { data: unknown; error: unknown }) => unknown,
            reject?: (e: unknown) => unknown,
          ) => run().then(resolve, reject);
          return self;
        };
        return {
          from: (tabela: string) => cadeia("public", tabela),
          schema: (nome: string) => ({ from: (tabela: string) => cadeia(nome, tabela) }),
        };
      }

      async function leitorGoTrue(jwt: string) {
        const r = await fetch(`http://127.0.0.1:${gotruePort}/user`, {
          headers: { Authorization: `Bearer ${jwt}` },
        });
        const text = await r.text();
        let json: { id?: string } = {};
        try {
          json = JSON.parse(text) as { id?: string };
        } catch {
          json = {};
        }
        const payload = jwtPayload(jwt) as Record<string, unknown>;
        return {
          getUser: async () => ({
            data: { user: r.ok && json.id ? { id: json.id } : null },
            error: r.ok ? null : { message: text.slice(0, 200) },
          }),
          getClaims: async () => ({ data: { claims: payload }, error: null }),
        };
      }

      const aCorp = await rest(tokA.access, `/conversations?id=eq.${CONV_CORP_A}&select=id`);
      if (aCorp.status !== 200) {
        const logs = docker(["logs", "--tail", "40", PGRST_NOME], { allowFail: true });
        throw new Error(
          `PostgREST ${aCorp.status} body=${JSON.stringify(aCorp.body)} ` +
            `jwt=${JSON.stringify(jwtPayload(tokA.access))} ` +
            `logs=${logs.slice(0, 1200)}`,
        );
      }
      expect(aCorp.body).toEqual([{ id: CONV_CORP_A }]);
      expect((await rest(tokA.access, `/conversations?id=eq.${CONV_PESS_A}&select=id`)).body).toEqual(
        [],
      );
      expect((await rest(tokA.access, `/conversations?id=eq.${CONV_CORP_B}&select=id`)).body).toEqual(
        [],
      );
      expect((await rest(tokA.access, `/conversations?id=eq.${CONV_UNK_A}&select=id`)).body).toEqual(
        [],
      );
      expect((await rest(tokB.access, `/conversations?id=eq.${CONV_CORP_B}&select=id`)).body).toEqual(
        [{ id: CONV_CORP_B }],
      );
      expect((await rest(tokB.access, `/conversations?id=eq.${CONV_CORP_A}&select=id`)).body).toEqual(
        [],
      );

      const cookie = await fetch(`http://127.0.0.1:${gotruePort}/token?grant_type=password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "deleg-a@invariant.test", password: "SenhaA-vivo-1" }),
      });
      const cookieJson = JSON.parse(await cookie.text()) as { access_token: string };
      const cookiePayload = jwtPayload(cookieJson.access_token);
      expect(cookiePayload.role).toBe("authenticated");
      expect(
        (await rest(cookieJson.access_token, `/conversations?id=eq.${CONV_PESS_A}&select=id`)).body,
      ).toEqual([{ id: CONV_PESS_A }]);

      const objA = await rest(
        tokA.access,
        `/objects?name=eq.${encodeURIComponent(PATH_CORP)}&select=name,bucket_id`,
        { schema: "storage" },
      );
      expect(objA.status).toBe(200);
      expect(objA.body).toEqual([{ name: PATH_CORP, bucket_id: "whatsapp-media" }]);
      expect(
        (
          await rest(
            tokA.access,
            `/objects?name=eq.${encodeURIComponent(PATH_PESS)}&select=name`,
            { schema: "storage" },
          )
        ).body,
      ).toEqual([]);
      expect(
        (
          await rest(
            tokB.access,
            `/objects?name=eq.${encodeURIComponent(PATH_CORP)}&select=name`,
            { schema: "storage" },
          )
        ).body,
      ).toEqual([]);
      expect(
        (
          await rest(
            tokA.access,
            `/objects?name=eq.${encodeURIComponent(PATH_UNK)}&select=name`,
            { schema: "storage" },
          )
        ).body,
      ).toEqual([]);

      const bytesCorpA = await storageGet(tokA.access, PATH_CORP);
      if (bytesCorpA.status !== 200 || !bytesCorpA.body.equals(BYTES_CORP)) {
        const logs = docker(["logs", "--tail", "200", STORAGE_NOME], { allowFail: true });
        const getLogs = logs
          .split("\n")
          .filter((l) => l.includes('"method":"GET"'))
          .map((l) => l.slice(0, 1800))
          .join("\n");
        const cols = lastLine(
          sql(
            `select string_agg(column_name, ',' order by ordinal_position)
               from information_schema.columns
              where table_schema='storage' and table_name='objects';`,
          ),
        );
        const ls = docker(
          ["exec", STORAGE_NOME, "ls", "-la", `/var/lib/storage/stub/whatsapp-media/${ORG_A}/midia`],
          { allowFail: true },
        );
        const asService = await storageGet(serviceJwt, PATH_CORP);
        throw new Error(
          `Storage API GET corporativo: status=${bytesCorpA.status} ` +
            `len=${bytesCorpA.body.length} body=${bytesCorpA.body.toString("utf8").slice(0, 400)} ` +
            `put=${putCorp}/${putPess}/${putUnk} service=${asService.status}:${asService.body.toString("utf8").slice(0, 200)} ` +
            `jwt=${JSON.stringify(jwtPayload(tokA.access))} ls=${ls.slice(0, 300)} cols=${cols} ` +
            `getLogs=${getLogs.slice(0, 2500)}`,
        );
      }
      assertBytesNegados(await storageGet(tokA.access, PATH_PESS), BYTES_PESS, "pessoal A");
      assertBytesNegados(await storageGet(tokA.access, PATH_UNK), bytesUnk, "unknown A");
      assertBytesNegados(await storageGet(tokB.access, PATH_CORP), BYTES_CORP, "outra org B");

      const escrita = await rest(tokA.access, "/conversations", {
        method: "POST",
        body: {
          id: "dddddddd-4444-4000-8000-000000000099",
          organization_id: ORG_A,
          contact_id: CT_CORP_A,
          channel_session_id: SESS_A,
          status: "open",
          is_group: false,
        },
      });
      expect(escrita.status).toBeGreaterThanOrEqual(400);

      const objWrite = await rest(tokA.access, "/objects", {
        method: "POST",
        schema: "storage",
        body: { bucket_id: "whatsapp-media", name: `${ORG_A}/midia/injected.bin` },
      });
      expect(objWrite.status).toBeGreaterThanOrEqual(400);

      const rpc = await rest(tokA.access, "/rpc/fn_conversation_scope", { method: "POST", body: {} });
      expect(rpc.status).toBeGreaterThanOrEqual(400);

      const vista = await rest(tokA.access, "/external_db_connections_safe?select=*");
      expect(vista.status === 200 ? vista.body : []).toEqual([]);

      const urlAntiga = process.env.NEXT_PUBLIC_SUPABASE_URL;
      process.env.NEXT_PUBLIC_SUPABASE_URL = API_EXTERNAL_URL;
      try {
        const mcpBuscar = await handleDelegacaoHttp(
          new Request("http://app.test/api/mcp/delegacao", {
            method: "POST",
            headers: {
              authorization: `Bearer ${tokA.access}`,
              host: "app.test",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "tools/call",
              params: { name: "delegacao_buscar", arguments: {} },
            }),
          }),
          {
            leitorAuth: await leitorGoTrue(tokA.access),
            clientDoUsuario: (t) => clientePostgrest(t),
          },
        );
        expect(mcpBuscar.status).toBe(200);
        const buscarJson = (await mcpBuscar.json()) as {
          result?: { structuredContent?: { conversations?: Array<{ id: string }> } };
        };
        const ids = (buscarJson.result?.structuredContent?.conversations ?? []).map((c) => c.id);
        expect(ids).toContain(CONV_CORP_A);
        expect(ids).not.toContain(CONV_PESS_A);
        expect(ids).not.toContain(CONV_CORP_B);

        const mcpBaixar = await handleDelegacaoHttp(
          new Request("http://app.test/api/mcp/delegacao", {
            method: "POST",
            headers: {
              authorization: `Bearer ${tokA.access}`,
              host: "app.test",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 2,
              method: "tools/call",
              params: {
                name: "delegacao_baixar",
                arguments: {
                  conversation_id: CONV_CORP_A,
                  bucket: "whatsapp-media",
                  path: PATH_CORP,
                },
              },
            }),
          }),
          {
            leitorAuth: await leitorGoTrue(tokA.access),
            clientDoUsuario: (t) => clientePostgrest(t),
          },
        );
        expect(mcpBaixar.status).toBe(200);
        const baixarJson = (await mcpBaixar.json()) as {
          result?: { structuredContent?: { visivel?: boolean; path?: string } };
        };
        expect(baixarJson.result?.structuredContent?.visivel).toBe(true);
        expect(baixarJson.result?.structuredContent?.path).toBe(PATH_CORP);
      } finally {
        if (urlAntiga === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
        else process.env.NEXT_PUBLIC_SUPABASE_URL = urlAntiga;
      }

      const revokeRes = await fetch(`http://127.0.0.1:${gotruePort}/oauth/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: tokA.refresh,
          token_type_hint: "refresh_token",
          client_id: clientId,
        }).toString(),
      });
      const logoutRes = await fetch(`http://127.0.0.1:${gotruePort}/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tokA.access}` },
      });
      if (revokeRes.status >= 500 && logoutRes.status >= 500) {
        throw new Error(
          `recurso ausente: POST /oauth/revoke (${revokeRes.status}) e POST /logout (${logoutRes.status})`,
        );
      }
      const refreshRevogado = await fetch(`http://127.0.0.1:${gotruePort}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: tokA.refresh,
          client_id: clientId,
        }).toString(),
      });
      expect(refreshRevogado.ok).toBe(false);
      // Limite documentado: access JWT (stateless) segue válido até exp.
      expect(
        (await rest(tokA.access, `/conversations?id=eq.${CONV_CORP_A}&select=id`)).body,
      ).toEqual([{ id: CONV_CORP_A }]);
      expect((await storageGet(tokA.access, PATH_CORP)).body.equals(BYTES_CORP)).toBe(true);

      sql(`update public.delegacao_visibilidade_corporativa
             set revoked_at = now()
           where user_id = '${USER_A}';`);
      expect(
        (await rest(tokA.access, `/conversations?id=eq.${CONV_CORP_A}&select=id`)).body,
      ).toEqual([]);
      expect(
        (
          await rest(
            tokA.access,
            `/objects?name=eq.${encodeURIComponent(PATH_CORP)}&select=name`,
            { schema: "storage" },
          )
        ).body,
      ).toEqual([]);
      assertBytesNegados(await storageGet(tokA.access, PATH_CORP), BYTES_CORP, "grant CRM revogado");
      sql(`update public.delegacao_visibilidade_corporativa
             set revoked_at = null
           where user_id = '${USER_A}';`);

      expect(
        lastLine(
          sql(`select c.relrowsecurity::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='storage' and c.relname='objects';`),
        ),
      ).toBe("true");
    },
  );
});
