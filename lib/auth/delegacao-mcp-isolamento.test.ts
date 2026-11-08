import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MCP_ORG = readFileSync("app/api/mcp/route.ts", "utf8");
const MCP_DEL = readFileSync("app/api/mcp/delegacao/route.ts", "utf8");
const HTTP = readFileSync("lib/auth/delegacao-http.ts", "utf8");
const SUPER = readFileSync("lib/auth/delegacao-superficie.ts", "utf8");
const ROTA_CONTA = readFileSync(
  "app/api/v1/channel-sessions/[id]/conta-empresarial/route.ts",
  "utf8",
);

describe("MCP individual isolado do dsk_/admin", () => {
  it("/api/mcp continua dsk_ + admin; /api/mcp/delegacao não", () => {
    expect(MCP_ORG).toMatch(/validateBearerToken/);
    expect(MCP_ORG).toMatch(/createAdminClient/);
    expect(MCP_DEL).not.toMatch(/validateBearerToken/);
    expect(MCP_DEL).not.toMatch(/createAdminClient/);
    expect(MCP_DEL).toMatch(/createUserClientFromAccessToken/);
    expect(HTTP).not.toMatch(/dsk_/);
    expect(HTTP).not.toMatch(/createAdminClient|validateBearerToken/);
    expect(SUPER).toMatch(/Nunca dsk_\/admin/);
  });

  it("cadastro da conexão é PUT/DELETE aninhado, admin+support, sem telefone", () => {
    expect(ROTA_CONTA).toMatch(/requireRole\("admin"/);
    expect(ROTA_CONTA).toMatch(/requireSupportWrite/);
    expect(ROTA_CONTA).toMatch(/export async function PUT/);
    expect(ROTA_CONTA).toMatch(/export async function DELETE/);
    expect(ROTA_CONTA).not.toMatch(/export async function POST/);
    expect(ROTA_CONTA).not.toMatch(/phone_number|\be164\b/i);
    expect(ROTA_CONTA).toMatch(/conta_empresarial_id/);
  });
});
