import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  HOOK_ACCESS_TOKEN_ROLE_ENUM_OFICIAL,
  roleClaimPermitidaPeloHookOficial,
} from "./delegacao-hook-papel-oficial";
import { RPC_OAUTH } from "./delegacao-oauth-matriz";

describe("Custom Access Token Hook — enum das docs (não é schema de runtime)", () => {
  it("página de docs lista enum anon|authenticated — não prova recusa do Auth", () => {
    expect(HOOK_ACCESS_TOKEN_ROLE_ENUM_OFICIAL).toEqual(["anon", "authenticated"]);
    expect(roleClaimPermitidaPeloHookOficial("authenticated")).toBe(true);
    expect(roleClaimPermitidaPeloHookOficial("anon")).toBe(true);
    expect(roleClaimPermitidaPeloHookOficial("oauth_delegado")).toBe(false);
    expect(roleClaimPermitidaPeloHookOficial("service_role")).toBe(false);
  });

  it("0773 e a matriz não criam hook nem GRANT de papel terceiro", () => {
    const mig = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "supabase/migrations/20261108190000_0773_delegacao_visibilidade_corporativa.sql",
      ),
      "utf8",
    );
    const codigo = mig
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(codigo).not.toMatch(/custom_access_token/i);
    expect(codigo).not.toMatch(/create role/i);
    expect(codigo).not.toMatch(/grant authenticated to/i);
    expect(RPC_OAUTH.estado).toBe("nao_confinado");
    expect(RPC_OAUTH.alternativas.join(" ")).not.toMatch(/role distinto/i);
  });
});
