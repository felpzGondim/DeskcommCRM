import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  processo: vi.fn(),
  emAndamento: vi.fn(),
  abrir: vi.fn(),
  ficha: vi.fn(),
  ligada: vi.fn(),
}));

vi.mock("@/lib/locacao/analise/processo-da-conversa", () => ({
  processoDaConversa: mocks.processo,
}));
vi.mock("@/lib/locacao/execucoes", () => ({
  lerExecucaoEmAndamento: mocks.emAndamento,
  abrirExecucao: mocks.abrir,
}));
vi.mock("@/lib/locacao/repositorio", () => ({
  lerFichaAtualDoProcesso: mocks.ficha,
}));
vi.mock("@/lib/locacao/chaves", () => ({
  analiseLigada: mocks.ligada,
}));

import { iniciarAnaliseDeRenda, TEXTO_RENDA_NA_FILA } from "@/lib/locacao/analise/iniciar-renda";

const ctx = {
  orgId: "org-1",
  conversationId: "conv-1",
  contactId: "c1",
  userId: "user-1",
  requestId: "req-1",
  origem: "botao" as const,
  settings: { locacao: { analise: { renda: true } } },
  admin: {},
  dbSessao: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              limit: async () => ({
                data: [{ id: "m1", media_storage_path: "org/c/a.pdf", media_size_bytes: 10 }],
                error: null,
              }),
            }),
          }),
        }),
      }),
    }),
  },
};

describe("iniciarAnaliseDeRenda", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ligada.mockReturnValue(true);
    mocks.processo.mockResolvedValue({ id: "proc-1" });
    mocks.emAndamento.mockResolvedValue(null);
    mocks.ficha.mockResolvedValue({ versao: 2 });
    mocks.abrir.mockResolvedValue("00000000-0000-4000-8000-0000000000ee");
  });

  it("só enfileira e devolve o id — não processa", async () => {
    const r = await iniciarAnaliseDeRenda(ctx as never, {});
    expect(r.ok).toBe(true);
    expect(r.texto).toBe(TEXTO_RENDA_NA_FILA);
    expect(r.extra?.execucao_id).toBe("00000000-0000-4000-8000-0000000000ee");
    expect(r.extra?.estado).toBe("na_fila");
    expect(mocks.abrir).toHaveBeenCalledWith(
      ctx.admin,
      expect.objectContaining({
        aba: "renda",
        origem: "botao",
        processoId: "proc-1",
        entradaHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
    const src = readFileSync("lib/locacao/analise/iniciar-renda.ts", "utf8");
    expect(src).not.toContain("enriquecerAnexosDaAnalise");
    expect(src).not.toContain("servidor-externo");
  });

  it("reusa execução já na fila ou processando", async () => {
    mocks.emAndamento.mockResolvedValue({
      id: "ja-existe",
      estado: "processando",
      etapa_texto: "lendo extrato pág. 3 de 10",
    });
    const r = await iniciarAnaliseDeRenda(ctx as never, {});
    expect(r.ok).toBe(true);
    expect(r.extra?.execucao_id).toBe("ja-existe");
    expect(r.extra?.reusada).toBe(true);
    expect(mocks.abrir).not.toHaveBeenCalled();
  });

  it("origem agente vira chat", async () => {
    await iniciarAnaliseDeRenda({ ...ctx, origem: "agente" } as never, {});
    expect(mocks.abrir).toHaveBeenCalledWith(
      ctx.admin,
      expect.objectContaining({ origem: "chat" }),
    );
  });
});
