import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mcp/servidor-externo/chamada", () => ({
  chamarFerramentaRemota: vi.fn(async (_s: unknown, _n: string, _a: unknown) => ({
    texto: "",
    dados: { resultado: "nao_encontrado", encontrado: false, status: "nao_encontrado" },
  })),
}));

import { chamarFerramentaRemota } from "@/lib/mcp/servidor-externo/chamada";
import { definirFerramentasRemotas } from "@/lib/mcp/tools/externo";
import { INSTRUCAO_IA_SEM_CONTRATO, motivoDoVazioDoContratoHub } from "@/lib/locacao/contrato-hub";

describe("definirFerramentasRemotas — contrato do Hub", () => {
  it("encontrado:false vira motivoDoVazio e instrui a IA a não afirmar ao cliente", async () => {
    const [def] = definirFerramentasRemotas(
      { endpoint: "https://hub.exemplo/mcp", chave: "x" },
      [{ name: "consultar_contrato_inquilino", somenteLeitura: true }],
      new Set(),
      [{ nome: "consultar_contrato_inquilino", leitura: true }],
    );
    expect(def?.motivoDoVazio).toBe(motivoDoVazioDoContratoHub);
    const r = await def!.handler({}, {} as never);
    expect(def!.motivoDoVazio?.(r)).toBe("nao_encontrado");
    expect((r as { texto: string }).texto).toContain(INSTRUCAO_IA_SEM_CONTRATO);
    expect((r as { dados: { encontrado: boolean } }).dados.encontrado).toBe(false);
    expect(chamarFerramentaRemota).toHaveBeenCalled();
  });
});
