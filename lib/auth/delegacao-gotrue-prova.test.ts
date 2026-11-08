import { describe, expect, it } from "vitest";

import { GOTRUE_PROVA_VIVO } from "./delegacao-gotrue-prova";

describe("pin da prova viva do Auth", () => {
  it("é a tag pública v2.197.0 (SHA do git), não v2.196.0 nem digest gerenciado", () => {
    expect(GOTRUE_PROVA_VIVO.tag).toBe("v2.197.0");
    expect(GOTRUE_PROVA_VIVO.gitSha).toBe("4eee58f296d9698a1c2c0ae14d7a0b379c7622d3");
    expect(GOTRUE_PROVA_VIVO.imagem).toBe("supabase/gotrue:v2.197.0");
    expect(GOTRUE_PROVA_VIVO.origem).toMatch(/\/auth\/v1\/health/);
  });
});
