import { describe, expect, it } from "vitest";

import { MS_SEM_ATUALIZACAO_INTERROMPE, andamentoDeLinha } from "@/lib/painel/consulta";

describe("andamento da consulta do painel", () => {
  it("rodando recente permanece rodando", () => {
    const agora = Date.parse("2026-10-28T12:00:00.000Z");
    const a = andamentoDeLinha(
      {
        etapa_atual: "lendo anexo…",
        status: "rodando",
        updated_at: "2026-10-28T11:59:00.000Z",
      },
      agora,
    );
    expect(a.status).toBe("rodando");
    expect(a.etapa).toBe("lendo anexo…");
  });

  it("rodando sem atualização por 150s vira interrompida na leitura, sem gravar", () => {
    const agora = Date.parse("2026-10-28T12:00:00.000Z");
    const updated = new Date(agora - MS_SEM_ATUALIZACAO_INTERROMPE - 1).toISOString();
    const a = andamentoDeLinha(
      {
        etapa_atual: "consultando Superlógica…",
        status: "rodando",
        updated_at: updated,
        resposta: null,
      },
      agora,
    );
    expect(a.status).toBe("interrompida");
    expect(a.etapa).toBe("consultando Superlógica…");
  });

  it("pronto e erro não viram interrompida", () => {
    const agora = Date.parse("2026-10-28T12:00:00.000Z");
    const velho = "2026-10-28T10:00:00.000Z";
    expect(
      andamentoDeLinha(
        {
          etapa_atual: null,
          status: "pronto",
          resposta: "ok",
          updated_at: velho,
        },
        agora,
      ).status,
    ).toBe("pronto");
    expect(
      andamentoDeLinha(
        {
          etapa_atual: null,
          status: "erro",
          resposta: "",
          updated_at: velho,
        },
        agora,
      ).status,
    ).toBe("erro");
  });
});
