import { describe, expect, it } from "vitest";

import {
  mascararCnpj,
  mascararContatoLocador,
  mascararDocumentoLocador,
} from "@/lib/locacao/mascarar-locador";

describe("máscara do locador", () => {
  it("CPF e CNPJ fictícios saem mascarados, sem o miolo", () => {
    expect(mascararDocumentoLocador("529.982.247-25")).toBe("***.***.**7-25");
    expect(mascararCnpj("11.222.333/0001-81")).toBe("**.***.***/****-81");
    expect(mascararDocumentoLocador("11222333000181")).toBe("**.***.***/****-81");
    expect(mascararDocumentoLocador("")).toBe("");
  });

  it("telefone e e-mail fictícios saem mascarados", () => {
    expect(mascararContatoLocador("11987654321")).toBe("(11) *****-4321");
    expect(mascararContatoLocador("locador@exemplo.test")).toBe("l***@exemplo.test");
    expect(mascararContatoLocador("")).toBe("");
  });
});
