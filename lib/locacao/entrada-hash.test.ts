import { describe, expect, it } from "vitest";

import {
  ABAS_QUE_DEPENDEM_DA_FICHA,
  canonicoDaEntrada,
  entradaDaAba,
  hashDaEntrada,
} from "@/lib/locacao/entrada-hash";

describe("hash da entrada da aba", () => {
  it("mesma entrada em ordem diferente de chaves produz o mesmo hash", () => {
    expect(hashDaEntrada({ b: 2, a: 1 })).toBe(hashDaEntrada({ a: 1, b: 2 }));
    expect(canonicoDaEntrada({ b: 2, a: 1 })).toBe(canonicoDaEntrada({ a: 1, b: 2 }));
  });

  it("mudar um campo muda o hash", () => {
    const antes = hashDaEntrada(entradaDaAba("renda", { fichaVersao: 1, ficha: { renda: 1000 } }));
    const depois = hashDaEntrada(entradaDaAba("renda", { fichaVersao: 1, ficha: { renda: 2000 } }));
    expect(antes).not.toBe(depois);
    expect(antes).toMatch(/^[0-9a-f]{16}$/);
  });

  it("as abas que dependem da ficha não incluem documentos", () => {
    expect(ABAS_QUE_DEPENDEM_DA_FICHA).not.toContain("documentos");
    expect(ABAS_QUE_DEPENDEM_DA_FICHA).toContain("renda");
    expect(ABAS_QUE_DEPENDEM_DA_FICHA).toContain("fc");
  });
});
