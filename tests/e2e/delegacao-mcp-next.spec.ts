/**
 * Superfície MCP individual no **processo Next** (next start do job e2e),
 * não o handler importado no vitest. Cookie = papel authenticated, recusado.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { test, expect, type Page } from "./helpers/test";

interface E2ECreds {
  password: string;
  users: Record<string, { id: string; email: string; role: string }>;
}

const CREDS_PATH = path.join(process.cwd(), ".e2e-creds.json");

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

test("GET /api/mcp/delegacao sem Bearer é 401 com WWW-Authenticate", async ({ request }) => {
  const r = await request.get("/api/mcp/delegacao");
  expect(r.status()).toBe(401);
  expect(r.headers()["www-authenticate"] ?? "").toMatch(/Bearer/);
});

test("RFC 9728 well-known do recurso MCP individual no Next", async ({ request }) => {
  const r = await request.get("/.well-known/oauth-protected-resource/api/mcp/delegacao");
  expect(r.status()).toBe(200);
  const j = (await r.json()) as { resource?: string };
  expect(j.resource).toMatch(/\/api\/mcp\/delegacao$/);
});

test("cookie authenticated não entra na superfície MCP", async ({ page }) => {
  await loginAgent(page);
  const r = await page.request.get("/api/mcp/delegacao");
  expect(r.status()).toBe(401);
  const body = await r.text();
  expect(body).not.toMatch(/delegacao_buscar/);
});
