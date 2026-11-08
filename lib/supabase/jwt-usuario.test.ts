import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FONTE = readFileSync("lib/supabase/jwt-usuario.ts", "utf8");

describe("createUserClientFromAccessToken", () => {
  it("usa a anon key, nunca a service role", () => {
    expect(FONTE).toMatch(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
    expect(FONTE).not.toMatch(/SERVICE_ROLE/);
    expect(FONTE).not.toMatch(/createAdminClient/);
  });

  it("recusa token vazio no fonte", () => {
    expect(FONTE).toMatch(/token ausente/);
  });
});
