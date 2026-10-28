import { describe, expect, it } from "vitest";

import { ehStatusFinal, rotuloDoStatusDoProcesso, transicaoPermitida } from "@/lib/locacao/status";

describe("transições do processo", () => {
  it("aprovado só o aprovador move, de analise ou documentos", () => {
    expect(transicaoPermitida("analise", "aprovado", "aprovador")).not.toBeNull();
    expect(transicaoPermitida("documentos", "aprovado", "aprovador")).not.toBeNull();
    expect(transicaoPermitida("analise", "aprovado", "atendente")).toBeNull();
    expect(transicaoPermitida("analise", "aprovado", "sistema")).toBeNull();
  });

  it("reprovar pede motivo e qualquer atendente consegue", () => {
    const t = transicaoPermitida("analise", "reprovado", "atendente");
    expect(t?.exigeMotivo).toBe(true);
    expect(transicaoPermitida("aprovado", "reprovado", "atendente")).not.toBeNull();
  });

  it("contrato_criado só o sistema (confirmação humana já aconteceu na rota)", () => {
    expect(transicaoPermitida("contrato_preparado", "contrato_criado", "sistema")).not.toBeNull();
    expect(transicaoPermitida("contrato_preparado", "contrato_criado", "atendente")).toBeNull();
  });

  it("reabrir reprovado/cancelado é só do aprovador", () => {
    expect(transicaoPermitida("reprovado", "documentos", "aprovador")).not.toBeNull();
    expect(transicaoPermitida("cancelado", "documentos", "aprovador")).not.toBeNull();
    expect(transicaoPermitida("reprovado", "documentos", "atendente")).toBeNull();
  });

  it("rótulo da etapa não é o código do CHECK", () => {
    expect(rotuloDoStatusDoProcesso("contrato_criado")).toBe("Contrato criado");
    expect(rotuloDoStatusDoProcesso("analise", (s) => s.toUpperCase())).toBe("ANÁLISE");
    expect(rotuloDoStatusDoProcesso("desconhecido")).toBe("desconhecido");
  });

  it("cancelar de etapa não final vale; de assinado não", () => {
    expect(transicaoPermitida("lead", "cancelado", "atendente")).not.toBeNull();
    expect(transicaoPermitida("contrato_assinado", "cancelado", "atendente")).toBeNull();
    expect(ehStatusFinal("contrato_assinado")).toBe(true);
    expect(ehStatusFinal("lead")).toBe(false);
  });
});
