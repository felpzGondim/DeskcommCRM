import { beforeEach, describe, expect, it, vi } from "vitest";

const generateText = vi.hoisted(() => vi.fn());
const binding = vi.hoisted(() => vi.fn());
const resolve = vi.hoisted(() => vi.fn());
const registrar = vi.hoisted(() => vi.fn());

vi.mock("ai", () => ({ generateText: (...a: unknown[]) => generateText(...a) }));
vi.mock("@/lib/ai/par-provedor-modelo", () => ({
  validarParProvedorModelo: () => ({ valido: true }),
}));
vi.mock("@/lib/ai/usage/registrar-chamada", () => ({
  registrarChamadaDeIa: (...a: unknown[]) => registrar(...a),
}));
vi.mock("@/lib/agent-engine/edge/llm/credentials", () => ({
  resolveOrgLlmConfig: (...a: unknown[]) => resolve(...a),
}));
vi.mock("@/lib/agent-engine/edge/llm/providers", () => ({
  createDefaultRegistry: () => ({ google: () => "modelo" }),
}));
vi.mock("@/lib/agent-engine/db/request-pool", () => ({
  getRequestPool: () => ({}),
}));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn() } }));
vi.mock("@/lib/automation/destinos-internos-autorizados", () => ({
  motivoDaRecusaDeDestino: vi.fn(async () => null),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => binding(),
            }),
          }),
        }),
      }),
    }),
  }),
}));

import {
  PROMPT_CLASSIFICACAO_DE_DOCUMENTO,
  classificarDocumentoComModelo,
  textoParaClassificar,
} from "./classificar-documento-modelo";

describe("classificação residual pelo modelo padrão da visão", () => {
  beforeEach(() => {
    generateText.mockReset();
    binding.mockReset().mockResolvedValue({ data: {
      provider: "google", model_id: "gemini-2.5-flash", credential_id: null, base_url: null,
    }, error: null });
    resolve.mockReset().mockResolvedValue({
      provider: "google", defaultModel: "gemini-2.5-flash", apiKey: "x",
      origemDaChave: "credencial_da_organizacao",
    });
    registrar.mockReset();
  });

  it("apaga dígitos longos e não leva o conteúdo cru no prompt curto", () => {
    const recorte = textoParaClassificar("folha.pdf", "valor 4000 linha " + "9".repeat(20));
    expect(recorte).toContain("arquivo: folha.pdf");
    expect(recorte).not.toMatch(/\d{3,}/);
    expect(PROMPT_CLASSIFICACAO_DE_DOCUMENTO).toContain("Não transcreva");
  });

  it("devolve só a categoria do caminho padrão da visão", async () => {
    generateText.mockResolvedValue({ text: "comprovante_renda\n", usage: { inputTokens: 8, outputTokens: 2 } });
    await expect(classificarDocumentoComModelo({
      organizationId: "10000000-0000-4000-8000-000000000001",
      nomeArquivo: "folha.pdf",
      textoDerivado: "proventos liquidos",
      llmCfg: {} as never,
    })).resolves.toBe("comprovante_renda");
    expect(generateText).toHaveBeenCalledTimes(1);
    const pedido = generateText.mock.calls[0]![0] as { messages: Array<{ content: string }> };
    expect(pedido.messages[0]!.content).toContain(PROMPT_CLASSIFICACAO_DE_DOCUMENTO);
    expect(pedido.messages[0]!.content).not.toMatch(/\d{3,}/);
  });

  it("falha aberta sem logar o texto", async () => {
    generateText.mockRejectedValue(new Error("rede"));
    await expect(classificarDocumentoComModelo({
      organizationId: "10000000-0000-4000-8000-000000000001",
      nomeArquivo: "folha.pdf",
      textoDerivado: "proventos liquidos",
      llmCfg: {} as never,
    })).resolves.toBeNull();
  });

  it("não envia a chave da instalação para o endereço da organização", async () => {
    binding.mockResolvedValue({ data: {
      provider: "google", model_id: "gemini-2.5-flash", credential_id: null,
      base_url: "https://openrouter.example/v1",
    }, error: null });
    resolve.mockResolvedValue({
      provider: "google", defaultModel: "gemini-2.5-flash", apiKey: "chave-da-instalacao",
      origemDaChave: "chave_da_instalacao",
    });
    await expect(classificarDocumentoComModelo({
      organizationId: "10000000-0000-4000-8000-000000000001",
      nomeArquivo: "folha.pdf",
      textoDerivado: "proventos liquidos",
      llmCfg: {} as never,
    })).resolves.toBeNull();
    expect(generateText).not.toHaveBeenCalled();
  });
});
