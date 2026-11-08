/**
 * Cadeia viva: GoTrue tag v2.197.0 → JWT (authorization_code+PKCE+refresh) →
 * PostgREST HTTP → RLS do CRM. Não é SET ROLE. Skip ≠ prova.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { execFileSync, execSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { SignJWT } from "jose";
import { afterAll, describe, expect, it } from "vitest";

import { GOTRUE_PROVA_VIVO } from "@/lib/auth/delegacao-gotrue-prova";
import { lastLine, sql } from "./psql-transporte";

const JWT_SECRET = "delegacao-vivo-secret-min-32-chars!!";
const HOOK_SECRET = `v1,whsec_${Buffer.from("delegacao-vivo-hook-secret-32b!").toString("base64")}`;
const SUFIXO = `${process.pid}-${Date.now()}`;
const GOTRUE_NOME = `deleg-gotrue-${SUFIXO}`;
const PGRST_NOME = `deleg-pgrst-${SUFIXO}`;
const GOTRUE_DB = `gotrue_deleg_${process.pid}`;
const API_EXTERNAL_URL = "http://127.0.0.1:9999";

const USER_A = "dddddddd-1111-4000-8000-00000000000a";
const USER_B = "dddddddd-1111-4000-8000-00000000000b";
const ORG_A = "dddddddd-0000-4000-8000-00000000000a";
const ORG_B = "dddddddd-0000-4000-8000-00000000000b";
const SESS_A = "dddddddd-2222-4000-8000-00000000000a";
const SESS_B = "dddddddd-2222-4000-8000-00000000000b";
const CONTA_A = "dddddddd-8888-4000-8000-00000000000a";
const CONTA_B = "dddddddd-8888-4000-8000-00000000000b";
const CT_CORP_A = "dddddddd-3333-4000-8000-0000000000c1";
const CT_PESS_A = "dddddddd-3333-4000-8000-0000000000a1";
const CT_CORP_B = "dddddddd-3333-4000-8000-0000000000c2";
const CONV_CORP_A = "dddddddd-4444-4000-8000-0000000000c1";
const CONV_PESS_A = "dddddddd-4444-4000-8000-0000000000a1";
const CONV_CORP_B = "dddddddd-4444-4000-8000-0000000000c2";

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
    { timeout: 240_000 },
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
          ('${SESS_B}', '${ORG_B}', 'deleg-b', '\\x00', 'WORKING')
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
          ('${CT_CORP_B}', '${ORG_B}', 'Contato corp B', false)
        on conflict (id) do nothing;
        insert into public.conversations (id, organization_id, contact_id, channel_session_id, status, is_group) values
          ('${CONV_CORP_A}', '${ORG_A}', '${CT_CORP_A}', '${SESS_A}', 'open', false),
          ('${CONV_PESS_A}', '${ORG_A}', '${CT_PESS_A}', '${SESS_A}', 'open', false),
          ('${CONV_CORP_B}', '${ORG_B}', '${CT_CORP_B}', '${SESS_B}', 'open', false)
        on conflict (id) do nothing;
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

      docker(["rm", "-f", GOTRUE_NOME, PGRST_NOME], { allowFail: true });
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
      ): Promise<{ access: string; role: string }> {
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
        const refreshed = JSON.parse(refreshBody) as { access_token: string };
        const payload2 = jwtPayload(refreshed.access_token);
        if (payload2.role !== "oauth_delegado") {
          throw new Error(`refresh não preservou role dedicado (role=${payload2.role})`);
        }
        return { access: refreshed.access_token, role: payload2.role };
      }

      const tokA = await pkce("deleg-a@invariant.test", "SenhaA-vivo-1");
      const tokB = await pkce("deleg-b@invariant.test", "SenhaB-vivo-1");
      expect(tokA.role).toBe("oauth_delegado");
      expect(tokB.role).toBe("oauth_delegado");

      async function rest(token: string, path: string): Promise<{ status: number; body: unknown }> {
        const r = await fetch(`http://127.0.0.1:${pgrstPort}${path}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
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

      expect(
        lastLine(
          sql(`select c.relrowsecurity::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='storage' and c.relname='objects';`),
        ),
      ).toBe("true");
    },
  );
});
