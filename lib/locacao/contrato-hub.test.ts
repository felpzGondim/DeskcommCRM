import { describe, expect, it } from "vitest";

import {
  INSTRUCAO_IA_SEM_CONTRATO,
  interpretarContratoHub,
  motivoDoVazioDoContratoHub,
} from "@/lib/locacao/contrato-hub";

describe("interpretarContratoHub", () => {
  it("encontrado só em status ok com contrato", () => {
    const r = interpretarContratoHub({
      resultado: "ok",
      encontrado: true,
      status: "ok",
      contrato: { imovel: "Rua Fictícia 10", valor: "R$ 1.200,00", situacao: "ativo" },
      inquilino_situacao: "ativo",
    });
    expect(r).toMatchObject({
      status: "ok",
      encontrado: true,
      inquilinoSituacao: "ativo",
      instrucaoIa: null,
    });
    expect(r?.contrato?.imovel).toBe("Rua Fictícia 10");
  });

  it("encontrado:false nunca é sucesso, mesmo com resultado ok", () => {
    const r = interpretarContratoHub({
      resultado: "ok",
      encontrado: false,
      status: "ok",
      contrato: { imovel: "não deveria aparecer" },
    });
    expect(r).toMatchObject({ status: "nao_encontrado", encontrado: false, contrato: null });
    expect(r?.textoParaAtendente).toMatch(/não prova que o cliente não tem contrato/i);
    expect(r?.instrucaoIa).toBe(INSTRUCAO_IA_SEM_CONTRATO);
  });

  it.each([
    "nao_encontrado",
    "pedido_invalido",
    "multiplos_contratos",
    "indisponivel",
    "nao_permitido",
  ] as const)("status %s é não encontrado e instrui a IA a não afirmar ao cliente", (status) => {
    const r = interpretarContratoHub({ resultado: status, encontrado: false, status });
    expect(r?.encontrado).toBe(false);
    expect(r?.status).toBe(status);
    expect(r?.instrucaoIa).toBe(INSTRUCAO_IA_SEM_CONTRATO);
    expect(r?.textoParaAtendente.length).toBeGreaterThan(20);
  });
});

describe("motivoDoVazioDoContratoHub", () => {
  it("separa vazio de sucesso técnico", () => {
    expect(motivoDoVazioDoContratoHub({ encontrado: true, status: "ok" })).toBeNull();
    expect(motivoDoVazioDoContratoHub({ encontrado: false, status: "nao_encontrado" }))
      .toBe("nao_encontrado");
    expect(motivoDoVazioDoContratoHub({ encontrado: false, status: "indisponivel" }))
      .toBe("indisponivel");
    expect(motivoDoVazioDoContratoHub({
      texto: "x",
      dados: { encontrado: false, status: "nao_encontrado" },
    })).toBe("nao_encontrado");
  });
});
