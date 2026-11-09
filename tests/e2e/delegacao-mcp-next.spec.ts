/**
 * Superfície MCP individual no **processo Next** (next start do job e2e).
 *
 * Recusa (401 / well-known / cookie) não basta como cadeia positiva.
 * tools/call buscar/ler/baixar atravessa: proxy → route → Auth getUser/getClaims
 * → PostgREST (RLS oauth_delegado) → Storage (bytes).
 *
 * Identidade: JWT HS256 do Auth local com role=oauth_delegado + client_id
 * (o hook Custom Access Token NÃO está ligado no stack e2e, igual à instalação).
 * Emissão PKCE+hook está no invariante vivo. Aqui o processo é o Next.
 *
 * Proxy: `/^\/api\/mcp(\/.*)?$/` em public-paths — Bearer chega ao handler;
 * getUser() de cookie não decide. Sem rewrite. Verifier recusa authenticated.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT, decodeJwt } from "jose";
import pg from "pg";

import { credenciaisSupabaseDeTeste } from "../../scripts/lib/env-de-teste";
import { test, expect, type APIRequestContext, type Page } from "./helpers/test";

interface E2ECreds {
  password: string;
  users: Record<string, { id: string; email: string; role: string }>;
}

const CREDS_PATH = path.join(process.cwd(), ".e2e-creds.json");
const BYTES_CORP = Buffer.from("deleg-e2e-corp-bytes-v1");
const BYTES_PESS = Buffer.from("deleg-e2e-pess-bytes-v1");
const BYTES_UNK = Buffer.from("deleg-e2e-unk-bytes-v1");
const CLIENT_ID = `deleg-e2e-${randomUUID()}`;

function loadCreds(): E2ECreds {
  if (!fs.existsSync(CREDS_PATH) || !JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")).users?.agent) {
    execFileSync("npx", ["tsx", "scripts/seed-e2e-credentials.ts"], { stdio: "inherit" });
  }
  return JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as E2ECreds;
}

const creds = loadCreds();

async function loginAgent(page: Page): Promise<void> {
  const agent = creds.users.agent;
  if (!agent) throw new Error("seed sem users.agent");
  await page.goto("/login");
  await page.locator("#email").fill(agent.email);
  await page.locator("#password").fill(creds.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/app\//);
}

function jwtSecretDoAuthLocal(): string {
  const doAmbiente = process.env.JWT_SECRET?.trim() ?? "";
  if (doAmbiente.length >= 32) return doAmbiente;

  const tentativas: Array<() => string> = [
    () => execFileSync("supabase", ["status", "-o", "env"], { encoding: "utf8", timeout: 30_000 }),
    () =>
      execFileSync("npx", ["supabase", "status", "-o", "env"], {
        encoding: "utf8",
        timeout: 60_000,
      }),
  ];
  for (const ler of tentativas) {
    try {
      const out = ler();
      const m = /^JWT_SECRET=(.*)$/m.exec(out);
      const v = (m?.[1] ?? "").replace(/^["']|["']$/g, "").trim();
      if (v.length >= 32) return v;
    } catch {
      /* stdout do status traz o secret — não entra em erro */
    }
  }
  try {
    const nomes = execFileSync("docker", ["ps", "--format", "{{.Names}}"], {
      encoding: "utf8",
      timeout: 15_000,
    });
    const auth = nomes
      .split("\n")
      .map((n) => n.trim())
      .find((n) => /supabase/i.test(n) && /auth/i.test(n));
    if (auth) {
      const v = execFileSync("docker", ["exec", auth, "printenv", "GOTRUE_JWT_SECRET"], {
        encoding: "utf8",
        timeout: 15_000,
      }).trim();
      if (v.length >= 32) return v;
    }
  } catch {
    /* sem docker */
  }
  throw new Error(
    "recurso ausente: JWT_SECRET do Auth local (supabase status / GOTRUE_JWT_SECRET). " +
      "Sem ele não há JWT dedicado no processo Next.",
  );
}

async function jwtDedicado(
  url: string,
  anonKey: string,
  email: string,
  password: string,
  clientId: string,
): Promise<string> {
  const anon = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data.session?.access_token) {
    throw new Error(`signIn: ${error?.message ?? "sem access_token"}`);
  }
  const claims = decodeJwt(data.session.access_token) as Record<string, unknown>;
  const sub = typeof claims.sub === "string" ? claims.sub : "";
  const iss = typeof claims.iss === "string" ? claims.iss : "";
  const exp = typeof claims.exp === "number" ? claims.exp : 0;
  const iat = typeof claims.iat === "number" ? claims.iat : 0;
  if (!sub || !iss || exp <= 0 || iat <= 0) {
    throw new Error("access_token do Auth sem sub/iss/exp/iat");
  }
  const secret = new TextEncoder().encode(jwtSecretDoAuthLocal());
  return new SignJWT({
    ...claims,
    role: "oauth_delegado",
    client_id: clientId,
    session_id: claims.session_id,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(sub)
    .setIssuer(iss)
    .setAudience("authenticated")
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(secret);
}

function opacoHttp(texto: string): string {
  return texto
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "uuid")
    .replace(/https?:\/\/[^\s"]+/g, "url")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "jwt")
    .slice(0, 220);
}

async function restComJwt(
  supabaseUrl: string,
  anonKey: string,
  token: string,
  caminho: string,
  extra: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  const r = await fetch(`${supabaseUrl.replace(/\/+$/, "")}${caminho}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anonKey,
      Accept: "application/json",
      ...extra,
    },
  });
  return { status: r.status, body: opacoHttp(await r.text()) };
}

async function diagnosticoCadeia(q: {
  appGetStatus: number;
  supabaseUrl: string;
  anonKey: string;
  token: string;
  pathCorp?: string;
}): Promise<string> {
  const grant = await restComJwt(
    q.supabaseUrl,
    q.anonKey,
    q.token,
    "/rest/v1/delegacao_visibilidade_corporativa?select=efeitos&limit=1",
  );
  const conv = await restComJwt(
    q.supabaseUrl,
    q.anonKey,
    q.token,
    "/rest/v1/conversations?select=id&limit=3",
  );
  const obj = await restComJwt(
    q.supabaseUrl,
    q.anonKey,
    q.token,
    `/rest/v1/objects?select=name&limit=1${q.pathCorp ? `&name=eq.${encodeURIComponent(q.pathCorp)}` : ""}`,
    { "Accept-Profile": "storage", "Content-Profile": "storage" },
  );
  return `ident=${q.appGetStatus} grant=${grant.status}:${grant.body} conv=${conv.status}:${conv.body} obj=${obj.status}:${obj.body}`;
}

type Rpc = {
  result?: {
    structuredContent?: {
      conversations?: Array<{ id: string }>;
      conversation?: { id: string };
      messages?: Array<{ id: string }>;
      visivel?: boolean;
      path?: string;
      signed_url?: string;
    };
  };
  error?: { message?: string };
};

async function toolsCall(
  request: APIRequestContext,
  token: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ status: number; rpc: Rpc; www?: string }> {
  const r = await request.post("/api/mcp/delegacao", {
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    },
  });
  const rpc = (await r.json()) as Rpc;
  return { status: r.status(), rpc, www: r.headers()["www-authenticate"] };
}

test("GET /api/mcp/delegacao sem Bearer é 401 com WWW-Authenticate", async ({ request }) => {
  const r = await request.get("/api/mcp/delegacao");
  expect(r.status()).toBe(401);
  expect(r.headers()["www-authenticate"] ?? "").toMatch(/Bearer/);
});

test("RFC 9728 well-known do recurso MCP individual no Next", async ({ request }) => {
  const r = await request.get("/.well-known/oauth-protected-resource/api/mcp/delegacao");
  expect(r.status()).toBe(200);
  const j = (await r.json()) as { resource?: string; authorization_servers?: string[] };
  expect(j.resource).toMatch(/\/api\/mcp\/delegacao$/);
  expect(JSON.stringify(j.authorization_servers ?? [])).not.toMatch(/placeholder\.supabase\.co/);
  expect(j.authorization_servers?.some((u) => /\/auth\/v1$/.test(u))).toBe(true);
});

test("cookie authenticated não entra na superfície MCP", async ({ page }) => {
  await loginAgent(page);
  const r = await page.request.get("/api/mcp/delegacao");
  expect(r.status()).toBe(401);
  const body = await r.text();
  expect(body).not.toMatch(/delegacao_buscar/);
});

test.describe("tools/call JWT dedicado no processo Next", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  const sufixo = randomUUID().slice(0, 8);
  const senha = `E2e!${randomUUID().slice(0, 12)}`;
  const emailA = `deleg-a-${sufixo}@exemplo.test`;
  const emailB = `deleg-b-${sufixo}@exemplo.test`;

  let db: SupabaseClient | undefined;
  let url = "";
  let anonKey = "";
  let userA = "";
  let userB = "";
  let orgA = "";
  let orgB = "";
  let convCorpA = "";
  let convPessA = "";
  let convUnkA = "";
  let convCorpB = "";
  let pathCorp = "";
  let pathPess = "";
  let pathUnk = "";
  let tokenA = "";
  let tokenB = "";
  let grantA = "";

  async function insere(tabela: string, valores: Record<string, unknown>): Promise<string> {
    if (!db) throw new Error("db ausente");
    const { data, error } = await db.from(tabela).insert(valores).select("id").single();
    if (error || !data) throw new Error(`${tabela}: ${error?.message ?? "sem id"}`);
    return String((data as { id: string }).id);
  }

  test.beforeAll(async () => {
    const c = credenciaisSupabaseDeTeste();
    url = c.url;
    anonKey = c.anonKey;
    db = createClient(c.url, c.serviceRole, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const a = await db.auth.admin.createUser({
      email: emailA,
      password: senha,
      email_confirm: true,
      user_metadata: { full_name: `Deleg A ${sufixo}` },
    });
    if (a.error || !a.data.user) throw new Error(`user A: ${a.error?.message}`);
    userA = a.data.user.id;
    const b = await db.auth.admin.createUser({
      email: emailB,
      password: senha,
      email_confirm: true,
      user_metadata: { full_name: `Deleg B ${sufixo}` },
    });
    if (b.error || !b.data.user) throw new Error(`user B: ${b.error?.message}`);
    userB = b.data.user.id;

    orgA = await insere("organizations", {
      slug: `deleg-a-${sufixo}`,
      display_name: `Deleg A ${sufixo}`,
      legal_name: `Deleg A ${sufixo}`,
      onboarded_at: new Date().toISOString(),
      timezone: "America/Sao_Paulo",
      locale: "pt-BR",
    });
    orgB = await insere("organizations", {
      slug: `deleg-b-${sufixo}`,
      display_name: `Deleg B ${sufixo}`,
      legal_name: `Deleg B ${sufixo}`,
      onboarded_at: new Date().toISOString(),
      timezone: "America/Sao_Paulo",
      locale: "pt-BR",
    });
    const agora = new Date().toISOString();
    const { error: mem } = await db.from("user_organizations").insert([
      { user_id: userA, organization_id: orgA, role: "agent", accepted_at: agora },
      { user_id: userB, organization_id: orgB, role: "agent", accepted_at: agora },
    ]);
    if (mem) throw new Error(`membership: ${mem.message}`);

    const sessA = await insere("channel_sessions", {
      organization_id: orgA,
      waha_session_name: `deleg-a-${sufixo}`,
      display_name: `Canal A ${sufixo}`,
      status: "WORKING",
      webhook_secret_encrypted: "\\x00",
    });
    const sessUnk = await insere("channel_sessions", {
      organization_id: orgA,
      waha_session_name: `deleg-unk-${sufixo}`,
      display_name: `Canal unk ${sufixo}`,
      status: "WORKING",
      webhook_secret_encrypted: "\\x00",
    });
    const sessB = await insere("channel_sessions", {
      organization_id: orgB,
      waha_session_name: `deleg-b-${sufixo}`,
      display_name: `Canal B ${sufixo}`,
      status: "WORKING",
      webhook_secret_encrypted: "\\x00",
    });

    const contaA = await insere("delegacao_contas_empresariais", { organization_id: orgA });
    const contaB = await insere("delegacao_contas_empresariais", { organization_id: orgB });
    const { error: vinculo } = await db.from("delegacao_sessoes_empresariais").insert([
      { channel_session_id: sessA, organization_id: orgA, conta_empresarial_id: contaA },
      { channel_session_id: sessB, organization_id: orgB, conta_empresarial_id: contaB },
    ]);
    if (vinculo) throw new Error(`vinculo: ${vinculo.message}`);

    const ctCorpA = await insere("contacts", {
      organization_id: orgA,
      name: `Corp A ${sufixo}`,
      is_personal: false,
    });
    const ctPessA = await insere("contacts", {
      organization_id: orgA,
      name: `Pess A ${sufixo}`,
      is_personal: true,
    });
    const ctUnkA = await insere("contacts", {
      organization_id: orgA,
      name: `Unk A ${sufixo}`,
      is_personal: false,
    });
    const ctCorpB = await insere("contacts", {
      organization_id: orgB,
      name: `Corp B ${sufixo}`,
      is_personal: false,
    });

    convCorpA = await insere("conversations", {
      organization_id: orgA,
      contact_id: ctCorpA,
      channel_session_id: sessA,
      status: "open",
    });
    convPessA = await insere("conversations", {
      organization_id: orgA,
      contact_id: ctPessA,
      channel_session_id: sessA,
      status: "open",
    });
    convUnkA = await insere("conversations", {
      organization_id: orgA,
      contact_id: ctUnkA,
      channel_session_id: sessUnk,
      status: "open",
    });
    convCorpB = await insere("conversations", {
      organization_id: orgB,
      contact_id: ctCorpB,
      channel_session_id: sessB,
      status: "open",
    });

    pathCorp = `${orgA}/deleg-e2e/${sufixo}-corp.bin`;
    pathPess = `${orgA}/deleg-e2e/${sufixo}-pess.bin`;
    pathUnk = `${orgA}/deleg-e2e/${sufixo}-unk.bin`;
    for (const [p, bytes] of [
      [pathCorp, BYTES_CORP],
      [pathPess, BYTES_PESS],
      [pathUnk, BYTES_UNK],
    ] as const) {
      const { error: up } = await db.storage.from("whatsapp-media").upload(p, bytes, {
        contentType: "application/octet-stream",
        upsert: true,
      });
      if (up) throw new Error(`upload ${p}: ${up.message}`);
    }

    const sentAt = new Date().toISOString();
    const { error: msgs } = await db.from("messages").insert([
      {
        organization_id: orgA,
        conversation_id: convCorpA,
        contact_id: ctCorpA,
        channel_session_id: sessA,
        direction: "inbound",
        type: "image",
        status: "received",
        body: "corp",
        media_storage_path: pathCorp,
        sent_at: sentAt,
      },
      {
        organization_id: orgA,
        conversation_id: convPessA,
        contact_id: ctPessA,
        channel_session_id: sessA,
        direction: "inbound",
        type: "image",
        status: "received",
        body: "pess",
        media_storage_path: pathPess,
        sent_at: sentAt,
      },
      {
        organization_id: orgA,
        conversation_id: convUnkA,
        contact_id: ctUnkA,
        channel_session_id: sessUnk,
        direction: "inbound",
        type: "image",
        status: "received",
        body: "unk",
        media_storage_path: pathUnk,
        sent_at: sentAt,
      },
      {
        organization_id: orgB,
        conversation_id: convCorpB,
        contact_id: ctCorpB,
        channel_session_id: sessB,
        direction: "inbound",
        type: "text",
        status: "received",
        body: "corp-b",
        sent_at: sentAt,
      },
    ]);
    if (msgs) throw new Error(`messages: ${msgs.message}`);

    const expira = new Date(Date.now() + 86_400_000).toISOString();
    const { data: grants, error: gErr } = await db
      .from("delegacao_visibilidade_corporativa")
      .insert([
        {
          organization_id: orgA,
          user_id: userA,
          oauth_client_id: CLIENT_ID,
          efeitos: ["buscar", "ler", "baixar"],
          expires_at: expira,
        },
        {
          organization_id: orgB,
          user_id: userB,
          oauth_client_id: CLIENT_ID,
          efeitos: ["buscar", "ler", "baixar"],
          expires_at: expira,
        },
      ])
      .select("id, user_id");
    if (gErr || !grants) throw new Error(`grant: ${gErr?.message}`);
    grantA = String(grants.find((g) => (g as { user_id: string }).user_id === userA)?.id ?? "");

    tokenA = await jwtDedicado(url, anonKey, emailA, senha, CLIENT_ID);
    tokenB = await jwtDedicado(url, anonKey, emailB, senha, CLIENT_ID);
    const payloadA = decodeJwt(tokenA);
    if (payloadA.role !== "oauth_delegado" || payloadA.client_id !== CLIENT_ID) {
      throw new Error("JWT A não ficou com papel dedicado");
    }
    if (typeof payloadA.sub !== "string" || payloadA.sub !== userA) {
      throw new Error("JWT A sem sub do usuário");
    }

    if (c.dbUrl) {
      const pool = new pg.Pool({ connectionString: c.dbUrl, max: 1 });
      try {
        const { rows } = await pool.query<{
          member: boolean;
          sel: boolean;
          prereq: boolean;
          obj_sel: boolean;
          stor_usage: boolean;
          stor_dono: string | null;
        }>(
          `select
             pg_has_role('authenticator', 'oauth_delegado', 'member') as member,
             has_table_privilege(
               'oauth_delegado',
               'public.delegacao_visibilidade_corporativa',
               'select'
             ) as sel,
             has_function_privilege(
               'oauth_delegado',
               'public.fn_pgrst_recusar_replay_do_gateway()',
               'execute'
             ) as prereq,
             has_table_privilege(
               'oauth_delegado',
               'storage.objects',
               'select'
             ) as obj_sel,
             has_schema_privilege(
               'oauth_delegado',
               'storage',
               'usage'
             ) as stor_usage,
             (select r.rolname
                from pg_namespace n
                join pg_roles r on r.oid = n.nspowner
               where n.nspname = 'storage') as stor_dono`,
        );
        const row = rows[0];
        if (!row?.member || !row.sel || !row.prereq || !row.obj_sel || !row.stor_usage) {
          throw new Error(
            `catalogo oauth_delegado: member=${String(row?.member)} sel=${String(row?.sel)} prereq=${String(row?.prereq)} obj_sel=${String(row?.obj_sel)} stor_usage=${String(row?.stor_usage)} dono=${String(row?.stor_dono)}`,
          );
        }
        await pool.query("notify pgrst, 'reload schema'");
      } finally {
        await pool.end();
      }
    }
  });

  test.afterAll(async () => {
    if (!db) return;
    for (const p of [pathCorp, pathPess, pathUnk]) {
      if (p) await db.storage.from("whatsapp-media").remove([p]);
    }
    if (orgA) await db.from("organizations").delete().eq("id", orgA);
    if (orgB) await db.from("organizations").delete().eq("id", orgB);
    if (userA) await db.auth.admin.deleteUser(userA);
    if (userB) await db.auth.admin.deleteUser(userB);
  });

  test("A busca/lê/baixa bytes corporativos; pessoal e desconhecida recusam", async ({
    request,
  }) => {
    const ident = await request.get("/api/mcp/delegacao", {
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(ident.status(), "GET com JWT dedicado (identidade Next)").toBe(200);
    const identBody = opacoHttp(await ident.text());
    expect(identBody).toMatch(/delegacao_buscar/);

    const buscar = await toolsCall(request, tokenA, "delegacao_buscar");
    if (buscar.status !== 200) {
      const diag = await diagnosticoCadeia({
        appGetStatus: ident.status(),
        supabaseUrl: url,
        anonKey,
        token: tokenA,
      });
      expect(buscar.status, `${diag} rpc=${opacoHttp(JSON.stringify(buscar.rpc))}`).toBe(200);
    }
    const ids = (buscar.rpc.result?.structuredContent?.conversations ?? []).map((c) => c.id);
    expect(ids).toContain(convCorpA);
    expect(ids).not.toContain(convPessA);
    expect(ids).not.toContain(convUnkA);
    expect(ids).not.toContain(convCorpB);

    const ler = await toolsCall(request, tokenA, "delegacao_ler", {
      conversation_id: convCorpA,
    });
    expect(ler.status).toBe(200);
    expect(ler.rpc.result?.structuredContent?.conversation?.id).toBe(convCorpA);
    expect((ler.rpc.result?.structuredContent?.messages ?? []).length).toBeGreaterThan(0);

    const pess = await toolsCall(request, tokenA, "delegacao_ler", {
      conversation_id: convPessA,
    });
    expect(pess.status).toBe(404);
    expect(pess.rpc.result?.structuredContent).toBeUndefined();

    const unk = await toolsCall(request, tokenA, "delegacao_ler", {
      conversation_id: convUnkA,
    });
    expect(unk.status).toBe(404);

    const baixar = await toolsCall(request, tokenA, "delegacao_baixar", {
      conversation_id: convCorpA,
      bucket: "whatsapp-media",
      path: pathCorp,
    });
    if (baixar.status !== 200) {
      const diag = await diagnosticoCadeia({
        appGetStatus: ident.status(),
        supabaseUrl: url,
        anonKey,
        token: tokenA,
        pathCorp,
      });
      expect(baixar.status, `${diag} rpc=${opacoHttp(JSON.stringify(baixar.rpc))}`).toBe(200);
    }
    expect(baixar.rpc.result?.structuredContent?.visivel).toBe(true);
    expect(baixar.rpc.result?.structuredContent?.path).toBe(pathCorp);
    const signed = baixar.rpc.result?.structuredContent?.signed_url;
    expect(signed, "baixar no Next precisa devolver signed_url com os bytes").toEqual(
      expect.stringMatching(/\S/),
    );
    const bytes = await request.get(signed as string);
    expect(bytes.status()).toBe(200);
    expect(Buffer.from(await bytes.body())).toEqual(BYTES_CORP);

    const baixarPess = await toolsCall(request, tokenA, "delegacao_baixar", {
      conversation_id: convPessA,
      bucket: "whatsapp-media",
      path: pathPess,
    });
    expect(baixarPess.status).toBe(404);
    const baixarUnk = await toolsCall(request, tokenA, "delegacao_baixar", {
      conversation_id: convUnkA,
      bucket: "whatsapp-media",
      path: pathUnk,
    });
    expect(baixarUnk.status).toBe(404);
  });

  test("B não lê a org de A; A não lê a org de B", async ({ request }) => {
    const buscarB = await toolsCall(request, tokenB, "delegacao_buscar");
    expect(buscarB.status).toBe(200);
    const idsB = (buscarB.rpc.result?.structuredContent?.conversations ?? []).map((c) => c.id);
    expect(idsB).toContain(convCorpB);
    expect(idsB).not.toContain(convCorpA);

    const cruzado = await toolsCall(request, tokenB, "delegacao_ler", {
      conversation_id: convCorpA,
    });
    expect(cruzado.status).toBe(404);

    const cruzadoA = await toolsCall(request, tokenA, "delegacao_ler", {
      conversation_id: convCorpB,
    });
    expect(cruzadoA.status).toBe(404);
  });

  test("grant CRM revogado corta na hora com o mesmo access JWT", async ({ request }) => {
    if (!db) throw new Error("db ausente");
    const { error } = await db
      .from("delegacao_visibilidade_corporativa")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", grantA);
    if (error) throw new Error(`revoke grant: ${error.message}`);

    const buscar = await toolsCall(request, tokenA, "delegacao_buscar");
    expect(buscar.status).toBe(404);
    const ler = await toolsCall(request, tokenA, "delegacao_ler", {
      conversation_id: convCorpA,
    });
    expect(ler.status).toBe(404);
    const baixar = await toolsCall(request, tokenA, "delegacao_baixar", {
      conversation_id: convCorpA,
      bucket: "whatsapp-media",
      path: pathCorp,
    });
    expect(baixar.status).toBe(404);
  });
});
