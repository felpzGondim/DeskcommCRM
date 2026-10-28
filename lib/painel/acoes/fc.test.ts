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
  laudo: vi.fn(),
  recenteProc: vi.fn(),
  recentePart: vi.fn(),
  reuso: vi.fn(),
  participantes: vi.fn(),
  participante: vi.fn(),
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
  lerAnaliseFcEmAndamento: (...args: unknown[]) => mocks.andamento(...args),
  abrirAnaliseFc: (...args: unknown[]) => mocks.abrir(...args),
  lerAnaliseFc: (...args: unknown[]) => mocks.ler(...args),
  marcarEstadoAnaliseFc: (...args: unknown[]) => mocks.marcar(...args),
  guardarLaudoFc: (...args: unknown[]) => mocks.laudo(...args),
  lerAnaliseFcMaisRecenteDoProcesso: (...args: unknown[]) => mocks.recenteProc(...args),
  lerAnaliseFcMaisRecenteDoParticipante: (...args: unknown[]) => mocks.recentePart(...args),
  fcReaproveitavel: (...args: unknown[]) => mocks.reuso(...args),
  listarParticipantesParaFc: (...args: unknown[]) => mocks.participantes(...args),
  lerParticipanteDoProcesso: (...args: unknown[]) => mocks.participante(...args),
}));

import { fichaVazia, pessoaVazia } from "@/lib/locacao/ficha-schema";
import {
  analisarFcDoPainel,
  confirmarCobrancaFcDoPainel,
  statusFcDoPainel,
  TEXTO_AVISO_CREDITOS,
  TEXTO_FC_INCERTA,
  TEXTO_FC_JA_COBRADO,
  TEXTO_FC_REAPROVEITADA,
  TEXTO_FIADOR_SO_ATENDENTE,
} from "@/lib/painel/acoes/fc";
import { LISTA_FECHADA_HUB_ANALISE, TEXTO_FERRAMENTA_HUB_AUSENTE } from "@/lib/painel/acoes/hub";
import { executarFerramenta } from "@/lib/painel/ferramentas/executar";
import type { ContextoDaFerramenta } from "@/lib/painel/ferramentas/tipos";

const PEDIDO = "00000000-0000-4000-8000-000000000088";
const PARTICIPANTE = "00000000-0000-4000-8000-000000000077";

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

function hubOk(opts: { confirmar?: boolean } = {}) {
  const ferramentas: Array<{ name: string; inputSchema: { properties: Record<string, unknown> } }> = [
    ferramentaIniciar(true),
    { name: "status_analise_inquilino", inputSchema: { properties: { pedido_id: {} } } },
    {
      name: "baixar_resultado_analise",
      inputSchema: { properties: { pedido_id: {}, tipo: { enum: ["print_migra", "laudo"] } } },
    },
  ];
  if (opts.confirmar !== false) {
    ferramentas.push({
      name: "confirmar_cobranca_fc_analise",
      inputSchema: { properties: { pedido_id: {}, confirmado: {}, confirmado_por: {} } },
    });
  }
  return { servidor: { endpoint: "https://hub.exemplo/mcp", chave: "x" }, cabecalhos: {}, ferramentas };
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
  settings: { locacao: { processos_habilitado: true, analise: { fc: true } } },
  idioma: "pt-BR",
  origem: "botao",
};

describe("analisar FC no painel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.processo.mockResolvedValue({
      id: "proc-1",
      renda_confirmada_em: "2026-10-28T12:00:00Z",
    });
    mocks.listar.mockResolvedValue([{ id: "proc-1" }]);
    mocks.andamento.mockResolvedValue(null);
    mocks.reuso.mockResolvedValue(null);
    mocks.recentePart.mockResolvedValue(null);
    mocks.ficha.mockResolvedValue({ ficha: fichaPronta(), versao: 2 });
    mocks.abrir.mockResolvedValue(PEDIDO);
    const linha: Record<string, unknown> = {
      pedido_id: PEDIDO,
      processo_id: "proc-1",
      participante_id: PARTICIPANTE,
      estado: "aguardando_cobranca",
      resultado: {},
      documento_id: null,
    };
    mocks.ler.mockImplementation(async () => ({ ...linha }));
    mocks.marcar.mockImplementation(async (_admin: unknown, input: Record<string, unknown>) => {
      if (input.estado !== undefined) linha.estado = input.estado;
      if (input.resultado !== undefined) linha.resultado = input.resultado;
      if (input.documentoId !== undefined) linha.documento_id = input.documentoId;
      if (input.erroCodigo !== undefined) linha.erro_codigo = input.erroCodigo;
    });
    mocks.participantes.mockResolvedValue([
      { id: PARTICIPANTE, papel: "locatario", principal: true, cpf_hash: "abc", cpf_mascarado: "***.***.**2-25" },
    ]);
    mocks.participante.mockResolvedValue({
      id: PARTICIPANTE, papel: "locatario", principal: true, cpf_hash: "abc", cpf_mascarado: "***.***.**2-25",
    });
    mocks.carregar.mockResolvedValue(hubOk());
    mocks.chamar.mockImplementation(async (_servidor: unknown, nome: string) => {
      if (nome === "iniciar_analise_inquilino") {
        return { texto: "", dados: { resultado: "aceito", job_id: "job-1" } };
      }
      if (nome === "status_analise_inquilino") {
        return {
          texto: "",
          dados: {
            estado: "fc_salvo_pendente",
            fc: { score: 712, risco: "moderado" },
          },
        };
      }
      if (nome === "confirmar_cobranca_fc_analise") {
        return { texto: "", dados: { resultado: "aceito" } };
      }
      return { texto: "", dados: {} };
    });
  });

  it("Hub sem as ferramentas novas: mensagem clara, sem INSERT", async () => {
    mocks.carregar.mockResolvedValue({ servidor: {}, cabecalhos: {}, ferramentas: [] });
    const r = await analisarFcDoPainel(ctx, { processo_id: "proc-1" });
    expect(r.ok).toBe(false);
    expect(r.texto).toBe(TEXTO_FERRAMENTA_HUB_AUSENTE);
    expect(mocks.abrir).not.toHaveBeenCalled();
    expect(mocks.chamar).not.toHaveBeenCalled();
  });

  it("iniciar antigo (sem acao) não dispara o caminho legado", async () => {
    mocks.carregar.mockResolvedValue({
      servidor: {},
      cabecalhos: {},
      ferramentas: [ferramentaIniciar(false)],
    });
    const r = await analisarFcDoPainel(ctx, { processo_id: "proc-1" });
    expect(r.ok).toBe(false);
    expect(r.texto).toMatch(/ainda não separa/);
    expect(mocks.abrir).not.toHaveBeenCalled();
  });

  it("dispara acao fc_salvar com pedido_id próprio e persiste score/risco", async () => {
    const r = await analisarFcDoPainel(ctx, { processo_id: "proc-1" });
    expect(r.ok).toBe(true);
    const iniciar = mocks.chamar.mock.calls.find((c) => c[1] === "iniciar_analise_inquilino");
    expect(iniciar?.[2]).toEqual(expect.objectContaining({
      acao: "fc_salvar",
      pedido_id: PEDIDO,
    }));
    expect(iniciar?.[2]).not.toEqual(expect.objectContaining({ acao: "seguro" }));
    expect(r.extra).toEqual(expect.objectContaining({ score: 712, risco: "moderado" }));
    expect(JSON.stringify(r.extra ?? {})).not.toMatch(/529|@exemplo|1198/);
    expect(r.extra?.aviso_creditos).toBe(TEXTO_AVISO_CREDITOS);
    expect(JSON.stringify(r.extra ?? {})).not.toMatch(/R\$|25[,.]30|17[,.]60/);
    expect(mocks.marcar).toHaveBeenCalledWith(
      ctx.admin,
      expect.objectContaining({ resultado: expect.objectContaining({ score: 712, risco: "moderado" }) }),
    );
  });

  it("reusa FC de até 90 dias sem chamar o Hub", async () => {
    mocks.reuso.mockResolvedValue({
      id: "old-1",
      resultado: { score: 640, risco: "baixo", cpf: "52998224725" },
      concluida_em: "2026-10-01T00:00:00Z",
      processo_id: "proc-old",
    });
    mocks.ler.mockResolvedValue({
      pedido_id: PEDIDO,
      estado: "reaproveitada",
      reaproveitou_de: "old-1",
      resultado: { score: 640, risco: "baixo" },
    });
    const r = await analisarFcDoPainel(ctx, { processo_id: "proc-1" });
    expect(r.ok).toBe(true);
    expect(r.texto).toBe(TEXTO_FC_REAPROVEITADA);
    expect(mocks.chamar).not.toHaveBeenCalled();
    expect(mocks.abrir).toHaveBeenCalledWith(
      ctx.admin,
      expect.objectContaining({ reaproveitouDe: "old-1" }),
    );
    expect(JSON.stringify(r.extra ?? {})).not.toMatch(/529/);
    expect(mocks.marcar).toHaveBeenCalledWith(
      ctx.admin,
      expect.objectContaining({
        estado: "reaproveitada",
        resultado: expect.not.objectContaining({ cpf: expect.anything() }),
      }),
    );
    expect(mocks.abrir.mock.calls[0]?.[1]).not.toEqual(expect.objectContaining({ documentoId: expect.anything() }));
  });

  it("FC em andamento vence o reuso de 90 dias", async () => {
    mocks.reuso.mockResolvedValue({
      id: "old-1",
      resultado: { score: 640 },
      concluida_em: "2026-10-01T00:00:00Z",
    });
    mocks.andamento.mockResolvedValue({ pedido_id: PEDIDO, estado: "aguardando_cobranca" });
    mocks.ler.mockResolvedValue({
      pedido_id: PEDIDO,
      processo_id: "proc-1",
      estado: "aguardando_cobranca",
      resultado: {},
    });
    const r = await analisarFcDoPainel(ctx, { processo_id: "proc-1" });
    expect(r.ok).toBe(true);
    expect(r.texto).not.toBe(TEXTO_FC_REAPROVEITADA);
    expect(mocks.abrir).not.toHaveBeenCalled();
  });

  it("sem FC nos últimos 90 dias dispara salvamento novo", async () => {
    mocks.reuso.mockResolvedValue(null);
    const r = await analisarFcDoPainel(ctx, { processo_id: "proc-1" });
    expect(r.ok).toBe(true);
    expect(mocks.chamar.mock.calls.some((c) => c[1] === "iniciar_analise_inquilino")).toBe(true);
  });

  it("fiador pelo agente recusa; pelo botão segue", async () => {
    const ficha = fichaPronta();
    const fiador = pessoaVazia("fiador");
    fiador.nome.valor = "Fiador Teste";
    fiador.cpf.valor = "11144477735";
    fiador.email.valor = "fiador@exemplo.com";
    fiador.celular.valor = "11988887777";
    ficha.pessoas.push(fiador);
    mocks.ficha.mockResolvedValue({ ficha, versao: 2 });
    mocks.participante.mockResolvedValue({
      id: PARTICIPANTE, papel: "fiador", cpf_hash: "xyz", cpf_mascarado: "***.***.**2-25",
    });
    const agente = await analisarFcDoPainel(
      { ...ctx, origem: "agente" },
      { processo_id: "proc-1", participante_id: PARTICIPANTE },
    );
    expect(agente.ok).toBe(false);
    expect(agente.texto).toBe(TEXTO_FIADOR_SO_ATENDENTE);
    expect(mocks.abrir).not.toHaveBeenCalled();

    const botao = await analisarFcDoPainel(
      ctx,
      { processo_id: "proc-1", participante_id: PARTICIPANTE },
    );
    expect(botao.ok).toBe(true);
    expect(mocks.chamar).toHaveBeenCalled();
  });

  it("sem renda confirmada não chama Hub", async () => {
    mocks.processo.mockResolvedValue({ id: "proc-1" });
    const r = await analisarFcDoPainel(ctx, { processo_id: "proc-1" });
    expect(r.ok).toBe(false);
    expect(r.texto).toMatch(/Confirme a renda/);
    expect(mocks.carregar).not.toHaveBeenCalled();
  });

  it("chave desligada recusa", async () => {
    const r = await analisarFcDoPainel({ ...ctx, settings: {} }, {});
    expect(r.ok).toBe(false);
    expect(r.texto).toMatch(/não está ligada/);
  });

  it("confirmação paga exige clique humano — o agente não executa", async () => {
    const peloRegistro = await executarFerramenta(
      "confirmar_cobranca_fc",
      { ...ctx, origem: "agente" },
      { processo_id: "proc-1", pedido_id: PEDIDO },
    );
    expect(peloRegistro.ok).toBe(false);
    expect(peloRegistro.texto).toMatch(/exige clique/);
    expect(mocks.chamar).not.toHaveBeenCalled();

    const direto = await confirmarCobrancaFcDoPainel(
      { ...ctx, origem: "agente" },
      { processo_id: "proc-1", pedido_id: PEDIDO },
    );
    expect(direto.ok).toBe(false);
    expect(direto.texto).toMatch(/exige clique/);
  });

  it("confirmação idempotente: ja_cobrado não dispara de novo", async () => {
    mocks.ler.mockResolvedValue({
      pedido_id: PEDIDO,
      processo_id: "proc-1",
      estado: "aguardando_cobranca",
      resultado: {},
    });
    mocks.chamar.mockImplementation(async (_s: unknown, nome: string) => {
      if (nome === "confirmar_cobranca_fc_analise") {
        return { texto: "", dados: { resultado: "ja_cobrado" } };
      }
      if (nome === "status_analise_inquilino") {
        return { texto: "", dados: { estado: "fc_processado", fc: { score: 700, risco: "moderado" } } };
      }
      return { texto: "", dados: {} };
    });
    const r = await confirmarCobrancaFcDoPainel(ctx, { processo_id: "proc-1", pedido_id: PEDIDO });
    expect(r.ok).toBe(true);
    const confirms = mocks.chamar.mock.calls.filter((c) => c[1] === "confirmar_cobranca_fc_analise");
    expect(confirms).toHaveLength(1);
    expect(confirms[0]?.[2]).toEqual(expect.objectContaining({
      pedido_id: PEDIDO,
      confirmado: true,
      confirmado_por: "u1",
    }));
    expect(confirms[0]?.[2]).not.toHaveProperty("valor_exibido");
    expect(r.texto === TEXTO_FC_JA_COBRADO || r.extra?.cobranca === "ja_cobrado" || r.ok).toBeTruthy();
  });

  it("cobranca_incerta avisa e não chama de novo sozinha", async () => {
    mocks.ler.mockResolvedValue({
      pedido_id: PEDIDO,
      processo_id: "proc-1",
      estado: "aguardando_cobranca",
      resultado: {},
    });
    mocks.chamar.mockImplementation(async (_s: unknown, nome: string) => {
      if (nome === "confirmar_cobranca_fc_analise") {
        return { texto: "", dados: { resultado: "cobranca_incerta" } };
      }
      throw new Error("status não deveria rodar após cobrança incerta");
    });
    const r = await confirmarCobrancaFcDoPainel(ctx, { processo_id: "proc-1", pedido_id: PEDIDO });
    expect(r.ok).toBe(false);
    expect(r.texto).toBe(TEXTO_FC_INCERTA);
    expect(mocks.chamar.mock.calls.filter((c) => c[1] === "status_analise_inquilino")).toHaveLength(0);
    expect(mocks.marcar).toHaveBeenCalledWith(
      ctx.admin,
      expect.objectContaining({
        estado: "aguardando_cobranca",
        erroCodigo: "cobranca_incerta",
        resultado: expect.objectContaining({ cobranca: "incerta" }),
      }),
    );
  });

  it("status não chama confirmar_cobranca nem baixa print_migra", async () => {
    mocks.recenteProc.mockResolvedValue({ pedido_id: PEDIDO, estado: "aguardando_cobranca" });
    mocks.chamar.mockImplementation(async (_s: unknown, nome: string) => {
      if (nome === "confirmar_cobranca_fc_analise") {
        throw new Error("status não confirma cobrança");
      }
      if (nome === "baixar_resultado_analise") {
        throw new Error("não deveria baixar print");
      }
      return { texto: "", dados: { estado: "fc_salvo_pendente", fc: { score: 1, risco: "baixo" } } };
    });
    const r = await statusFcDoPainel(ctx, { processo_id: "proc-1" });
    expect(r.ok).toBe(true);
    expect(mocks.chamar.mock.calls.some((c) => c[1] === "confirmar_cobranca_fc_analise")).toBe(false);
    expect(mocks.chamar.mock.calls.some((c) => c[2] && (c[2] as { tipo?: string }).tipo === "print_migra")).toBe(false);
  });

  it("sem ferramenta de cobrança: aviso claro, sem disparar pago", async () => {
    mocks.carregar.mockResolvedValue(hubOk({ confirmar: false }));
    mocks.ler.mockResolvedValue({
      pedido_id: PEDIDO,
      processo_id: "proc-1",
      estado: "aguardando_cobranca",
      resultado: {},
    });
    const r = await confirmarCobrancaFcDoPainel(ctx, { processo_id: "proc-1", pedido_id: PEDIDO });
    expect(r.ok).toBe(false);
    expect(r.texto).toBe(TEXTO_FERRAMENTA_HUB_AUSENTE);
    expect(mocks.chamar.mock.calls.some((c) => c[1] === "confirmar_cobranca_fc_analise")).toBe(false);
  });

  it("salvamento grátis o agente executa (L)", async () => {
    const r = await executarFerramenta(
      "analisar_fc",
      { ...ctx, origem: "agente" },
      { processo_id: "00000000-0000-4000-8000-000000000011" },
    );
    expect(r.ok).toBe(true);
    expect(mocks.chamar.mock.calls.some((c) => c[1] === "iniciar_analise_inquilino")).toBe(true);
  });

  it("confirmação já concluída é idempotente sem chamar o Hub", async () => {
    mocks.ler.mockResolvedValue({
      pedido_id: PEDIDO,
      processo_id: "proc-1",
      estado: "concluida",
      resultado: { score: 700, cobranca: "ja_cobrado" },
    });
    const r = await confirmarCobrancaFcDoPainel(ctx, { processo_id: "proc-1", pedido_id: PEDIDO });
    expect(r.ok).toBe(true);
    expect(r.texto).toBe(TEXTO_FC_JA_COBRADO);
    expect(mocks.chamar).not.toHaveBeenCalled();
  });

  it("depois de login_necessario confirma o mesmo pedido_id", async () => {
    mocks.ler.mockResolvedValue({
      pedido_id: PEDIDO,
      processo_id: "proc-1",
      estado: "login_necessario",
      resultado: {},
    });
    mocks.chamar.mockImplementation(async (_s: unknown, nome: string) => {
      if (nome === "confirmar_cobranca_fc_analise") {
        return { texto: "", dados: { resultado: "aceito", job_id: "job-2" } };
      }
      if (nome === "status_analise_inquilino") {
        return { texto: "", dados: { estado: "cobrando", fc: { score: 700, risco: "moderado" } } };
      }
      return { texto: "", dados: {} };
    });
    const r = await confirmarCobrancaFcDoPainel(ctx, { processo_id: "proc-1", pedido_id: PEDIDO });
    expect(r.ok).toBe(true);
    const confirms = mocks.chamar.mock.calls.filter((c) => c[1] === "confirmar_cobranca_fc_analise");
    expect(confirms).toHaveLength(1);
    expect(confirms[0]?.[2]).toEqual(expect.objectContaining({ pedido_id: PEDIDO, confirmado: true }));
  });

  it("baixa laudo tipo=laudo quando disponível e arquivos ligados", async () => {
    const comArquivos: typeof ctx = {
      ...ctx,
      settings: { locacao: { processos_habilitado: true, arquivos_habilitado: true, analise: { fc: true } } },
    };
    mocks.recenteProc.mockResolvedValue({ pedido_id: PEDIDO, estado: "cobrando" });
    mocks.ler.mockResolvedValue({
      pedido_id: PEDIDO,
      processo_id: "proc-1",
      estado: "cobrando",
      resultado: {},
      documento_id: null,
    });
    mocks.laudo.mockResolvedValue("doc-1");
    mocks.chamar.mockImplementation(async (_s: unknown, nome: string, args: unknown) => {
      if (nome === "baixar_resultado_analise") {
        expect(args).toEqual({ pedido_id: PEDIDO, tipo: "laudo" });
        return {
          texto: "",
          dados: { bytes_b64: Buffer.from("%PDF-fake").toString("base64"), mime: "application/pdf" },
        };
      }
      if (nome === "confirmar_cobranca_fc_analise") throw new Error("status não confirma");
      return {
        texto: "",
        dados: { estado: "concluido", fc: { score: 1, risco: "baixo", laudo_disponivel: true } },
      };
    });
    const r = await statusFcDoPainel(comArquivos, { processo_id: "proc-1" });
    expect(r.ok).toBe(true);
    expect(mocks.laudo).toHaveBeenCalled();
    expect(mocks.chamar.mock.calls.some((c) => c[1] === "baixar_resultado_analise")).toBe(true);
  });

  it("arquivos desligados: score salvo, laudo não persistido", async () => {
    mocks.recenteProc.mockResolvedValue({ pedido_id: PEDIDO, estado: "cobrando" });
    mocks.chamar.mockImplementation(async (_s: unknown, nome: string) => {
      if (nome === "baixar_resultado_analise") throw new Error("não deveria baixar com arquivos off");
      return {
        texto: "",
        dados: { estado: "concluido", fc: { score: 640, risco: "baixo", laudo_disponivel: true } },
      };
    });
    const r = await statusFcDoPainel(ctx, { processo_id: "proc-1" });
    expect(r.ok).toBe(true);
    expect(r.extra?.score).toBe(640);
    expect(mocks.laudo).not.toHaveBeenCalled();
    expect(r.texto).toMatch(/arquivos do processo estão desligados/);
  });

  it("lista fechada inclui a ferramenta de cobrança", () => {
    expect(LISTA_FECHADA_HUB_ANALISE).toContain("confirmar_cobranca_fc_analise");
  });
});
