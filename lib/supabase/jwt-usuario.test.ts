import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FONTE = readFileSync("lib/supabase/jwt-usuario.ts", "utf8");
const SUJEITO = readFileSync("lib/auth/delegacao-oauth-sujeito.ts", "utf8");

describe("createUserClientFromAccessToken", () => {
  it("usa a anon key, nunca a service role", () => {
    expect(FONTE).toMatch(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
    expect(FONTE).not.toMatch(/SERVICE_ROLE/);
    expect(FONTE).not.toMatch(/createAdminClient/);
  });

  it("recusa token vazio no fonte", () => {
    expect(FONTE).toMatch(/token ausente/);
  });

  it("manda o JWT da pessoa via accessToken, não só global.headers", () => {
    expect(FONTE).toMatch(/accessToken:\s*async\s*\(\)\s*=>\s*jwt/);
  });

  it("leitor Auth não usa o client com accessToken (auth vira Proxy)", () => {
    expect(FONTE).toMatch(/export function createAnonAuthLeitor/);
    expect(SUJEITO).toMatch(/createAnonAuthLeitor/);
    expect(SUJEITO).not.toMatch(/createUserClientFromAccessToken/);
  });
});
