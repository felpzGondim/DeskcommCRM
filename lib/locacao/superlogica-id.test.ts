import { describe, expect, it } from "vitest";

import { idPessoaSuperlogica, vinculoDaLinha, vinculoEmCustomFields } from "@/lib/locacao/superlogica-id";

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

describe("vinculoDaLinha", () => {
  it("lê a pessoa e o primeiro tipo da tabela de vínculo", () => {
    expect(vinculoDaLinha({
      superlogica_pessoa_id: "7788",
      tipos: ["locatario", "fiador"],
    })).toEqual({ superlogica_id_pessoa: "7788", superlogica_tipo: "locatario" });
    expect(vinculoDaLinha({ superlogica_pessoa_id: "abc", tipos: [] })).toEqual({
      superlogica_id_pessoa: null,
      superlogica_tipo: null,
    });
    expect(vinculoDaLinha(null)).toEqual({
      superlogica_id_pessoa: null,
      superlogica_tipo: null,
    });
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
