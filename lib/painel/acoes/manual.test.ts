import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  processo: vi.fn(),
  listar: vi.fn(),
  ficha: vi.fn(),
  fc: vi.fn(),
  fcRecente: vi.fn(),
  seguro: vi.fn(),
  seguroRecente: vi.fn(),
  marcarFc: vi.fn(),
  marcarSeguro: vi.fn(),
  laudo: vi.fn(),
  print: vi.fn(),
  evento: vi.fn(),
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
  lerAnaliseFc: (...args: unknown[]) => mocks.fc(...args),
  lerAnaliseFcMaisRecenteDoProcesso: (...args: unknown[]) => mocks.fcRecente(...args),
  lerAnaliseSeguro: (...args: unknown[]) => mocks.seguro(...args),
  lerAnaliseSeguroMaisRecente: (...args: unknown[]) => mocks.seguroRecente(...args),
  marcarEstadoAnaliseFc: (...args: unknown[]) => mocks.marcarFc(...args),
  marcarEstadoAnaliseSeguro: (...args: unknown[]) => mocks.marcarSeguro(...args),
  guardarLaudoFc: (...args: unknown[]) => mocks.laudo(...args),
  guardarPrintMigra: (...args: unknown[]) => mocks.print(...args),
  gravarEvento: (...args: unknown[]) => mocks.evento(...args),
}));

import { fichaVazia } from "@/lib/locacao/ficha-schema";
import { mascararCpf } from "@/lib/locacao/cpf";
import {
  prepararManualDoPainel,
  registrarManualFcDoPainel,
  registrarManualSeguroDoPainel,
  revelarCpfManualDoPainel,
  TEXTO_MANUAL_SEM_FALHA,
  TEXTO_SEM_PEDIDO_FALHO,
} from "@/lib/painel/acoes/manual";
import { executarFerramenta } from "@/lib/painel/ferramentas/executar";
import type { ContextoDaFerramenta } from "@/lib/painel/ferramentas/tipos";

const PEDIDO_FC = "00000000-0000-4000-8000-000000000088";
const PEDIDO_SEGURO = "00000000-0000-4000-8000-000000000099";

function fichaPronta() {
  const f = fichaVazia();
  f.pessoas[0]!.nome.valor = "Inquilino Teste";
  f.pessoas[0]!.cpf.valor = "52998224725";
  f.pessoas[0]!.email.valor = "inquilino@exemplo.com";
  f.pessoas[0]!.celular.valor = "11987654321";
  f.imovel.logradouro.valor = "Rua das Flores";
  f.imovel.numero.valor = "100";
  f.imovel.aluguel.valor = 2500;
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
  settings: { locacao: { processos_habilitado: true, analise: { manual: true } } },
  idioma: "pt-BR",
  origem: "botao",
};

describe("manual assistido no painel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.processo.mockResolvedValue({ id: "proc-1", renda_confirmada_em: "2026-10-28T12:00:00Z" });
    mocks.listar.mockResolvedValue([{ id: "proc-1" }]);
    mocks.ficha.mockResolvedValue({ ficha: fichaPronta(), versao: 2 });
    mocks.fcRecente.mockResolvedValue({
      pedido_id: PEDIDO_FC,
      processo_id: "proc-1",
      estado: "login_necessario",
      cpf_hash: null,
      documento_id: null,
    });
    mocks.fc.mockResolvedValue({
      pedido_id: PEDIDO_FC,
      processo_id: "proc-1",
      estado: "login_necessario",
      cpf_hash: null,
      documento_id: null,
    });
    mocks.seguroRecente.mockResolvedValue({
      pedido_id: PEDIDO_SEGURO,
      processo_id: "proc-1",
      estado: "erro",
      documento_id: null,
    });
    mocks.seguro.mockResolvedValue({
      pedido_id: PEDIDO_SEGURO,
      processo_id: "proc-1",
      estado: "erro",
      documento_id: null,
    });
    mocks.marcarFc.mockResolvedValue(undefined);
    mocks.marcarSeguro.mockResolvedValue(undefined);
    mocks.laudo.mockResolvedValue("doc-fc");
    mocks.print.mockResolvedValue("doc-seguro");
    mocks.evento.mockResolvedValue(undefined);
  });

  it("chave desligada recusa sem olhar o processo", async () => {
    const r = await prepararManualDoPainel({ ...ctx, settings: {} }, {});
    expect(r.ok).toBe(false);
    expect(r.texto).toMatch(/não está ligada/);
    expect(mocks.fcRecente).not.toHaveBeenCalled();
  });

  it("sem falha do robô o manual não abre", async () => {
    mocks.fcRecente.mockResolvedValue({ pedido_id: PEDIDO_FC, estado: "concluida" });
    mocks.seguroRecente.mockResolvedValue({ pedido_id: PEDIDO_SEGURO, estado: "concluida" });
    const r = await prepararManualDoPainel(ctx, {});
    expect(r.ok).toBe(false);
    expect(r.texto).toBe(TEXTO_MANUAL_SEM_FALHA);
  });

  it("prepara dados mascarados e não chama o Hub", async () => {
    const r = await prepararManualDoPainel(ctx, {});
    expect(r.ok).toBe(true);
    const extra = r.extra ?? {};
    const campos = extra.campos as Array<{ chave: string; valor: string }>;
    expect(campos.find((c) => c.chave === "cpf")?.valor).toBe(mascararCpf("52998224725"));
    expect(JSON.stringify(extra)).not.toContain("52998224725");
    expect(extra.etapa_fc).toBe(true);
    expect(extra.etapa_seguro).toBe(true);
    expect(extra.links).toEqual(expect.objectContaining({
      fc: "https://cliente.fcanalise.com.br",
      migra: "https://migra.app.br",
    }));
  });

  it("hash da tentativa que não está na ficha não revela o CPF de outra pessoa", async () => {
    mocks.fcRecente.mockResolvedValue({
      pedido_id: PEDIDO_FC,
      processo_id: "proc-1",
      estado: "erro",
      cpf_hash: "hash-de-outra-pessoa",
      documento_id: null,
    });
    mocks.seguroRecente.mockResolvedValue({ pedido_id: PEDIDO_SEGURO, estado: "concluida" });
    const r = await revelarCpfManualDoPainel(ctx, {});
    expect(r.ok).toBe(false);
    expect(r.texto).toMatch(/Não há CPF/);
    expect(r.extra?.cpf).toBeUndefined();
  });

  it("revelar CPF só no clique e o texto não carrega o número", async () => {
    const agente = await executarFerramenta("revelar_cpf_manual", { ...ctx, origem: "agente" }, {});
    expect(agente.ok).toBe(false);
    expect(agente.texto).toMatch(/exige clique/);
    const r = await revelarCpfManualDoPainel(ctx, {});
    expect(r.ok).toBe(true);
    expect(r.extra?.cpf).toBe("52998224725");
    expect(r.texto).not.toContain("52998224725");
    expect(r.texto).not.toContain("529.982");
  });

  it("registra FC no mesmo pedido falho, origem manual, sem Hub", async () => {
    const r = await registrarManualFcDoPainel(ctx, { score: 720, risco: "baixo", id_fc: "FC-1" });
    expect(r.ok).toBe(true);
    expect(mocks.marcarFc).toHaveBeenCalledWith(ctx.admin, expect.objectContaining({
      pedidoId: PEDIDO_FC,
      estado: "concluida",
      origem: "manual",
      resultado: expect.objectContaining({ score: 720, risco: "baixo", id_fc: "FC-1" }),
    }));
    expect(mocks.evento).toHaveBeenCalledWith(ctx.admin, expect.objectContaining({
      tipo: "analise_fc",
      detalhe: expect.objectContaining({ origem: "manual", pedido_id: PEDIDO_FC }),
    }));
    expect(JSON.stringify(mocks.evento.mock.calls)).not.toMatch(/52998224725|inquilino@/);
  });

  it("sem renda confirmada recusa o registro e não grava", async () => {
    mocks.processo.mockResolvedValue({ id: "proc-1", renda_confirmada_em: null });
    const r = await registrarManualFcDoPainel(ctx, { score: 10 });
    expect(r.ok).toBe(false);
    expect(mocks.marcarFc).not.toHaveBeenCalled();
  });

  it("não cria pedido novo: tentativas concluídas recusam o registro", async () => {
    mocks.fcRecente.mockResolvedValue({ pedido_id: PEDIDO_FC, estado: "concluida" });
    const r = await registrarManualFcDoPainel(ctx, { score: 1 });
    expect(r.ok).toBe(false);
    expect(r.texto).toBe(TEXTO_SEM_PEDIDO_FALHO);
    expect(mocks.marcarFc).not.toHaveBeenCalled();
  });

  it("registra cards da Migra e recusa sem card", async () => {
    const vazio = await registrarManualSeguroDoPainel(ctx, { cards: [] });
    expect(vazio.ok).toBe(false);
    const r = await registrarManualSeguroDoPainel(ctx, { cards: [{ seguradora: "Porto", codigo: "A1" }] });
    expect(r.ok).toBe(true);
    expect(mocks.marcarSeguro).toHaveBeenCalledWith(ctx.admin, expect.objectContaining({
      pedidoId: PEDIDO_SEGURO,
      estado: "concluida",
      origem: "manual",
    }));
    expect(JSON.stringify(mocks.marcarSeguro.mock.calls[0]?.[1])).not.toMatch(/Contratar/);
  });

  it("com arquivos desligados salva o resultado e não persiste o anexo", async () => {
    const off = {
      ...ctx,
      settings: { locacao: { processos_habilitado: true, arquivos_habilitado: false, analise: { manual: true } } },
    };
    const r = await registrarManualFcDoPainel(off, {
      score: 10,
      anexo: { bytes_b64: Buffer.from("%PDF-1.4").toString("base64"), mime: "application/pdf" },
    });
    expect(r.ok).toBe(true);
    expect(mocks.laudo).not.toHaveBeenCalled();
    expect(r.extra?.avisos).toEqual(["laudo_sem_arquivos"]);
  });
});
