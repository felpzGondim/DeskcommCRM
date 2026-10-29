import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  carregar: vi.fn(),
  chamar: vi.fn(),
  processo: vi.fn(),
  listar: vi.fn(),
  ficha: vi.fn(),
  andamento: vi.fn(),
  abrir: vi.fn(),
  ler: vi.fn(),
  marcar: vi.fn(),
  print: vi.fn(),
  recente: vi.fn(),
}));

vi.mock("@/lib/mcp/servidor-externo/carregar", () => ({
  carregarServidorMcpExterno: (...args: unknown[]) => mocks.carregar(...args),
}));
vi.mock("@/lib/mcp/servidor-externo/chamada", () => ({
  chamarFerramentaRemota: (...args: unknown[]) => mocks.chamar(...args),
}));
vi.mock("@/lib/locacao/repositorio", () => ({
  LocacaoErro: class LocacaoErro extends Error {
    constructor(readonly codigo: string, message: string) {
      super(message);
    }
  },
  lerProcesso: (...args: unknown[]) => mocks.processo(...args),
  listarProcessosDaConversa: (...args: unknown[]) => mocks.listar(...args),
  lerFichaAtualDoProcesso: (...args: unknown[]) => mocks.ficha(...args),
  lerAnaliseSeguroEmAndamento: (...args: unknown[]) => mocks.andamento(...args),
  abrirAnaliseSeguro: (...args: unknown[]) => mocks.abrir(...args),
  lerAnaliseSeguro: (...args: unknown[]) => mocks.ler(...args),
  marcarEstadoAnaliseSeguro: (...args: unknown[]) => mocks.marcar(...args),
  guardarPrintMigra: (...args: unknown[]) => mocks.print(...args),
  lerAnaliseSeguroMaisRecente: (...args: unknown[]) => mocks.recente(...args),
}));

import { fichaVazia } from "@/lib/locacao/ficha-schema";
import { analisarSeguroDoPainel, statusSeguroDoPainel } from "@/lib/painel/acoes/seguro";
import {
  LISTA_FECHADA_HUB_ANALISE,
  iniciarAnaliseComAcao,
  TEXTO_FERRAMENTA_HUB_AUSENTE,
} from "@/lib/painel/acoes/hub";
import type { ContextoDaFerramenta } from "@/lib/painel/ferramentas/tipos";

const PEDIDO = "00000000-0000-4000-8000-000000000099";

function ferramentaIniciar(comAcao = true) {
  return {
    name: "iniciar_analise_inquilino",
    inputSchema: {
      properties: {
        pedido_id: {},
        conversa_id: {},
        candidato: {},
        imovel: {},
        renda: {},
        ...(comAcao ? { acao: { enum: ["seguro", "fc_salvar"] } } : {}),
      },
    },
  };
}

function hubOk() {
  return {
    servidor: { endpoint: "https://hub.exemplo/mcp", chave: "x" },
    cabecalhos: {},
    ferramentas: [
      ferramentaIniciar(true),
      { name: "status_analise_inquilino", inputSchema: { properties: { pedido_id: {} } } },
      {
        name: "baixar_resultado_analise",
        inputSchema: { properties: { pedido_id: {}, tipo: { enum: ["print_migra", "laudo"] } } },
      },
    ],
  };
}

function fichaPronta() {
  const f = fichaVazia();
  f.pessoas[0]!.nome.valor = "Inquilino Teste";
  f.pessoas[0]!.cpf.valor = "52998224725";
  f.pessoas[0]!.email.valor = "inquilino@exemplo.com";
  f.pessoas[0]!.celular.valor = "11987654321";
  f.imovel.logradouro.valor = "Rua das Flores";
  f.imovel.numero.valor = "100";
  f.imovel.aluguel.valor = 2500;
  f.renda.mensal.valor = 8000;
  f.renda.proposta_fc.valor = 7500;
  return f;
}

const ctx: ContextoDaFerramenta = {
  orgId: "org-1",
  conversationId: "conv-1",
  contactId: "c1",
  userId: "u1",
  requestId: "r1",
  dbSessao: {} as never,
  admin: {} as never,
  settings: { locacao: { processos_habilitado: true, analise: { seguro: true } } },
  idioma: "pt-BR",
  origem: "botao",
};

describe("analisar seguro no painel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.processo.mockResolvedValue({
      id: "proc-1",
      renda_confirmada_em: "2026-10-28T12:00:00Z",
    });
    mocks.listar.mockResolvedValue([{ id: "proc-1" }]);
    mocks.andamento.mockResolvedValue(null);
    mocks.ficha.mockResolvedValue({ ficha: fichaPronta(), versao: 2 });
    mocks.abrir.mockResolvedValue({ pedidoId: PEDIDO, reusou: false });
    mocks.marcar.mockResolvedValue(undefined);
    mocks.ler.mockResolvedValue({
      pedido_id: PEDIDO,
      processo_id: "proc-1",
      estado: "cotando",
      resultado: { cards: [] },
    });
    mocks.carregar.mockResolvedValue(hubOk());
    mocks.chamar.mockImplementation(async (_servidor: unknown, nome: string) => {
      if (nome === "iniciar_analise_inquilino") {
        return { texto: "", dados: { resultado: "aceito", job_id: "job-1" } };
      }
      if (nome === "status_analise_inquilino") {
        return {
          texto: "",
          dados: { estado: "cotando", cards: [{ seguradora: "X" }], score: 900, risco: "alto" },
        };
      }
      return { texto: "", dados: {} };
    });
  });

  it("lista fechada: iniciar sem campo acao não dispara o caminho antigo", () => {
    expect(iniciarAnaliseComAcao([ferramentaIniciar(false)])).toBeNull();
    expect(iniciarAnaliseComAcao([ferramentaIniciar(true)])?.name).toBe("iniciar_analise_inquilino");
    expect(LISTA_FECHADA_HUB_ANALISE).toContain("status_analise_inquilino");
    expect(LISTA_FECHADA_HUB_ANALISE).toContain("baixar_resultado_analise");
  });

  it("Hub sem as ferramentas novas: mensagem clara, sem INSERT", async () => {
    mocks.carregar.mockResolvedValue({ servidor: {}, cabecalhos: {}, ferramentas: [] });
    const r = await analisarSeguroDoPainel(ctx, { processo_id: "proc-1" });
    expect(r.ok).toBe(false);
    expect(r.texto).toBe(TEXTO_FERRAMENTA_HUB_AUSENTE);
    expect(mocks.abrir).not.toHaveBeenCalled();
    expect(mocks.chamar).not.toHaveBeenCalled();
  });

  it("iniciar antigo (sem acao) não é chamado", async () => {
    mocks.carregar.mockResolvedValue({
      servidor: {},
      cabecalhos: {},
      ferramentas: [ferramentaIniciar(false)],
    });
    const r = await analisarSeguroDoPainel(ctx, { processo_id: "proc-1" });
    expect(r.ok).toBe(false);
    expect(r.texto).toMatch(/ainda não separa/);
    expect(mocks.abrir).not.toHaveBeenCalled();
  });

  it("dispara acao seguro com pedido_id próprio e não persiste score/risco", async () => {
    const r = await analisarSeguroDoPainel(ctx, { processo_id: "proc-1" });
    expect(r.ok).toBe(true);
    const iniciar = mocks.chamar.mock.calls.find((c) => c[1] === "iniciar_analise_inquilino");
    expect(iniciar?.[2]).toEqual(expect.objectContaining({
      acao: "seguro",
      pedido_id: PEDIDO,
    }));
    expect(iniciar?.[2]).not.toEqual(expect.objectContaining({ acao: "fc_salvar" }));
    expect(JSON.stringify(r.extra ?? {})).not.toMatch(/score|risco|900|alto/);
    expect(mocks.marcar).toHaveBeenCalledWith(
      ctx.admin,
      expect.objectContaining({ resultado: expect.not.objectContaining({ score: 900 }) }),
    );
  });

  it("sem renda confirmada não chama Hub", async () => {
    mocks.processo.mockResolvedValue({ id: "proc-1" });
    const r = await analisarSeguroDoPainel(ctx, { processo_id: "proc-1" });
    expect(r.ok).toBe(false);
    expect(r.texto).toMatch(/Confirme a renda/);
    expect(mocks.carregar).not.toHaveBeenCalled();
  });

  it("chave desligada recusa", async () => {
    const r = await analisarSeguroDoPainel({ ...ctx, settings: {} }, {});
    expect(r.ok).toBe(false);
    expect(r.texto).toMatch(/não está ligada/);
  });

  it("status reusa o pedido em andamento e não baixa laudo", async () => {
    mocks.andamento.mockResolvedValue({ pedido_id: PEDIDO, processo_id: "proc-1", estado: "cotando" });
    mocks.chamar.mockImplementation(async (_s: unknown, nome: string) => {
      if (nome === "baixar_resultado_analise") {
        throw new Error("não deveria baixar laudo");
      }
      if (nome === "iniciar_analise_inquilino") {
        return { texto: "", dados: { resultado: "ja_existia" } };
      }
      return { texto: "", dados: { estado: "cotando", cards: [] } };
    });
    const r = await statusSeguroDoPainel(ctx, { processo_id: "proc-1" });
    expect(r.ok).toBe(true);
    expect(mocks.chamar.mock.calls.some((c) => c[2] && (c[2] as { tipo?: string }).tipo === "laudo")).toBe(false);
  });
});
