import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { isPublicPath } from "@/lib/auth/public-paths";
import { GET, POST } from "./route";

describe("/api/mcp/delegacao — desligada", () => {
  it("GET e POST 404 sem tocar Auth, admin ou storage", async () => {
    const get = await GET();
    const post = await POST();
    expect(get.status).toBe(404);
    expect(post.status).toBe(404);
    const corpo = await get.json();
    expect(corpo).toMatchObject({ error: { code: "not_found" } });
    expect(JSON.stringify(corpo)).not.toMatch(/storage|signedUrl|segredo/i);
  });

  it("o proxy não decide (regex MCP já cobre); o guarda é da rota", () => {
    expect(isPublicPath("/api/mcp/delegacao")).toBe(true);
    expect(isPublicPath("/api/mcp")).toBe(true);
  });

  it("fonte isolada do MCP de organização: sem admin, sem dsk_, sem catálogo", () => {
    const fonte = fs.readFileSync(path.join(__dirname, "route.ts"), "utf8");
    expect(fonte).not.toMatch(/createAdminClient/);
    expect(fonte).not.toMatch(/validateBearerToken/);
    expect(fonte).not.toMatch(/createMcpServer/);
    expect(fonte).not.toMatch(/SERVICE_ROLE/);
    expect(fonte).toMatch(/ATIVACAO_DELEGADA_PADRAO/);
  });

  it("ativação padrão continua desligada — o 404 não é um mock de sucesso", async () => {
    const { ATIVACAO_DELEGADA_PADRAO } = await import("@/lib/auth/delegacao-empresarial");
    expect(ATIVACAO_DELEGADA_PADRAO.ativa).toBe(false);
    expect(ATIVACAO_DELEGADA_PADRAO.contratoAprovado).toBe(false);
  });
});
