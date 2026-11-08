import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("createUserClientFromAccessToken", () => {
  it("usa a anon key e o Bearer da pessoa; nunca service role", () => {
    const fonte = fs.readFileSync(path.join(__dirname, "jwt-usuario.ts"), "utf8");
    expect(fonte).toMatch(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
    expect(fonte).toMatch(/Authorization: `Bearer \$\{jwt\}`/);
    expect(fonte).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(fonte).not.toMatch(/createAdminClient/);
    expect(fonte).not.toMatch(/sign\(/);
    expect(fonte).not.toMatch(/from ["']jose["']/);
  });
});
