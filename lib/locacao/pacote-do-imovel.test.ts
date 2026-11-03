import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gravar: vi.fn(),
  tabela: vi.fn(),
}));

vi.mock("@/lib/locacao/repositorio", async (importOriginal) => {
  const atual = await importOriginal<typeof import("@/lib/locacao/repositorio")>();
  return {
    ...atual,
    gravarSuperlogicaImovelId: (...args: unknown[]) => mocks.gravar(...args),
  };
});
vi.mock("@/lib/locacao/admin", () => ({
  tabelaLocacao: (...args: unknown[]) => mocks.tabela(...args),
}));

import { fichaVazia } from "@/lib/locacao/ficha-schema";
import { AVISO_CHAVE_DESLIGADA, AVISO_HUB_INDISPONIVEL } from "@/lib/locacao/locador-do-pacote";
import { validarImovelNoSuperlogica } from "@/lib/locacao/pacote-do-imovel";

const ORG = "00000000-0000-4000-8000-000000000033";
const CONTATO = "00000000-0000-4000-8000-000000000044";
const IMOVEL = "00000000-0000-4000-8000-000000000011";

function fichaComEndereco() {
  const f = fichaVazia();
  f.imovel.logradouro.valor = "Rua Exemplo";
  f.imovel.numero.valor = "100";
  return f;
}

function cadeia(data: unknown) {
  const api: Record<string, unknown> = {};
  const self = () => api;
  api.select = self;
  api.eq = self;
  api.maybeSingle = vi.fn(async () => ({ data }));
  return api;
}

describe("validar imóvel no Superlógica", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.gravar.mockResolvedValue("gravado");
    mocks.tabela.mockReturnValue(cadeia({
      superlogica_imovel_id: null,
      logradouro: "Rua Exemplo",
      numero: "100",
    }));
  });

  it("um candidato grava o id e preenche o locador com origem Superlógica", async () => {
    const ler = vi.fn(async (input: { superlogicaImovelId?: number | null; busca?: string | null }) => {
      if (input.superlogicaImovelId === 77) {
        return {
          status: "ok" as const,
          idImovel: 77,
          aluguelCentavos: 200_000,
          proprietario: {
            nome: "Maria Locadora",
            cpfCnpj: "52998224725",
            idPessoa: "9",
            email: null,
            telefone: "11987654321",
          },
        };
      }
      return {
        status: "candidatos" as const,
        candidatos: [{ id_imovel: 77, codigo: "A-1", endereco: "Rua Exemplo, 100", cep: "01310-100" }],
        haMais: false,
      };
    });
    const r = await validarImovelNoSuperlogica({
      admin: { from: vi.fn() } as never,
      orgId: ORG,
      contactId: CONTATO,
      settings: { locacao: { pacote_superlogica_habilitado: true } },
      ficha: fichaComEndereco(),
      imovelId: IMOVEL,
      leitor: { ler },
    });
    expect(ler).toHaveBeenCalledTimes(2);
    expect(r.status).toBe("ok");
    expect(r.superlogicaImovelId).toBe(77);
    expect(r.idGravado).toBe(true);
    expect(r.ficha?.locador.nome).toMatchObject({ valor: "Maria Locadora", fonte: "superlogica" });
    expect(r.locador?.documento_mascarado).toBe("***.***.**7-25");
    expect(mocks.gravar).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: ORG, imovelId: IMOVEL, superlogicaImovelId: 77 }),
    );
    expect(JSON.stringify(mocks.gravar.mock.calls)).not.toMatch(/52998224725|11987654321|Maria/);
  });

  it("vários candidatos devolvem a lista sem gravar id nem locador", async () => {
    const ler = vi.fn(async () => ({
      status: "candidatos" as const,
      aviso: "Vários imóveis na Superlógica batem com este endereço. Escolha um na aba Dados.",
      candidatos: [
        { id_imovel: 11, codigo: "A-1", endereco: "Rua Um, 10", cep: "01310-100" },
        { id_imovel: 12, codigo: "A-2", endereco: "Rua Dois, 20", cep: "01311-100" },
      ],
      haMais: false,
    }));
    const r = await validarImovelNoSuperlogica({
      admin: { from: vi.fn() } as never,
      orgId: ORG,
      contactId: CONTATO,
      settings: { locacao: { pacote_superlogica_habilitado: true } },
      ficha: fichaComEndereco(),
      imovelId: IMOVEL,
      leitor: { ler },
    });
    expect(r.status).toBe("candidatos");
    expect(r.candidatos).toHaveLength(2);
    expect(r.ficha?.locador.nome.valor).toBeNull();
    expect(r.idGravado).toBe(false);
    expect(mocks.gravar).not.toHaveBeenCalled();
  });

  it("não encontrado avisa em português e não inventa locador", async () => {
    const r = await validarImovelNoSuperlogica({
      admin: { from: vi.fn() } as never,
      orgId: ORG,
      contactId: CONTATO,
      settings: { locacao: { pacote_superlogica_habilitado: true } },
      ficha: fichaComEndereco(),
      leitor: {
        ler: async () => ({
          status: "nao_encontrado",
          aviso: "Nenhum imóvel encontrado na Superlógica com este endereço ou código.",
        }),
      },
    });
    expect(r.status).toBe("nao_encontrado");
    expect(r.aviso).toMatch(/Nenhum imóvel encontrado/);
    expect(r.locador).toBeNull();
    expect(mocks.gravar).not.toHaveBeenCalled();
  });

  it("Hub fora (404/indisponível) degrada com aviso claro", async () => {
    const r = await validarImovelNoSuperlogica({
      admin: { from: vi.fn() } as never,
      orgId: ORG,
      contactId: CONTATO,
      settings: { locacao: { pacote_superlogica_habilitado: true } },
      ficha: fichaComEndereco(),
      leitor: { ler: async () => { throw new Error("hub down"); } },
    });
    expect(r.status).toBe("indisponivel");
    expect(r.aviso).toBe(AVISO_HUB_INDISPONIVEL);
    expect(r.locador).toBeNull();
  });

  it("chave desligada não chama o Hub", async () => {
    const ler = vi.fn();
    const r = await validarImovelNoSuperlogica({
      admin: { from: vi.fn() } as never,
      orgId: ORG,
      contactId: CONTATO,
      settings: {},
      ficha: fichaComEndereco(),
      leitor: { ler },
    });
    expect(r.status).toBe("chave_desligada");
    expect(r.aviso).toBe(AVISO_CHAVE_DESLIGADA);
    expect(ler).not.toHaveBeenCalled();
  });
});
