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
      { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", type: "text", body: "sou o fiador", direction: "inbound" },
      { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", type: "document", body: "holerite",
        media_derived_status: "ready", media_derived_text: "liquido 4000",
        metadata: { media_filename: "holerite.pdf" }, media_storage_path: "org/conv/secreto.pdf" },
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
      result: { text: '{"relatorio":"Maria quer o apto 10.","ficha":{"pessoas":[{"papel":"inquilino","principal":true,"nome":{"valor":"Maria"}}]}}' },
      callId: "call-1",
    } as never);
    const { saida } = await gerarRelatorioPreliminarNoPainel(
      {} as never,
      {} as never,
      { tenantId: "org", contactId: "contato", fontes: "[M1] cliente text Maria" },
    );
    expect(saida.relatorio).toContain("Maria");
    expect(saida.ficha.pessoas[0]?.papel).toBe("inquilino");
    expect(saida.ficha.pessoas[0]?.celular.valor).toBeNull();
    expect(runModelCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ purpose: "painel_atendente", system: SYSTEM_DO_RELATORIO_PRELIMINAR }),
      expect.anything(),
    );
  });
});
