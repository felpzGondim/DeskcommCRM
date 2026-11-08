#!/usr/bin/env node
/**
 * M1 — authorization_code+PKCE+refresh contra GoTrue real.
 * Nunca imprime password, code, keys, access_token ou refresh_token.
 */
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { request as httpRequest, createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { jwtVerify, SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";

const AUTH = process.env.M1_AUTH_URL;
const PROXY = process.env.M1_PROXY_URL;
const ISSUER = process.env.M1_ISSUER;
const SITE = process.env.M1_SITE_URL;
const REDIRECT = process.env.M1_REDIRECT_URI;
const JWT_SECRET = process.env.M1_JWT_SECRET;
const EMAIL = process.env.M1_USER_EMAIL;
const PASSWORD = process.env.M1_USER_PASSWORD;
const OUT = process.env.M1_RESULTS_PATH;
const PSQL = process.env.M1_PSQL;

if (!AUTH || !PROXY || !ISSUER || !SITE || !REDIRECT || !JWT_SECRET || !EMAIL || !PASSWORD || !OUT || !PSQL) {
  console.error("m1-oauth.mjs: missing required env (names only; values omitted)");
  process.exit(2);
}

const secret = new TextEncoder().encode(JWT_SECRET);
const cases = [];
let pass = 0;
let fail = 0;
let skip = 0;

function record(id, ok, detail) {
  cases.push({ id, ok: ok === true, skip: ok === "skip", detail });
  if (ok === true) pass += 1;
  else if (ok === "skip") skip += 1;
  else fail += 1;
  const tag = ok === true ? "PASS" : ok === "skip" ? "SKIP" : "FAIL";
  console.log(`${tag} ${id}`);
}

function publicErr(status, body) {
  const out = { status };
  if (body && typeof body === "object") {
    for (const k of ["error", "error_code", "msg", "message", "error_description", "code"]) {
      if (k in body && typeof body[k] !== "object") out[k] = body[k];
    }
  }
  return out;
}

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function decodePayload(jwt) {
  const parts = jwt.split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function summarizeClaims(claims, expect) {
  const sub = typeof claims.sub === "string" ? claims.sub : null;
  const role = typeof claims.role === "string" ? claims.role : null;
  const clientId = typeof claims.client_id === "string" ? claims.client_id : null;
  const sessionId = typeof claims.session_id === "string" ? claims.session_id : null;
  const iss = typeof claims.iss === "string" ? claims.iss : null;
  return {
    role,
    has_sub: Boolean(sub),
    sub_eq_user: Boolean(expect.userId) && sub === expect.userId,
    has_client_id: Boolean(clientId),
    client_id_eq_expected: expect.clientId ? clientId === expect.clientId : !clientId,
    has_session_id: Boolean(sessionId),
    iss,
    iss_eq_expected: iss === ISSUER,
    aud: claims.aud ?? null,
  };
}

async function parseJson(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { _non_json: true, _len: text.length };
  }
}

async function req(method, url, { headers = {}, body, form } = {}) {
  const h = { ...headers };
  let payload;
  if (form) {
    payload = new URLSearchParams(form).toString();
    h["content-type"] = "application/x-www-form-urlencoded";
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    h["content-type"] = "application/json";
  }
  const res = await fetch(url, { method, headers: h, body: payload, redirect: "manual" });
  const json = await parseJson(res);
  return { status: res.status, headers: res.headers, json, location: res.headers.get("location") };
}

function stripSecrets(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (/token|secret|password|code|key|refresh|access/i.test(k)) {
      out[k] = typeof v === "string" ? `[redacted len=${v.length}]` : "[redacted]";
    } else if (v && typeof v === "object") {
      out[k] = stripSecrets(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function mintAdmin() {
  return new SignJWT({ role: "service_role" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience("authenticated")
    .setSubject("00000000-0000-4000-8000-000000000099")
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(secret);
}

async function mintAnon() {
  return new SignJWT({ role: "anon" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(secret);
}

function startProxy() {
  const authUrl = new URL(AUTH);
  const proxyUrl = new URL(PROXY);
  const server = createServer((incoming, outgoing) => {
    const stripped = (incoming.url || "/").replace(/^\/auth\/v1/, "") || "/";
    const headers = { ...incoming.headers, host: authUrl.host };
    const p = httpRequest(
      {
        hostname: authUrl.hostname,
        port: authUrl.port || 80,
        path: stripped,
        method: incoming.method,
        headers,
      },
      (r) => {
        outgoing.writeHead(r.statusCode || 500, r.headers);
        r.pipe(outgoing);
      },
    );
    p.on("error", (err) => {
      outgoing.writeHead(502);
      outgoing.end(String(err.message));
    });
    incoming.pipe(p);
  });
  return new Promise((resolve) => {
    server.listen(Number(proxyUrl.port), proxyUrl.hostname, () => resolve(server));
  });
}

async function verifyJose(jwt, expectIss) {
  const { payload } = await jwtVerify(jwt, secret, {
    issuer: expectIss,
    algorithms: ["HS256"],
  });
  return payload;
}

function sqlLit(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

function setHookMode(mode, mappedClientId) {
  const sql = `
    insert into public.m1_hook_config (k, v) values
      ('mode', ${sqlLit(mode)}),
      ('mapped_client_id', ${sqlLit(mappedClientId)})
    on conflict (k) do update set v = excluded.v;
  `;
  execFileSync(PSQL, ["-d", "m1_auth", "-v", "ON_ERROR_STOP=1", "-q", "-c", sql], {
    encoding: "utf8",
  });
}

async function oauthCodeFlow({ userAccess, clientId, clientSecret }) {
  const { verifier, challenge } = pkce();
  const state = randomBytes(8).toString("hex");
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: "email",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  const authz = await req("GET", `${AUTH}/oauth/authorize?${q}`);
  if (authz.status !== 302 || !authz.location) {
    return { ok: false, step: "authorize", err: publicErr(authz.status, authz.json) };
  }
  const loc = new URL(authz.location, SITE);
  const authorizationId = loc.searchParams.get("authorization_id");
  if (!authorizationId) {
    return {
      ok: false,
      step: "authorize_id",
      err: { has_error_q: loc.searchParams.has("error"), error: loc.searchParams.get("error") },
    };
  }
  const details = await req("GET", `${AUTH}/oauth/authorizations/${authorizationId}`, {
    headers: { Authorization: `Bearer ${userAccess}` },
  });
  if (details.status !== 200) {
    return { ok: false, step: "authorization_details", err: publicErr(details.status, details.json) };
  }
  let redirectUrl = typeof details.json?.redirect_url === "string" ? details.json.redirect_url : null;
  if (!redirectUrl) {
    const consent = await req("POST", `${AUTH}/oauth/authorizations/${authorizationId}/consent`, {
      headers: { Authorization: `Bearer ${userAccess}` },
      body: { action: "approve" },
    });
    redirectUrl = typeof consent.json?.redirect_url === "string" ? consent.json.redirect_url : null;
    if (consent.status !== 200 || !redirectUrl) {
      return { ok: false, step: "consent", err: publicErr(consent.status, consent.json) };
    }
  }
  const cb = new URL(redirectUrl);
  const code = cb.searchParams.get("code");
  if (!code) {
    return { ok: false, step: "code", err: { error: cb.searchParams.get("error"), has_code: false } };
  }
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const token = await req("POST", `${AUTH}/oauth/token`, {
    headers: { Authorization: `Basic ${basic}` },
    form: {
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
    },
  });
  const access = token.json?.access_token;
  const refresh = token.json?.refresh_token;
  if (token.status !== 200 || typeof access !== "string") {
    return { ok: false, step: "token", err: publicErr(token.status, token.json) };
  }
  return { ok: true, access, refresh: typeof refresh === "string" ? refresh : null, clientId };
}

async function refreshFlow({ clientId, clientSecret, refreshToken }) {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const token = await req("POST", `${AUTH}/oauth/token`, {
    headers: { Authorization: `Basic ${basic}` },
    form: { grant_type: "refresh_token", refresh_token: refreshToken },
  });
  const access = token.json?.access_token;
  if (token.status !== 200 || typeof access !== "string") {
    return { ok: false, err: publicErr(token.status, token.json) };
  }
  return { ok: true, access };
}

async function main() {
  const proxy = await startProxy();

  const adminJwt = await mintAdmin();
  const anonKey = await mintAnon();

  const signup = await req("POST", `${AUTH}/signup`, {
    body: { email: EMAIL, password: PASSWORD },
  });
  if (signup.status !== 200 && signup.status !== 201) {
    record("m1.signup", false, publicErr(signup.status, signup.json));
    throw new Error("signup failed");
  }
  record("m1.signup", true, {
    status: signup.status,
    has_user: Boolean(signup.json?.id || signup.json?.user?.id),
  });

  const passwordGrant = await req("POST", `${AUTH}/token?grant_type=password`, {
    body: { email: EMAIL, password: PASSWORD },
  });
  const cookieAccess = passwordGrant.json?.access_token;
  if (passwordGrant.status !== 200 || typeof cookieAccess !== "string") {
    record("m1.password_grant", false, publicErr(passwordGrant.status, passwordGrant.json));
    throw new Error("password grant failed");
  }
  const cookieClaims = decodePayload(cookieAccess);
  const userId = cookieClaims?.sub;
  let joseCookieOk = false;
  try {
    await verifyJose(cookieAccess, ISSUER);
    joseCookieOk = true;
  } catch (e) {
    record("m1.password_jose", false, { name: e?.name });
  }
  const cookieSum = summarizeClaims(cookieClaims ?? {}, { userId, clientId: null });
  const passwordOk =
    cookieSum.role === "authenticated" &&
    cookieSum.sub_eq_user &&
    cookieSum.has_client_id === false &&
    joseCookieOk;
  record("m1.password_grant", passwordOk, { ...cookieSum, jose_ok: joseCookieOk });

  const userRes = await req("GET", `${AUTH}/user`, {
    headers: { Authorization: `Bearer ${cookieAccess}` },
  });
  record("m1.password_get_user", userRes.status === 200 && userRes.json?.id === userId, {
    status: userRes.status,
    id_match: userRes.json?.id === userId,
  });

  async function registerClient(name) {
    const r = await req("POST", `${AUTH}/admin/oauth/clients`, {
      headers: { Authorization: `Bearer ${adminJwt}` },
      body: {
        client_name: name,
        redirect_uris: [REDIRECT],
        grant_types: ["authorization_code", "refresh_token"],
        token_endpoint_auth_method: "client_secret_basic",
        client_type: "confidential",
      },
    });
    if (
      r.status !== 201 ||
      typeof r.json?.client_id !== "string" ||
      typeof r.json?.client_secret !== "string"
    ) {
      return { ok: false, err: publicErr(r.status, stripSecrets(r.json)) };
    }
    return { ok: true, clientId: r.json.client_id, clientSecret: r.json.client_secret };
  }

  const clientA = await registerClient("m1-mapped");
  const clientB = await registerClient("m1-control");
  record(
    "m1.register_client_mapped",
    clientA.ok,
    clientA.ok ? { client_id: clientA.clientId } : clientA.err,
  );
  record(
    "m1.register_client_control",
    clientB.ok,
    clientB.ok ? { client_id: clientB.clientId } : clientB.err,
  );
  if (!clientA.ok || !clientB.ok) throw new Error("client register failed");

  setHookMode("map_role", clientA.clientId);

  const flowA = await oauthCodeFlow({
    userAccess: cookieAccess,
    clientId: clientA.clientId,
    clientSecret: clientA.clientSecret,
  });
  if (!flowA.ok) {
    record("m1.oauth_pkce_mapped", false, flowA);
  } else {
    let joseOk = false;
    let josePayload = null;
    try {
      josePayload = await verifyJose(flowA.access, ISSUER);
      joseOk = true;
    } catch (e) {
      record("m1.oauth_mapped_jose", false, { name: e?.name });
    }
    const claims = josePayload ?? decodePayload(flowA.access) ?? {};
    const sum = summarizeClaims(claims, { userId, clientId: clientA.clientId });
    const ok =
      joseOk &&
      sum.role === "oauth_delegado" &&
      sum.sub_eq_user &&
      sum.has_client_id &&
      sum.client_id_eq_expected &&
      sum.iss_eq_expected;
    record("m1.oauth_pkce_mapped", ok, { ...sum, jose_ok: joseOk });

    const sdk = createClient(PROXY, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const claimsRes = await sdk.auth.getClaims(flowA.access);
    const sdkClaims = claimsRes.data?.claims ?? null;
    const sdkSum = sdkClaims
      ? summarizeClaims(sdkClaims, { userId, clientId: clientA.clientId })
      : { sdk_error: claimsRes.error?.message ?? "no claims" };
    record(
      "m1.oauth_mapped_getClaims",
      Boolean(sdkClaims) && sdkSum.role === "oauth_delegado",
      sdkSum,
    );
    const userSdk = await sdk.auth.getUser(flowA.access);
    record(
      "m1.oauth_mapped_getUser",
      Boolean(userSdk.data?.user?.id) && userSdk.data.user.id === userId,
      {
        id_match: userSdk.data?.user?.id === userId,
        has_error: Boolean(userSdk.error),
      },
    );

    if (flowA.refresh) {
      const refreshed = await refreshFlow({
        clientId: clientA.clientId,
        clientSecret: clientA.clientSecret,
        refreshToken: flowA.refresh,
      });
      if (!refreshed.ok) {
        record("m1.oauth_refresh_mapped", false, refreshed.err);
      } else {
        const rc = decodePayload(refreshed.access) ?? {};
        const rsum = summarizeClaims(rc, { userId, clientId: clientA.clientId });
        let rJose = false;
        try {
          await verifyJose(refreshed.access, ISSUER);
          rJose = true;
        } catch {
          rJose = false;
        }
        record(
          "m1.oauth_refresh_mapped",
          rJose && rsum.role === "oauth_delegado" && rsum.sub_eq_user && rsum.client_id_eq_expected,
          { ...rsum, jose_ok: rJose },
        );
      }
    } else {
      record("m1.oauth_refresh_mapped", false, { reason: "no refresh token on authorization_code" });
    }
  }

  const flowB = await oauthCodeFlow({
    userAccess: cookieAccess,
    clientId: clientB.clientId,
    clientSecret: clientB.clientSecret,
  });
  if (!flowB.ok) {
    record("m1.oauth_pkce_other_client", false, flowB);
  } else {
    const claims = decodePayload(flowB.access) ?? {};
    const sum = summarizeClaims(claims, { userId, clientId: clientB.clientId });
    let joseOk = false;
    try {
      await verifyJose(flowB.access, ISSUER);
      joseOk = true;
    } catch {
      joseOk = false;
    }
    record(
      "m1.oauth_pkce_other_client",
      joseOk && sum.role === "authenticated" && sum.sub_eq_user && sum.client_id_eq_expected,
      { ...sum, jose_ok: joseOk },
    );
  }

  setHookMode("omit_client_id", clientA.clientId);
  const flowOmit = await oauthCodeFlow({
    userAccess: cookieAccess,
    clientId: clientA.clientId,
    clientSecret: clientA.clientSecret,
  });
  if (!flowOmit.ok) {
    record("m1.oauth_omit_client_id", false, flowOmit);
  } else {
    const claims = decodePayload(flowOmit.access) ?? {};
    const sum = summarizeClaims(claims, { userId, clientId: null });
    record("m1.oauth_omit_client_id", sum.has_client_id === false && sum.sub_eq_user, sum);
  }
  setHookMode("map_role", clientA.clientId);

  const passwordAgain = await req("POST", `${AUTH}/token?grant_type=password`, {
    body: { email: EMAIL, password: PASSWORD },
  });
  const pa = passwordAgain.json?.access_token;
  if (typeof pa === "string") {
    const sum = summarizeClaims(decodePayload(pa) ?? {}, { userId, clientId: null });
    record(
      "m1.password_unaffected_after_hook",
      sum.role === "authenticated" && sum.has_client_id === false,
      sum,
    );
  } else {
    record("m1.password_unaffected_after_hook", false, publicErr(passwordAgain.status, passwordAgain.json));
  }

  writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        pass,
        fail,
        skip,
        user_id: userId,
        mapped_client_id: clientA.ok ? clientA.clientId : null,
        control_client_id: clientB.ok ? clientB.clientId : null,
        dedicated_role: "oauth_delegado",
        cases,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );

  proxy.close();
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("m1-oauth.mjs crashed:", err?.name, err?.message);
  try {
    writeFileSync(
      OUT,
      `${JSON.stringify({ pass, fail: fail + 1, skip, crash: err?.name, cases }, null, 2)}\n`,
      { mode: 0o600 },
    );
  } catch {
    /* ignore */
  }
  process.exit(1);
});
