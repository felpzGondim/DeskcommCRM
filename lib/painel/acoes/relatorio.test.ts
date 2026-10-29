import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  processo: vi.fn(),
  listar: vi.fn(),
  fichaProc: vi.fn(),
  fichaConv: vi.fn(),
  fc: vi.fn(),
  seguro: vi.fn(),
  rascunho: vi.fn(),
  aprovar: vi.fn(),
  documento: vi.fn(),
}));

vi.mock("@/lib/locacao/ficha-repositorio", () => ({
  lerFichaAtual: (...args: unknown[]) => mocks.fichaConv(...args),
}));
vi.mock("@/lib/locacao/repositorio", () => ({
  LocacaoErro: class LocacaoErro extends Error {
    constructor(readonly codigo: string, message: string) {
      super(message);
    }
  },
  lerProcesso: (...args: unknown[]) => mocks.processo(...args),
  listarProcessosDaConversa: (...args: unknown[]) => mocks.listar(...args),
  lerFichaAtualDoProcesso: (...args: unknown[]) => mocks.fichaProc(...args),
  lerAnaliseFcMaisRecenteDoProcesso: (...args: unknown[]) => mocks.fc(...args),
  lerAnaliseSeguroMaisRecente: (...args: unknown[]) => mocks.seguro(...args),
  gravarRascunhoRelatorio: (...args: unknown[]) => mocks.rascunho(...args),
  marcarRelatorioAprovado: (...args: unknown[]) => mocks.aprovar(...args),
  guardarDocumentoRelatorio: (...args: unknown[]) => mocks.documento(...args),
}));

import { completarFicha } from "@/lib/locacao/ficha-schema";
import {
  TEXTO_SEM_PROCESSO_RELATORIO,
  TEXTO_SEM_RASCUNHO,
  aprovarRelatorioDoPainel,
  gerarRelatorioDoPainel,
} from "@/lib/painel/acoes/relatorio";
import { TEXTO_ANALISE_DESLIGADA } from "@/lib/painel/acoes/analise";
import type { ContextoDaFerramenta } from "@/lib/painel/ferramentas/tipos";

const PROC = "00000000-0000-4000-8000-000000000001";

const ctx = (settings: unknown = {
  locacao: { processos_habilitado: true, analise: { relatorio: true } },
}): ContextoDaFerramenta => ({
  orgId: "org-1",
  conversationId: "conv-1",
  contactId: "c1",
  userId: "u1",
  requestId: "r1",
  dbSessao: {} as never,
  admin: {} as never,
  settings,
  idioma: "pt-BR",
  origem: "botao",
});

describe("ações do relatório financeiro", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.processo.mockResolvedValue({ id: PROC, renda_confirmada_em: null, relatorio_rascunho: null });
    mocks.listar.mockResolvedValue([{ id: PROC }]);
    mocks.fichaProc.mockResolvedValue({
      versao: 1,
      ficha: completarFicha({ renda: { mensal: { valor: 8000 } } }),
    });
    mocks.fichaConv.mockResolvedValue({ relatorio: "preliminar curto", ficha: null });
    mocks.fc.mockResolvedValue(null);
    mocks.seguro.mockResolvedValue(null);
    mocks.rascunho.mockResolvedValue(undefined);
    mocks.aprovar.mockResolvedValue(undefined);
    mocks.documento.mockResolvedValue("doc-1");
  });

  it("chave desligada recusa sem gravar", async () => {
    const r = await gerarRelatorioDoPainel(ctx({}), {});
    expect(r.ok).toBe(false);
    expect(r.texto).toBe(TEXTO_ANALISE_DESLIGADA);
    expect(mocks.rascunho).not.toHaveBeenCalled();
  });

  it("sem processo recusa", async () => {
    mocks.listar.mockResolvedValue([]);
    mocks.processo.mockResolvedValue(null);
    const r = await gerarRelatorioDoPainel(ctx(), {});
    expect(r.ok).toBe(false);
    expect(r.texto).toBe(TEXTO_SEM_PROCESSO_RELATORIO);
  });

  it("mensal da ficha não vira comprovada; seção de renda fica pendente", async () => {
    const r = await gerarRelatorioDoPainel(ctx(), { processo_id: PROC });
    expect(r.ok).toBe(true);
    expect(r.extra?.renda).toEqual(expect.objectContaining({ comprovada: null }));
    expect((r.extra?.renda as { comprovada: unknown }).comprovada).not.toBe(8000);
    expect(r.texto).toMatch(/não entra no lugar|Pendente/i);
    expect(mocks.rascunho).toHaveBeenCalled();
    expect(r.extra?.risco).not.toBe("baixo");
  });

  it("aprovar sem rascunho recusa; com rascunho e arquivos off não cria documento", async () => {
    const vazio = await aprovarRelatorioDoPainel(ctx(), { processo_id: PROC });
    expect(vazio.ok).toBe(false);
    expect(vazio.texto).toBe(TEXTO_SEM_RASCUNHO);
    mocks.processo.mockResolvedValue({
      id: PROC,
      relatorio_rascunho: "## 1. Identificação\nPendente",
      relatorio_rascunho_em: "2026-10-29T12:00:00Z",
    });
    const ok = await aprovarRelatorioDoPainel(ctx(), { processo_id: PROC });
    expect(ok.ok).toBe(true);
    expect(mocks.documento).not.toHaveBeenCalled();
    expect(mocks.aprovar).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ documentoId: null }),
    );
  });
});
