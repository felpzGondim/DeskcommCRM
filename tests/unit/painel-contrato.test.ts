import { beforeEach, describe, expect, it, vi } from "vitest";

const saida = vi.hoisted(() => vi.fn());
vi.mock("@/lib/mcp/servidor-externo/chamada", () => ({ fetchDeSaida: () => saida }));

import { abrirContrato, chamarApiContrato, preparoContratoSchema, resultadoContratoSchema, selarContrato } from "@/lib/agent-engine/agent/painel-contrato";

const preview = "ab".repeat(18);
const segredo = "segredo-para-os-testes";
const servidor = { endpoint: "https://hub.example/mcp", chave: "chave-privada" };

describe("locação pelo painel", () => {
  beforeEach(() => { vi.useRealTimers(); saida.mockReset(); });

  it("prende prévia e chave idempotente à organização, conversa, pessoa e servidor", () => {
    const token = selarContrato(preview, 1800, segredo, "org:conversa:pessoa:hub");
    const recibo = abrirContrato(token, segredo, "org:conversa:pessoa:hub");
    expect(recibo?.preview).toBe(preview);
    expect(abrirContrato(token, segredo, "org:conversa:pessoa:hub")?.chave).toBe(recibo?.chave);
    for (const escopo of ["outra:conversa:pessoa:hub", "org:outra:pessoa:hub", "org:conversa:outra:hub", "org:conversa:pessoa:outro"]) {
      expect(abrirContrato(token, segredo, escopo)).toBeNull();
    }
    expect(abrirContrato(token + "x", segredo, "org:conversa:pessoa:hub")).toBeNull();
    expect(abrirContrato(token, "outro-segredo", "org:conversa:pessoa:hub")).toBeNull();
  });

  it("expira a prévia conforme o prazo do Hub, limitado a 30 minutos", () => {
    vi.useFakeTimers();
    const token = selarContrato(preview, 10, segredo, "escopo");
    vi.advanceTimersByTime(10_001);
    expect(abrirContrato(token, segredo, "escopo")).toBeNull();
    const limitado = selarContrato(preview, 86400, segredo, "escopo");
    vi.advanceTimersByTime(1800_001);
    expect(abrirContrato(limitado, segredo, "escopo")).toBeNull();
    vi.useRealTimers();
  });

  it("aceita o identificador hexadecimal real do Hub e o resumo completo", () => {
    expect(preparoContratoSchema.parse({ pronto: true, preview_id: preview, pendencias: [],
      resumo: { texto: "Locação ativa; taxas e condições completas." }, validade_s: 1800 }).preview_id).toBe(preview);
    expect(resultadoContratoSchema.parse({ gravado: true, completo: false, id_contrato: "358", situacao: "ATIVO",
      acoes_manuais: ["Pausar pela tela"], divergencias: ["IPTU pendente"] })).toMatchObject({ completo: false, id_contrato: "358" });
  });

  it("usa exclusivamente a origem e credencial cadastradas e não vaza erros remotos", async () => {
    saida.mockResolvedValueOnce({ ok: true, json: async () => ({ pronto: false }) });
    await expect(chamarApiContrato(servidor, "preparar", { aluguel: 1000 })).resolves.toEqual({ pronto: false });
    expect(saida).toHaveBeenCalledWith("https://hub.example/contrato/preparar", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer chave-privada" }), body: '{"aluguel":1000}',
    }));
    saida.mockResolvedValueOnce({ ok: false, status: 401, json: () => { throw new Error("CPF e segredo"); } });
    await expect(chamarApiContrato(servidor, "confirmar", {})).rejects.toThrow("hub_contract_permission");
    await expect(chamarApiContrato({ ...servidor, endpoint: "https://hub.example/qualquer" }, "preparar", {})).rejects.toThrow("hub_endpoint_invalid");
    expect(saida).toHaveBeenCalledTimes(2);
  });
});
