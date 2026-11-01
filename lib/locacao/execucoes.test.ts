import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tabela: vi.fn(),
}));

vi.mock("@/lib/locacao/admin", () => ({
  tabelaLocacao: (...args: unknown[]) => mocks.tabela(...args),
}));

import {
  abrirExecucao,
  atualizarExecucao,
  caminhoDeDocumentoDoProcesso,
  lerUltimaExecucaoPorAba,
  lerUltimasExecucoesDoProcesso,
  marcarDesatualizadasSeEntradaMudou,
  PASTA_FICHA_CADASTRAL,
} from "@/lib/locacao/execucoes";
import {
  ABAS_DA_EXECUCAO,
  CATEGORIAS_DE_DOCUMENTO,
  ESTADOS_DA_EXECUCAO,
  ORIGENS_DA_EXECUCAO,
  ORIGENS_DO_DOCUMENTO,
} from "@/lib/locacao/vocabulario";

const ORG = "00000000-0000-4000-8000-0000000000aa";
const PROCESSO = "00000000-0000-4000-8000-0000000000bb";
const USER = "00000000-0000-4000-8000-0000000000cc";
const EXEC = "00000000-0000-4000-8000-0000000000dd";

function cadeia(resposta: { data?: unknown; error?: { code?: string } | null } = {}) {
  const api: Record<string, unknown> = {};
  const self = () => api;
  api.select = self;
  api.eq = self;
  api.in = self;
  api.order = self;
  api.limit = self;
  api.not = self;
  api.neq = self;
  api.insert = vi.fn(() => api);
  api.update = vi.fn(() => api);
  api.is = self;
  api.maybeSingle = vi.fn(async () => ({ data: resposta.data ?? null, error: resposta.error ?? null }));
  api.then = (ok: (v: { data: unknown; error: unknown }) => unknown, err?: (e: unknown) => unknown) =>
    Promise.resolve({ data: resposta.data ?? null, error: resposta.error ?? null }).then(ok, err);
  return api;
}

describe("helper de locacao_execucoes", () => {
  const admin = {} as never;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("o caminho da ficha cadastral impressa é {org}/processos/{id}/ficha_cadastral/", () => {
    expect(PASTA_FICHA_CADASTRAL).toBe("ficha_cadastral");
    expect(caminhoDeDocumentoDoProcesso(ORG, PROCESSO, "ficha_cadastral", `${EXEC}.pdf`)).toBe(
      `${ORG}/processos/${PROCESSO}/ficha_cadastral/${EXEC}.pdf`,
    );
    expect(caminhoDeDocumentoDoProcesso(ORG, PROCESSO, "laudo_fc", `${EXEC}.pdf`)).toContain("/laudo_fc/");
    expect(caminhoDeDocumentoDoProcesso(ORG, PROCESSO, "ficha_migra", `${EXEC}.pdf`)).toContain("/ficha_migra/");
    expect(caminhoDeDocumentoDoProcesso(ORG, PROCESSO, "contrato", `${EXEC}.pdf`)).toContain("/contrato/");
    expect(caminhoDeDocumentoDoProcesso(ORG, PROCESSO, "cotacao_seguro", `${EXEC}.png`)).toContain(
      "/cotacao_seguro/",
    );
  });

  it("abre uma execução na fila e devolve o id", async () => {
    const api = cadeia({ data: { id: EXEC } });
    mocks.tabela.mockReturnValue(api);
    const id = await abrirExecucao(admin, {
      orgId: ORG,
      processoId: PROCESSO,
      aba: "renda",
      origem: "botao",
      atorUserId: USER,
      entradaHash: "abc",
    });
    expect(id).toBe(EXEC);
    expect(api.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: ORG,
        processo_id: PROCESSO,
        aba: "renda",
        estado: "na_fila",
        origem: "botao",
        ator_user_id: USER,
        entrada_hash: "abc",
      }),
    );
  });

  it("reusa a execução em andamento quando o único parcial recusa (23505)", async () => {
    const insertApi = cadeia({ error: { code: "23505" } });
    const andamentoApi = cadeia({
      data: { id: EXEC, aba: "renda", estado: "processando", organization_id: ORG },
    });
    mocks.tabela.mockReturnValueOnce(insertApi).mockReturnValueOnce(andamentoApi);
    const id = await abrirExecucao(admin, {
      orgId: ORG,
      processoId: PROCESSO,
      aba: "renda",
      origem: "chat",
      atorUserId: USER,
    });
    expect(id).toBe(EXEC);
  });

  it("lê a última execução da aba ordenando por created_at desc", async () => {
    const api = cadeia({ data: { id: EXEC, aba: "fc", estado: "concluido" } });
    mocks.tabela.mockReturnValue(api);
    const linha = await lerUltimaExecucaoPorAba(admin, ORG, PROCESSO, "fc");
    expect(linha?.id).toBe(EXEC);
    expect(api.order).toBeDefined();
  });

  it("lê a última de cada aba e marca concluídas com hash diferente como desatualizado", async () => {
    const listApi = cadeia({
      data: [
        { id: EXEC, aba: "renda", estado: "concluido", created_at: "2026-11-01T12:00:00.000Z" },
        { id: "old", aba: "renda", estado: "erro", created_at: "2026-10-01T12:00:00.000Z" },
        { id: "fc1", aba: "fc", estado: "na_fila", created_at: "2026-11-01T11:00:00.000Z" },
      ],
    });
    mocks.tabela.mockReturnValueOnce(listApi);
    const ultimas = await lerUltimasExecucoesDoProcesso(admin, ORG, PROCESSO);
    expect(ultimas.map((l) => l.aba)).toEqual(["renda", "fc"]);
    expect(ultimas[0]?.id).toBe(EXEC);

    const updateApi = cadeia();
    mocks.tabela.mockReturnValueOnce(updateApi);
    await marcarDesatualizadasSeEntradaMudou(admin, {
      orgId: ORG,
      processoId: PROCESSO,
      hashAtual: "novo",
      abas: ["renda", "fc"],
    });
    expect(updateApi.update).toHaveBeenCalledWith({ estado: "desatualizado" });
  });

  it("ao concluir, grava terminado_em; ao processar, só carimba iniciado_em vazio", async () => {
    const updateApi = cadeia();
    const stampApi = cadeia();
    mocks.tabela.mockReturnValueOnce(updateApi).mockReturnValueOnce(stampApi);
    await atualizarExecucao(admin, {
      orgId: ORG,
      execucaoId: EXEC,
      estado: "processando",
      etapaTexto: "lendo extrato pág. 1 de 4",
      progressoAtual: 1,
      progressoTotal: 4,
    });
    expect(updateApi.update).toHaveBeenCalledWith(
      expect.objectContaining({
        estado: "processando",
        etapa_texto: "lendo extrato pág. 1 de 4",
        progresso_atual: 1,
        progresso_total: 4,
      }),
    );
    expect(stampApi.update).toHaveBeenCalledWith(expect.objectContaining({ iniciado_em: expect.any(String) }));
  });
});

describe("vocabulário e migration 0772", () => {
  it("abas, estados e origens da execução são os do plano", () => {
    expect(ABAS_DA_EXECUCAO).toEqual([
      "dados",
      "renda",
      "fc",
      "migra",
      "relatorio",
      "contrato",
      "documentos",
    ]);
    expect(ESTADOS_DA_EXECUCAO).toEqual([
      "na_fila",
      "processando",
      "concluido",
      "erro",
      "desatualizado",
    ]);
    expect(ORIGENS_DA_EXECUCAO).toEqual(["botao", "chat"]);
  });

  it("ficha_cadastral entra em categoria e origem; laudo, Migra e contrato já tinham tipo", () => {
    expect(CATEGORIAS_DE_DOCUMENTO).toContain("ficha_cadastral");
    expect(CATEGORIAS_DE_DOCUMENTO).toContain("ficha_migra");
    expect(CATEGORIAS_DE_DOCUMENTO).toContain("laudo_fc");
    expect(CATEGORIAS_DE_DOCUMENTO).toContain("cotacao_seguro");
    expect(CATEGORIAS_DE_DOCUMENTO).toContain("contrato");
    expect(ORIGENS_DO_DOCUMENTO).toContain("ficha_cadastral");
    expect(ORIGENS_DO_DOCUMENTO).toContain("hub_fc");
    expect(ORIGENS_DO_DOCUMENTO).toContain("hub_migra");
    expect(ORIGENS_DO_DOCUMENTO).toContain("contrato");
  });

  it("a migration 0772 não cria SECURITY DEFINER e documenta o caminho da ficha", () => {
    const src = readFileSync(
      join(process.cwd(), "supabase/migrations/20261101140000_0772_locacao_execucoes.sql"),
      "utf8",
    );
    expect(src).toContain("locacao_execucoes");
    expect(src).toContain("ficha_cadastral");
    expect(src).toContain("{org}/processos/{processo_id}/ficha_cadastral/");
    expect(src.toLowerCase()).not.toContain("security definer");
    expect(src).not.toMatch(/analise.*true/i);
    const baseline = readFileSync(join(process.cwd(), "supabase/baseline.sql"), "utf8");
    const i = baseline.lastIndexOf("-- ---- locação 0772");
    expect(i).toBeGreaterThan(0);
    expect(baseline.slice(i)).toContain("locacao_execucoes_proc_aba_andamento_uidx");
    expect(baseline.slice(i)).toContain("ficha_cadastral");
  });
});
