import { describe, expect, it, vi } from "vitest";

vi.mock("../edge/llm/run-model-call", () => ({
  runModelCall: vi.fn(),
}));

import { runModelCall } from "../edge/llm/run-model-call";
import {
  blocoDasFontesDaFicha,
  fontesDaFicha,
  gerarRelatorioPreliminarNoPainel,
  SYSTEM_DO_RELATORIO_PRELIMINAR,
} from "@/lib/agent-engine/agent/painel-relatorio-preliminar";

describe("fontes da ficha preliminar", () => {
  it("numera a janela e leva o id da mensagem sem path de storage", () => {
    const fontes = fontesDaFicha([
      {
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        type: "text",
        body: "sou o fiador",
        direction: "inbound",
      },
      {
        id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        type: "document",
        body: "holerite",
        media_derived_status: "ready",
        media_derived_text: "liquido 4000",
        metadata: { media_filename: "holerite.pdf" },
        media_storage_path: "org/conv/secreto.pdf",
      },
    ]);
    expect(fontes[0]?.id).toBe("M1");
    expect(fontes[0]?.message_id).toBe("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    expect(blocoDasFontesDaFicha(fontes)).toContain("holerite.pdf");
    expect(blocoDasFontesDaFicha(fontes)).not.toContain("org/conv/secreto.pdf");
  });

  it("o prompt proíbe FC paga, contrato e alugue/não alugue", () => {
    expect(SYSTEM_DO_RELATORIO_PRELIMINAR).toMatch(/Nunca envie mensagem/);
    expect(SYSTEM_DO_RELATORIO_PRELIMINAR).toMatch(/FC Score\+/);
    expect(SYSTEM_DO_RELATORIO_PRELIMINAR).toMatch(/\/contrato\/confirmar/);
    expect(SYSTEM_DO_RELATORIO_PRELIMINAR).toMatch(/alugue/);
  });

  it("monta a ficha a partir do JSON do modelo, sem chamar provedor real", async () => {
    vi.mocked(runModelCall).mockResolvedValue({
      result: {
        text: '{"relatorio":"Maria quer o apto 10.","ficha":{"pessoas":[{"papel":"inquilino","principal":true,"nome":{"valor":"Maria"}}]}}',
      },
      callId: "call-1",
    } as never);
    const { saida } = await gerarRelatorioPreliminarNoPainel({} as never, {} as never, {
      tenantId: "org",
      contactId: "contato",
      fontes: "[M1] cliente text Maria",
    });
    expect(saida.relatorio).toContain("Maria");
    expect(saida.ficha.pessoas[0]?.papel).toBe("inquilino");
    expect(saida.ficha.pessoas[0]?.celular.valor).toBeNull();
    expect(runModelCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        purpose: "painel_atendente",
        system: SYSTEM_DO_RELATORIO_PRELIMINAR,
        maxOutputTokens: 16384,
      }),
      expect.anything(),
    );
  });

  it("o prompt pede trecho curto e omite o esqueleto de nulos", () => {
    expect(SYSTEM_DO_RELATORIO_PRELIMINAR).toMatch(/~80 caracteres/);
    expect(SYSTEM_DO_RELATORIO_PRELIMINAR).toMatch(/omita o campo/);
    expect(SYSTEM_DO_RELATORIO_PRELIMINAR).not.toMatch(/"valor":null/);
    expect(SYSTEM_DO_RELATORIO_PRELIMINAR).toMatch(/texto foi cortado/);
  });

  it("saída truncada pelo teto de tokens vira saida_truncada", async () => {
    vi.mocked(runModelCall).mockResolvedValue({
      result: { text: '{"relatorio":"incompleto"', finishReason: "length" },
      callId: "call-2",
    } as never);
    await expect(
      gerarRelatorioPreliminarNoPainel({} as never, {} as never, {
        tenantId: "org",
        contactId: "contato",
        fontes: "[M1] cliente text Maria",
      }),
    ).rejects.toThrow("saida_truncada");
  });

  it("marca fonte no teto de derivação e não infere ausência", () => {
    const fontes = fontesDaFicha([
      {
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        type: "document",
        body: "",
        direction: "inbound",
        media_derived_status: "ready",
        media_derived_text: "débito ".repeat(2000).slice(0, 8000),
        metadata: { media_filename: "extrato.pdf" },
      },
    ]);
    expect(fontes[0]?.truncado).toBe(true);
    expect(blocoDasFontesDaFicha(fontes)).toMatch(/TEXTO CORTADO NO TETO DE DERIVAÇÃO/);
    expect(blocoDasFontesDaFicha(fontes)).toMatch(/Não conclua ausência de créditos/);
  });

  it("PDF reaberto por completo não leva o aviso de corte", () => {
    const fontes = fontesDaFicha([
      {
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        type: "document",
        body: "",
        direction: "inbound",
        media_derived_status: "ready",
        media_derived_text: `${"crédito 1000\n".repeat(900)}`.slice(0, 12000),
        original_completo: true,
        metadata: { media_filename: "extrato.pdf" },
      },
    ]);
    expect(fontes[0]?.truncado).toBe(false);
    expect(blocoDasFontesDaFicha(fontes)).not.toMatch(/TEXTO CORTADO NO TETO DE DERIVAÇÃO/);
  });
});
