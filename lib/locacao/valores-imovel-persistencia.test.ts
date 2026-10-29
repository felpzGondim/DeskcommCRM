import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  lerProcesso: vi.fn(),
  listarParticipantes: vi.fn(),
  lerFichaAtualDoProcesso: vi.fn(),
  gravarEvento: vi.fn(),
  lerFichaAtual: vi.fn(),
  tabela: vi.fn(),
  adminFrom: vi.fn(),
}));

vi.mock("@/lib/locacao/repositorio", () => ({
  LocacaoErro: class LocacaoErro extends Error {
    constructor(readonly codigo: string, message: string) {
      super(message);
    }
  },
  lerProcesso: (...args: unknown[]) => mocks.lerProcesso(...args),
  listarParticipantes: (...args: unknown[]) => mocks.listarParticipantes(...args),
  lerFichaAtualDoProcesso: (...args: unknown[]) => mocks.lerFichaAtualDoProcesso(...args),
  gravarEvento: (...args: unknown[]) => mocks.gravarEvento(...args),
}));
vi.mock("@/lib/locacao/ficha-repositorio", () => ({
  lerFichaAtual: (...args: unknown[]) => mocks.lerFichaAtual(...args),
}));
vi.mock("@/lib/locacao/admin", () => ({
  tabelaLocacao: (...args: unknown[]) => mocks.tabela(...args),
}));

import { fichaVazia } from "@/lib/locacao/ficha-schema";
import {
  editarValoresDoProcesso,
  garantirValoresDoProcesso,
} from "@/lib/locacao/valores-imovel-persistencia";

const IMOVEL = "00000000-0000-4000-8000-000000000011";
const PROCESSO = "00000000-0000-4000-8000-000000000022";
const ORG = "00000000-0000-4000-8000-000000000033";
const USER = "00000000-0000-4000-8000-000000000044";

function fichaComValores() {
  const f = fichaVazia();
  f.imovel.aluguel.valor = 2100;
  f.imovel.condominio.valor = 350;
  f.imovel.iptu.valor = 120;
  return f;
}

function cadeia(resposta: { data: unknown } = { data: null }) {
  const api: Record<string, unknown> = {};
  const self = () => api;
  api.select = self;
  api.eq = self;
  api.order = self;
  api.limit = self;
  api.update = vi.fn(() => api);
  api.maybeSingle = vi.fn(async () => resposta);
  return api;
}

describe("persistência dos valores do imóvel", () => {
  const updates: Array<{ patch: Record<string, unknown>; cadeia: Record<string, unknown> }> = [];
  const admin = { from: (...args: unknown[]) => mocks.adminFrom(...args) };

  beforeEach(() => {
    vi.clearAllMocks();
    updates.length = 0;
    mocks.listarParticipantes.mockResolvedValue([]);
    mocks.lerFichaAtual.mockResolvedValue(null);
    mocks.gravarEvento.mockResolvedValue(undefined);
    mocks.adminFrom.mockReturnValue(cadeia());
    mocks.tabela.mockImplementation((_admin: unknown, nome: string) => {
      const api = cadeia(
        nome === "locacao_imoveis" ? { data: { id: IMOVEL, superlogica_imovel_id: null } } : { data: null },
      );
      api.update = vi.fn((patch: Record<string, unknown>) => {
        updates.push({ patch, cadeia: api });
        return api;
      });
      return api;
    });
    mocks.lerProcesso.mockResolvedValue({
      id: PROCESSO,
      imovel_id: IMOVEL,
      aluguel: null,
      condominio: null,
      iptu: null,
      seguro_incendio: null,
      seguro_fianca: null,
    });
    mocks.lerFichaAtualDoProcesso.mockResolvedValue({
      versao: 1,
      origem: "preliminar_ia",
      ficha: fichaComValores(),
      campos_alterados: [],
    });
  });

  it("chave Superlógica desligada: não chama o leitor e preenche pela conversa", async () => {
    const leitor = { ler: vi.fn(async () => ({ aluguelCentavos: 999_00 })) };
    const valores = await garantirValoresDoProcesso(admin as never, {
      orgId: ORG,
      processoId: PROCESSO,
      settings: { locacao: { processos_habilitado: true } },
      leitor,
    });
    expect(leitor.ler).not.toHaveBeenCalled();
    expect(valores.aluguel).toMatchObject({ valor: 2100, origem: "conversa" });
    expect(valores.condominio).toMatchObject({ valor: 350, origem: "conversa" });
    expect(updates[0]?.patch).toMatchObject({ aluguel: 2100, aluguel_origem: "conversa" });
    expect(mocks.gravarEvento).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        tipo: "valores_imovel",
        atorTipo: "sistema",
        detalhe: expect.objectContaining({ campos: expect.arrayContaining(["aluguel"]) }),
      }),
    );
    expect(JSON.stringify(mocks.gravarEvento.mock.calls)).not.toMatch(/2100|350/);
  });

  it("chave Superlógica ligada sem vínculo: pula o leitor", async () => {
    const leitor = { ler: vi.fn(async () => ({ aluguelCentavos: 300_000 })) };
    await garantirValoresDoProcesso(admin as never, {
      orgId: ORG,
      processoId: PROCESSO,
      settings: { locacao: { pacote_superlogica_habilitado: true } },
      leitor,
    });
    expect(leitor.ler).not.toHaveBeenCalled();
  });

  it("chave ligada com vínculo GET: Superlógica vence a conversa", async () => {
    mocks.tabela.mockImplementation((_admin: unknown, nome: string) => {
      const data = nome === "locacao_imoveis"
        ? { id: IMOVEL, superlogica_imovel_id: 77 }
        : null;
      const api = cadeia({ data });
      api.update = vi.fn((patch: Record<string, unknown>) => {
        updates.push({ patch, cadeia: api });
        return api;
      });
      return api;
    });
    const leitor = {
      ler: vi.fn(async () => ({
        aluguelCentavos: 300_000,
        condominioCentavos: 40_000,
        iptuCentavos: 18_000,
        seguroIncendioCentavos: 8_000,
      })),
    };
    const valores = await garantirValoresDoProcesso(admin as never, {
      orgId: ORG,
      processoId: PROCESSO,
      settings: { locacao: { pacote_superlogica_habilitado: true } },
      leitor,
    });
    expect(leitor.ler).toHaveBeenCalledWith(expect.objectContaining({
      orgId: ORG,
      superlogicaImovelId: 77,
    }));
    expect(valores.aluguel).toMatchObject({ valor: 3000, origem: "superlogica" });
    expect(valores.condominio).toMatchObject({ valor: 400, origem: "superlogica" });
  });

  it("origem manual não é sobrescrita no pré-preenchimento", async () => {
    mocks.lerProcesso.mockResolvedValue({
      id: PROCESSO,
      imovel_id: IMOVEL,
      aluguel: 1999,
      aluguel_origem: "manual",
      aluguel_editado_por: USER,
    });
    const valores = await garantirValoresDoProcesso(admin as never, {
      orgId: ORG,
      processoId: PROCESSO,
      settings: {},
    });
    expect(valores.aluguel).toMatchObject({ valor: 1999, origem: "manual", editado_por: USER });
    expect(updates[0]?.patch.aluguel).toBeUndefined();
  });

  it("edição humana grava origem manual e audita só nomes de campo", async () => {
    const valores = await editarValoresDoProcesso(admin as never, {
      orgId: ORG,
      processoId: PROCESSO,
      userId: USER,
      patch: { condominio: 450 },
    });
    expect(valores.condominio).toMatchObject({ valor: 450, origem: "manual", editado_por: USER });
    expect(updates[0]?.patch).toMatchObject({
      condominio: 450,
      condominio_origem: "manual",
      condominio_editado_por: USER,
    });
    expect(mocks.gravarEvento).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        tipo: "valores_imovel",
        atorTipo: "usuario",
        atorId: USER,
        detalhe: { campos: ["condominio"] },
      }),
    );
  });
});
