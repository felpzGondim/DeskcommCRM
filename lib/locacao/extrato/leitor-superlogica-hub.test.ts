import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import {
  AVISO_PACOTE_SUPERLOGICA_INDISPONIVEL,
  CAMINHO_PACOTE_HUB,
  NOME_FERRAMENTA_PACOTE_SUPERLOGICA,
  criarLeitorPacoteViaHub,
  interpretarPacoteHub,
  numeroImovelSuperlogica,
  resolverIdsDoPacote,
  urlDoPacoteHub,
} from "./leitor-superlogica-hub";
import { montarPacote } from "./pacote";

const ORG = "00000000-0000-4000-8000-000000000033";
const CONTATO = "00000000-0000-4000-8000-000000000044";

describe("contrato do pacote no Hub", () => {
  it("a rota do Hub nasce do /mcp e só aceita ids numéricos ou busca", () => {
    const url = urlDoPacoteHub("https://hub.exemplo/mcp", {
      idImovel: 77,
      idPessoa: "1001",
      busca: "Rua Exemplo, 100",
    });
    expect(url.pathname).toBe(CAMINHO_PACOTE_HUB);
    expect(url.searchParams.get("id_imovel")).toBe("77");
    expect(url.searchParams.get("id_pessoa")).toBe("1001");
    expect(url.searchParams.get("busca")).toBe("Rua Exemplo, 100");
    expect(url.search).not.toMatch(/token|chave|secret|cpf|telefone/i);
  });

  it("recusa endpoint MCP sem /mcp", () => {
    expect(() => urlDoPacoteHub("https://hub.exemplo/outra", { idImovel: 1 })).toThrow(
      "hub_endpoint_invalid",
    );
  });

  it("o arquivo só manda GET ao Hub e ignora seguro-fiança", () => {
    const src = readFileSync("lib/locacao/extrato/leitor-superlogica-hub.ts", "utf8");
    expect(src).toContain('method: "GET"');
    expect(src).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)["']/);
    expect(src).toContain(NOME_FERRAMENTA_PACOTE_SUPERLOGICA);
    expect(src).not.toMatch(/seguro_fianca|seguroFianca/);
    expect(src).not.toMatch(/console\.log/);
  });
});

describe("interpretarPacoteHub", () => {
  it("lê centavos do contrato e descarta fiança se vier", () => {
    const lido = interpretarPacoteHub({
      resultado: "ok",
      encontrado: true,
      status: "ok",
      pacote: {
        aluguel_centavos: 200_000,
        condominio_centavos: 50_000,
        iptu_centavos: 12_000,
        seguro_incendio_centavos: 8_000,
        seguro_fianca_centavos: 90_000,
      },
    });
    expect(lido).toEqual({
      status: "ok",
      aluguelCentavos: 200_000,
      condominioCentavos: 50_000,
      iptuCentavos: 12_000,
      seguroIncendioCentavos: 8_000,
    });
    expect(lido).not.toHaveProperty("aviso");
    const p = montarPacote({ superlogica: lido, conversa: { aluguelCentavos: 1 } });
    expect(p.aluguel).toEqual({ valorCentavos: 1, origem: "conversa" });
    expect(p.divergencias.map((d) => d.campo)).toContain("aluguel");
    const soSuperlogica = montarPacote({ superlogica: lido, conversa: {} });
    expect(soSuperlogica.aluguel).toEqual({ valorCentavos: 200_000, origem: "superlogica" });
    expect(soSuperlogica.vezes3Centavos).toBe(3 * 270_000);
  });

  it("lê endereço e CEP opcionais só para confronto", () => {
    const lido = interpretarPacoteHub({
      status: "ok",
      encontrado: true,
      pacote: {
        aluguel_centavos: 200_000,
        endereco: "Rua Exemplo, 100",
        cep: "01310-100",
        seguro_fianca_centavos: 90_000,
      },
    });
    expect(lido.endereco).toBe("Rua Exemplo, 100");
    expect(lido.cep).toBe("01310-100");
    expect(JSON.stringify(lido)).not.toMatch(/fianca/i);
  });

  it("aceita reais no fallback e marca origem Superlógica no pacote", () => {
    const lido = interpretarPacoteHub({
      status: "ok",
      encontrado: true,
      pacote: { aluguel: 2100, condominio: 350.5 },
    });
    expect(lido.aluguelCentavos).toBe(210_000);
    expect(lido.condominioCentavos).toBe(35_050);
  });

  it("lê o proprietário no ok sem exigir os quatro valores", () => {
    const lido = interpretarPacoteHub({
      status: "ok",
      pacote: { id_imovel: 77, endereco: "Rua Exemplo, 100", cep: "01310-100" },
      proprietario: {
        nome: "Maria Locadora",
        cpf_cnpj: "52998224725",
        id_pessoa: "9",
        contato: { email: "maria@exemplo.test", telefone: "11987654321" },
      },
    });
    expect(lido.status).toBe("ok");
    expect(lido.idImovel).toBe(77);
    expect(lido.proprietario).toEqual({
      nome: "Maria Locadora",
      cpfCnpj: "52998224725",
      idPessoa: "9",
      email: "maria@exemplo.test",
      telefone: "11987654321",
    });
  });

  it("vários candidatos não trazem PII e pedem escolha", () => {
    const lido = interpretarPacoteHub({
      status: "candidatos",
      candidatos: [
        { id_imovel: 11, codigo: "A-1", endereco: "Rua Um, 10", cep: "01310-100" },
        { id_imovel: 12, codigo: "A-2", endereco: "Rua Dois, 20", cep: "01311-100" },
      ],
      ha_mais: true,
    });
    expect(lido.status).toBe("candidatos");
    expect(lido.candidatos).toHaveLength(2);
    expect(lido.haMais).toBe(true);
    expect(lido.aviso).toMatch(/Escolha um/);
    expect(JSON.stringify(lido)).not.toMatch(/cpf|telefone|email|nome/i);
  });

  it("indisponível ou payload inválido vira aviso, sem inventar valor", () => {
    expect(interpretarPacoteHub(null)).toEqual({
      status: "indisponivel",
      aviso: AVISO_PACOTE_SUPERLOGICA_INDISPONIVEL,
    });
    expect(interpretarPacoteHub({ status: "indisponivel" })).toEqual({
      status: "indisponivel",
      aviso: AVISO_PACOTE_SUPERLOGICA_INDISPONIVEL,
    });
    expect(interpretarPacoteHub({ encontrado: false, status: "nao_encontrado" })).toMatchObject({
      status: "nao_encontrado",
    });
    expect(interpretarPacoteHub({ encontrado: false, status: "nao_encontrado" }).aviso).toMatch(
      /Nenhum imóvel encontrado/,
    );
    const p = montarPacote({
      superlogica: interpretarPacoteHub({ status: "indisponivel" }),
      conversa: { aluguelCentavos: 180_000 },
    });
    expect(p.aluguel).toEqual({ valorCentavos: 180_000, origem: "conversa" });
  });
});

describe("numeroImovelSuperlogica", () => {
  it("só aceita id numérico positivo", () => {
    expect(numeroImovelSuperlogica(77)).toBe(77);
    expect(numeroImovelSuperlogica("77")).toBe(77);
    expect(numeroImovelSuperlogica("abc")).toBeNull();
    expect(numeroImovelSuperlogica(0)).toBeNull();
  });
});

describe("resolverIdsDoPacote", () => {
  it("lê o id da pessoa no vínculo ativo, sem custom_fields quando já há linha", async () => {
    const from = vi.fn((tabela: string) => {
      const api: Record<string, unknown> = {};
      const self = () => api;
      api.select = self;
      api.eq = self;
      api.maybeSingle = vi.fn(async () =>
        tabela === "contato_superlogica_vinculos"
          ? { data: { superlogica_pessoa_id: "1001", tipos: ["locatario"] } }
          : { data: null },
      );
      return api;
    });
    const ids = await resolverIdsDoPacote({ from } as never, {
      orgId: ORG,
      contactId: CONTATO,
      superlogicaImovelId: 77,
    });
    expect(ids).toEqual({ idImovel: 77, idPessoa: "1001", busca: null });
    expect(from).not.toHaveBeenCalledWith("contacts");
  });

  it("cai no custom_fields superlogica_* quando o vínculo tabular está vazio", async () => {
    const from = vi.fn((tabela: string) => {
      const api: Record<string, unknown> = {};
      const self = () => api;
      api.select = self;
      api.eq = self;
      api.maybeSingle = vi.fn(async () =>
        tabela === "contacts"
          ? { data: { custom_fields: { superlogica_id_pessoa: "2002" } } }
          : { data: null },
      );
      return api;
    });
    const ids = await resolverIdsDoPacote({ from } as never, {
      orgId: ORG,
      contactId: CONTATO,
    });
    expect(ids.idPessoa).toBe("2002");
    expect(ids.idImovel).toBeNull();
  });
});

function adminSemLinhas() {
  return {
    from: vi.fn(() => {
      const api: Record<string, unknown> = {};
      const self = () => api;
      api.select = self;
      api.eq = self;
      api.maybeSingle = vi.fn(async () => ({ data: null }));
      return api;
    }),
  };
}

describe("criarLeitorPacoteViaHub", () => {
  it("cliente mockado devolve valores; falha vira aviso e não lança", async () => {
    const admin = adminSemLinhas();
    const ok = criarLeitorPacoteViaHub({
      admin: admin as never,
      cliente: {
        get: async () => ({
          status: "ok",
          encontrado: true,
          pacote: { aluguel_centavos: 300_000, iptu_centavos: 15_000 },
        }),
      },
    });
    const lido = await ok.ler({
      orgId: ORG,
      contactId: CONTATO,
      superlogicaImovelId: 77,
    });
    expect(lido).toEqual({ status: "ok", aluguelCentavos: 300_000, iptuCentavos: 15_000 });

    const falha = criarLeitorPacoteViaHub({
      admin: adminSemLinhas() as never,
      cliente: { get: async () => { throw new Error("hub down"); } },
    });
    await expect(falha.ler({
      orgId: ORG,
      contactId: CONTATO,
      superlogicaImovelId: 77,
    })).resolves.toEqual({
      status: "indisponivel",
      aviso: AVISO_PACOTE_SUPERLOGICA_INDISPONIVEL,
    });
  });

  it("sem id, sem pessoa e sem busca não chama o Hub", async () => {
    const get = vi.fn();
    const from = vi.fn(() => {
      const api: Record<string, unknown> = {};
      const self = () => api;
      api.select = self;
      api.eq = self;
      api.maybeSingle = vi.fn(async () => ({ data: null }));
      return api;
    });
    const leitor = criarLeitorPacoteViaHub({
      admin: { from } as never,
      cliente: { get },
    });
    await expect(leitor.ler({ orgId: ORG, contactId: CONTATO })).resolves.toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it("com busca e sem id chama o Hub", async () => {
    const get = vi.fn(async (pedido: { busca?: string | null }) => {
      expect(pedido.busca).toBe("Rua Exemplo, 100");
      return { status: "nao_encontrado" };
    });
    const leitor = criarLeitorPacoteViaHub({
      admin: adminSemLinhas() as never,
      cliente: { get },
    });
    const lido = await leitor.ler({
      orgId: ORG,
      contactId: CONTATO,
      busca: "Rua Exemplo, 100",
    });
    expect(get).toHaveBeenCalled();
    expect(lido?.status).toBe("nao_encontrado");
  });
});
