import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TETO_CANDIDATOS,
  buscarPessoasNoHub,
  candidatosDaResposta,
  definirClienteBuscaSuperlogicaParaTeste,
  interpretarBuscaSuperlogica,
  mascararNomeParcial,
  pesquisaDoPedido,
  tipoParaVinculo,
} from "@/lib/locacao/busca-superlogica";

afterEach(() => {
  definirClienteBuscaSuperlogicaParaTeste(null);
});

describe("mascararNomeParcial", () => {
  it("mostra só o começo de cada palavra", () => {
    expect(mascararNomeParcial("Maria da Silva")).toBe("Ma*** da Si***");
    expect(mascararNomeParcial("João")).toBe("Jo**");
  });
});

describe("tipoParaVinculo", () => {
  it("aceita os tipos acentuados do Hub", () => {
    expect(tipoParaVinculo("locatário")).toBe("locatario");
    expect(tipoParaVinculo("proprietário")).toBe("proprietario");
    expect(tipoParaVinculo("fiador")).toBe("fiador");
    expect(tipoParaVinculo("outro")).toBeUndefined();
  });
});

describe("pesquisaDoPedido", () => {
  it("manda um único campo pesquisa (nome ou CPF) e não mistura", () => {
    expect(pesquisaDoPedido({ pesquisa: "Maria Souza" })).toBe("Maria Souza");
    expect(pesquisaDoPedido({ cpf: "529.982.247-25" })).toBe("52998224725");
    expect(pesquisaDoPedido({ nome: "Ana" })).toBe("Ana");
  });
});

describe("interpretarBuscaSuperlogica", () => {
  const candidato = {
    id: "1001",
    nome: "Ana Souza",
    tipo: "locatário",
    contrato: "358",
    imovel: "Rua das Flores 10",
  };

  it("lê até 5 candidatos fictícios no formato do Hub", () => {
    const dados = {
      resultado: "ok",
      encontrado: true,
      status: "ok",
      candidatos: [
        candidato,
        { id: 1002, nome: "Bruno Lima", tipo: "proprietário", imovel: "Av. Central 20", contrato: "12" },
        { id: "abc", nome: "Sem id" },
        { id: "1003", nome: "Carla Nunes", tipo: "fiador", contrato: "12", imovel: "Praça 1" },
        { id: "1004", nome: "Diego Alves", tipo: "locatário", imovel: "Praça 3", contrato: "4" },
        { id: "1005", nome: "Elisa Costa", tipo: "locatário", imovel: "Rua 5", contrato: "5" },
        { id: "1006", nome: "Fora do teto", tipo: "locatário", contrato: "6", imovel: "Rua 6" },
      ],
      ha_mais: true,
    };
    const r = interpretarBuscaSuperlogica(dados);
    expect(r.encontrado).toBe(true);
    expect(r.haMais).toBe(true);
    expect(r.candidatos).toHaveLength(TETO_CANDIDATOS);
    expect(r.candidatos.map((c) => c.id)).toEqual(["1001", "1002", "1003", "1004", "1005"]);
    expect(r.candidatos[0]?.tipo).toBe("locatário");
  });

  it("sem match devolve nao_encontrado e lista vazia", () => {
    expect(interpretarBuscaSuperlogica({
      resultado: "nao_encontrado",
      encontrado: false,
      status: "nao_encontrado",
      candidatos: [],
      ha_mais: false,
    })).toEqual({
      candidatos: [],
      status: "nao_encontrado",
      encontrado: false,
      haMais: false,
    });
  });

  it("encontrado:false ignora candidatos que o Hub tenha mandado por engano", () => {
    const r = interpretarBuscaSuperlogica({
      resultado: "ok",
      encontrado: false,
      status: "ok",
      candidatos: [candidato],
    });
    expect(r.candidatos).toEqual([]);
    expect(r.encontrado).toBe(false);
  });
});

describe("candidatosDaResposta", () => {
  it("é a lista da interpretação", () => {
    expect(candidatosDaResposta({
      encontrado: true,
      status: "ok",
      candidatos: [{ id: "9", nome: "Lia", tipo: "fiador", contrato: "1", imovel: "Rua 1" }],
    })).toHaveLength(1);
  });
});

describe("cliente injetável", () => {
  it("a busca usa o mock com {pesquisa} e não grava CPF", async () => {
    const visto: unknown[] = [];
    definirClienteBuscaSuperlogicaParaTeste({
      buscar: async (pedido) => {
        visto.push({ pesquisa: pedido.pesquisa, chaves: Object.keys(pedido) });
        return {
          status: "ok",
          encontrado: true,
          haMais: false,
          candidatos: [{
            id: "42", nome: "Maria Souza", tipo: "locatário",
            imovel: "Rua Fictícia 1", contrato: "9",
          }],
        };
      },
    });
    const r = await buscarPessoasNoHub({} as never, {
      orgId: "org",
      conversationId: "conv",
      contactId: "contato",
      pedido: { pesquisa: "52998224725" },
    });
    expect(r.candidatos).toHaveLength(1);
    expect(r.candidatos[0]?.id).toBe("42");
    expect(visto).toEqual([{ pesquisa: "52998224725", chaves: ["pesquisa"] }]);
    expect(JSON.stringify(visto)).not.toContain("cpf");
  });
});

describe("Hub recusa ferramenta que não é só leitura", () => {
  it("não chama tools/call se a ferramenta anunciada não for somenteLeitura", async () => {
    const chamar = vi.fn();
    vi.resetModules();
    vi.doMock("@/lib/mcp/servidor-externo/carregar", () => ({
      carregarServidorMcpExterno: async () => ({
        servidor: { endpoint: "https://hub.exemplo/mcp", chave: "x" },
        ferramentas: [{ name: "buscar_pessoas_superlogica", somenteLeitura: false }],
        cabecalhos: {},
      }),
    }));
    vi.doMock("@/lib/mcp/servidor-externo/chamada", () => ({
      chamarFerramentaRemota: chamar,
    }));
    const { buscarPessoasNoHub: buscar, definirClienteBuscaSuperlogicaParaTeste: definir } =
      await import("@/lib/locacao/busca-superlogica");
    definir(null);
    await expect(buscar({} as never, {
      orgId: "org", conversationId: "conv", contactId: "c",
      pedido: { pesquisa: "Maria" },
    })).rejects.toMatchObject({ codigo: "tool_unavailable" });
    expect(chamar).not.toHaveBeenCalled();
    vi.resetModules();
    vi.doUnmock("@/lib/mcp/servidor-externo/carregar");
    vi.doUnmock("@/lib/mcp/servidor-externo/chamada");
  });
});
