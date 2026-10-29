import { describe, expect, it } from "vitest";

import { idPessoaSuperlogica, vinculoEmCustomFields } from "@/lib/locacao/superlogica-id";

describe("idPessoaSuperlogica", () => {
  it("aceita 1 a 12 dígitos e recusa o resto", () => {
    expect(idPessoaSuperlogica("7788")).toBe("7788");
    expect(idPessoaSuperlogica(42)).toBe("42");
    expect(idPessoaSuperlogica("012345678901")).toBe("012345678901");
    expect(idPessoaSuperlogica("0123456789012")).toBeNull();
    expect(idPessoaSuperlogica("abc")).toBeNull();
    expect(idPessoaSuperlogica(0)).toBeNull();
    expect(idPessoaSuperlogica(-3)).toBeNull();
  });
});

describe("vinculoEmCustomFields", () => {
  it("lê só o id numérico e o tipo curto", () => {
    expect(vinculoEmCustomFields({
      superlogica_id_pessoa: "7788",
      superlogica_tipo: "locatario",
    })).toEqual({ superlogica_id_pessoa: "7788", superlogica_tipo: "locatario" });
    expect(vinculoEmCustomFields(null)).toEqual({
      superlogica_id_pessoa: null,
      superlogica_tipo: null,
    });
  });
});
