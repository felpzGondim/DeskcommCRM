import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { isPublicPath } from "@/lib/auth/public-paths";
import { GET } from "./route";

describe("RFC 9728 metadata da superfície delegada — desligada", () => {
  it("GET 404 e não anuncia authorization_servers", async () => {
    const res = await GET();
    expect(res.status).toBe(404);
    const corpo = await res.json();
    expect(corpo).toMatchObject({ error: { code: "not_found" } });
    expect(JSON.stringify(corpo)).not.toMatch(/authorization_servers|client_id/i);
  });

  it("path público âncorado: o proxy não 401; a rota recusa", () => {
    expect(isPublicPath("/.well-known/oauth-protected-resource/api/mcp/delegacao")).toBe(
      true,
    );
    expect(isPublicPath("/.well-known/oauth-protected-resource/api/mcp/outra")).toBe(
      false,
    );
  });

  it("fonte não importa admin nem inicia OAuth", () => {
    const fonte = fs.readFileSync(path.join(__dirname, "route.ts"), "utf8");
    expect(fonte).not.toMatch(/createAdminClient/);
    expect(fonte).not.toMatch(/authorize\?/);
    expect(fonte).toMatch(/ATIVACAO_DELEGADA_PADRAO/);
  });
});
