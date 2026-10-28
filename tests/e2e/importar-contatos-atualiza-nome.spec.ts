/**
 * IMPORTAR CONTATOS — prévia e substituição do nome principal.
 *
 * Quem chegou pelo WhatsApp fica com o nome principal vazio (a tela mostra o
 * pushName ou o número). Com a opção ligada, o primeiro envio é prévia
 * (não grava); "Confirmar importação" cria, preenche o vazio e substitui o
 * já preenchido. Sem confirmação nome a nome.
 *
 * Pré-requisitos (banco local do baseline, app buildada):
 *   pnpm e2e:env && pnpm e2e:build
 *   pnpm exec playwright test tests/e2e/importar-contatos-atualiza-nome.spec.ts
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "./helpers/test";

import { carregarEnvLocal } from "../../scripts/lib/env-de-teste";

const CREDS_PATH = path.join(process.cwd(), ".e2e-creds.json");

interface Creds {
  password: string;
  org_id: string;
  users: Record<string, { email: string }>;
}

function loadCreds(): Creds {
  if (!fs.existsSync(CREDS_PATH)) {
    execFileSync("npx", ["tsx", "scripts/seed-e2e-credentials.ts"], { stdio: "inherit" });
  }
  return JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as Creds;
}

const creds = loadCreds();
const env = carregarEnvLocal();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SUFIXO = `${Date.now()}`.slice(-7);
const TEL_VAZIO = `+5511999${SUFIXO.slice(0, 6).padStart(6, "0")}`;
const TEL_CHEIO = `+5511888${SUFIXO.slice(0, 6).padStart(6, "0")}`;
const TEL_NOVO = `+5511777${SUFIXO.slice(0, 6).padStart(6, "0")}`;

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(creds.users.agent!.email);
  await page.locator("#password").fill(creds.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/app\//);
}

async function criarPelaApi(
  page: Page,
  corpo: { name?: string; display_name?: string; phone_number: string; source: string },
): Promise<string> {
  const r = await page.request.post("/api/v1/contacts", { data: corpo });
  expect(r.status(), await r.text()).toBe(201);
  const json = (await r.json()) as { data: { contact: { id: string } } };
  return json.data.contact.id;
}

test("importação mostra prévia e, ao confirmar, preenche o vazio e substitui o preenchido", async ({
  page,
}) => {
  await login(page);

  const idVazio = await criarPelaApi(page, {
    display_name: `Zap ${SUFIXO}`,
    phone_number: TEL_VAZIO,
    source: "whatsapp",
  });
  const idCheio = await criarPelaApi(page, {
    name: `Carlos ${SUFIXO}`,
    phone_number: TEL_CHEIO,
    source: "manual",
  });

  await page.goto("/app/contacts");
  await page.getByRole("button", { name: "Importar CSV" }).click();
  const dialogo = page.getByRole("dialog", { name: "Importar contatos de planilha" });
  await expect(dialogo).toBeVisible();

  const csv = [
    "nome,telefone",
    `Maria ${SUFIXO},${TEL_VAZIO}`,
    `Carlos Silva ${SUFIXO},${TEL_CHEIO}`,
    `Nova ${SUFIXO},${TEL_NOVO}`,
  ].join("\n");

  await dialogo.getByTestId("atualizar-existentes").check();
  await dialogo.getByTestId("arquivo-de-contatos").setInputFiles({
    name: "contatos.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf8"),
  });
  await dialogo.getByRole("button", { name: "Importar" }).click();

  const resumo = dialogo.getByTestId("resumo-da-importacao");
  await expect(resumo).toBeVisible({ timeout: 15_000 });
  await expect(resumo).toContainText("1 serão criado(s)");
  await expect(resumo).toContainText("1 serão preenchido(s)");
  await expect(resumo).toContainText("1 serão substituído(s)");

  const { data: vazioAntes } = await admin
    .from("contacts")
    .select("name")
    .eq("id", idVazio)
    .eq("organization_id", creds.org_id)
    .single();
  expect(vazioAntes?.name ?? null).toBeNull();

  const { data: cheioAntes } = await admin
    .from("contacts")
    .select("name")
    .eq("id", idCheio)
    .eq("organization_id", creds.org_id)
    .single();
  expect(cheioAntes?.name).toBe(`Carlos ${SUFIXO}`);

  await dialogo.getByTestId("confirmar-importacao").click();
  await expect(resumo).toContainText("1 importado(s)");
  await expect(resumo).toContainText("1 preenchido(s)");
  await expect(resumo).toContainText("1 substituído(s)");

  const { data: vazio } = await admin
    .from("contacts")
    .select("name")
    .eq("id", idVazio)
    .eq("organization_id", creds.org_id)
    .single();
  expect(vazio?.name).toBe(`Maria ${SUFIXO}`);

  const { data: cheioDepois } = await admin
    .from("contacts")
    .select("name")
    .eq("id", idCheio)
    .eq("organization_id", creds.org_id)
    .single();
  expect(cheioDepois?.name).toBe(`Carlos Silva ${SUFIXO}`);

  await admin.from("contacts").delete().in("id", [idVazio, idCheio]);
  await admin
    .from("contacts")
    .delete()
    .eq("organization_id", creds.org_id)
    .eq("phone_number", TEL_NOVO);
});
