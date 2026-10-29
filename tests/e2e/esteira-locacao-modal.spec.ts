import {randomUUID} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
import {expect, test} from "./helpers/test";
import {credenciaisSupabaseDeTeste} from "../../scripts/lib/env-de-teste";

const credenciais = credenciaisSupabaseDeTeste();
const db = createClient(credenciais.url, credenciais.serviceRole, {auth: {persistSession: false}});
const sufixo = randomUUID().slice(0, 8);
const email = "esteira-" + sufixo + "@deskcomm.test";
const senha = "E2e!" + randomUUID();
let orgId = "", userId = "", conversaId = "", mensagemId = "", arquivoPath = "";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=", "base64");

async function inserir(tabela: string, valores: Record<string, unknown>) {
  const {data, error} = await db.from(tabela).insert(valores).select("id").single();
  if (error || !data) throw new Error(tabela + ": " + error?.message);
  return String(data.id);
}

test.describe("Esteira de locação: dados e documentos no mesmo modal", () => {
  test.describe.configure({timeout: 180000});
  test.beforeAll(async () => {
    const {data, error} = await db.auth.admin.createUser({email, password: senha, email_confirm: true, user_metadata: {full_name: "Operador da esteira"}});
    if (error || !data.user) throw new Error("Não foi possível preparar o operador de teste.");
    userId = data.user.id;
    orgId = await inserir("organizations", {
      slug: "esteira-" + sufixo, display_name: "Esteira E2E " + sufixo, legal_name: "Esteira E2E",
      onboarded_at: new Date().toISOString(), timezone: "America/Sao_Paulo", locale: "pt-BR",
      settings: {locacao: {processos_habilitado: true, arquivos_habilitado: true, analise: {renda: true, fc: true, seguro: true, relatorio: true}}},
    });
    const {error: membro} = await db.from("user_organizations").insert({user_id: userId, organization_id: orgId, role: "manager", accepted_at: new Date().toISOString()});
    if (membro) throw new Error(membro.message);
    const canal = await inserir("channel_sessions", {organization_id: orgId, waha_session_name: "esteira-" + sufixo, display_name: "Canal da esteira", status: "WORKING", webhook_secret_encrypted: "\\x00"});
    const contato = await inserir("contacts", {organization_id: orgId, name: "Candidato da esteira " + sufixo, phone_number: "+55119" + String(Date.now()).slice(-8)});
    conversaId = await inserir("conversations", {organization_id: orgId, contact_id: contato, channel_session_id: canal, status: "open", last_message_at: new Date().toISOString(), last_inbound_at: new Date().toISOString()});
    arquivoPath = orgId + "/esteira-e2e/" + sufixo + ".png";
    const {error: upload} = await db.storage.from("whatsapp-media").upload(arquivoPath, png, {contentType: "image/png"});
    if (upload) throw new Error(upload.message);
    mensagemId = await inserir("messages", {
      organization_id: orgId, conversation_id: conversaId, contact_id: contato, channel_session_id: canal,
      direction: "inbound", type: "image", status: "received", sent_via: "external_device",
      body: "Documento do cadastro", media_storage_path: arquivoPath, media_mime: "image/png", media_size_bytes: png.length,
      metadata: {media_filename: "cadastro.png"}, sent_at: new Date().toISOString(),
    });
  });
  test.afterAll(async () => {
    if (arquivoPath) await db.storage.from("whatsapp-media").remove([arquivoPath]);
    if (orgId) await db.from("organizations").delete().eq("id", orgId);
    if (userId) await db.auth.admin.deleteUser(userId);
  });
  test("salvar manualmente alimenta a FC; os documentos continuam no Supabase", async ({page}, testInfo) => {
    const chamadasExternas: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && /painel-agente\/(fc|seguro)$/.test(new URL(r.url()).pathname)) chamadasExternas.push(r.url());
    });
    await page.goto("/login");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(senha);
    await page.getByRole("button", {name: "Entrar", exact: true}).click();
    await page.waitForURL(/\/app/, {timeout: 60000});
    await page.goto("/app/inbox/" + conversaId);
    await page.getByRole("button", {name: "Cadastro e locação", exact: true}).click();
    const modal = page.getByRole("dialog", {name: "Cadastro e locação"});
    await expect(modal).toBeVisible();
    await modal.getByRole("button", {name: "Preencher manualmente"}).click();
    await modal.getByLabel("Nome", {exact: true}).fill("Pessoa da Esteira");
    await modal.getByLabel("CPF", {exact: true}).fill("52998224725");
    await modal.getByLabel("Celular", {exact: true}).fill("11987654321");
    await modal.getByLabel("E-mail", {exact: true}).fill("pessoa@exemplo.test");
    await modal.getByLabel("RENDA (R$)", {exact: true}).fill("5000");
    await modal.getByLabel("Endereço do imóvel", {exact: true}).fill("Rua de Teste");
    await modal.getByLabel("Número do imóvel", {exact: true}).fill("100");
    await modal.getByLabel("Aluguel (R$)", {exact: true}).fill("1500");
    await modal.getByLabel("Condomínio / rateio (R$)", {exact: true}).fill("85");
    await modal.getByLabel("IPTU mensal (R$)", {exact: true}).fill("70");
    await modal.getByLabel("Seguro-incêndio mensal (R$)", {exact: true}).fill("20");
    await expect(modal.getByLabel("Aluguel (R$)", {exact: true})).toHaveCount(1);
    await expect(modal.getByLabel("RENDA (R$)", {exact: true})).toHaveCount(1);
    const gravacao = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/painel-agente/ficha"));
    await modal.getByRole("button", {name: "Salvar ficha", exact: true}).click();
    expect((await gravacao).status()).toBe(200);
    const {data: vinculo, error: erroVinculo} = await db.from("locacao_processo_conversas").select("processo_id").eq("organization_id", orgId).eq("conversation_id", conversaId).single();
    if (erroVinculo || !vinculo) throw new Error("O cadastro não alimentou o processo.");
    const processoId = String(vinculo.processo_id);
    const {data: ficha} = await db.from("locacao_processo_fichas").select("ficha").eq("organization_id", orgId).eq("processo_id", processoId).order("versao", {ascending: false}).limit(1).single();
    expect(ficha?.ficha.pessoas[0].renda_individual.valor).toBe(5000);
    await modal.getByRole("tab", {name: "3. FCAnálise"}).click();
    await expect(modal.getByRole("button", {name: "Analisar FC", exact: true})).toBeEnabled();
    await modal.getByRole("tab", {name: "Documentos e relatórios"}).click();
    await expect(modal.getByText("cadastro.png", {exact: true})).toBeVisible();
    const classificacao = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().endsWith("/locacao/documentos"));
    await modal.getByLabel("Categoria cadastro.png", {exact: true}).selectOption("documento_pessoal");
    expect((await classificacao).status()).toBe(200);
    await modal.getByRole("button", {name: "Visualizar", exact: true}).first().click();
    const imagem = modal.getByRole("img", {name: "cadastro.png", exact: true});
    await expect(imagem).toBeVisible();
    await expect.poll(() => imagem.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await page.screenshot({path: testInfo.outputPath("documentos-no-modal.png"), fullPage: true});
    const {data: mensagem} = await db.from("messages").select("metadata,media_storage_path").eq("organization_id", orgId).eq("id", mensagemId).single();
    expect(mensagem?.metadata.locacao_documentos[processoId].categoria).toBe("documento_pessoal");
    expect(mensagem?.media_storage_path).toBe(arquivoPath);
    expect(chamadasExternas).toEqual([]);
  });
});
