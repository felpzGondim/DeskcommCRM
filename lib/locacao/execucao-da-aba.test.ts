import { describe, expect, it } from "vitest";

import {
  ABAS_DO_MODAL_LOCACAO,
  PONTO_RENDA_ASSINCRONA,
  ROTULO_DA_ABA,
  checklistDaAba,
  estadoVisivelDaAba,
  execucaoEmAndamento,
  horaDaUltimaExecucao,
  rotuloDoEstadoVisivel,
  type ExecucaoPublica,
} from "@/lib/locacao/execucao-da-aba";

function exec(parcial: Partial<ExecucaoPublica> & Pick<ExecucaoPublica, "estado">): ExecucaoPublica {
  return {
    id: "e1",
    aba: "renda",
    etapa_texto: null,
    progresso_atual: 0,
    progresso_total: 0,
    erro_motivo: null,
    entrada_hash: "aaa",
    ficha_versao: 1,
    origem: "botao",
    iniciado_em: null,
    terminado_em: null,
    created_at: "2026-11-01T12:00:00.000Z",
    updated_at: "2026-11-01T12:00:00.000Z",
    ...parcial,
  };
}

describe("ordem e ponto de ligação das abas", () => {
  it("a ordem das abas é Dados, Renda, FC, Migra, Relatório, Contrato, Documentos", () => {
    expect(ABAS_DO_MODAL_LOCACAO).toEqual([
      "dados",
      "renda",
      "fc",
      "migra",
      "relatorio",
      "contrato",
      "documentos",
    ]);
    expect(ABAS_DO_MODAL_LOCACAO.at(-1)).toBe("documentos");
    expect(Object.values(ROTULO_DA_ABA)).toEqual([
      "Dados",
      "Renda",
      "FC",
      "Migra",
      "Relatório",
      "Contrato",
      "Documentos",
    ]);
  });

  it("a renda assíncrona ainda aponta para o POST síncrono existente", () => {
    expect(PONTO_RENDA_ASSINCRONA.rota).toBe("/api/v1/conversations/:id/painel-agente/renda");
    expect(PONTO_RENDA_ASSINCRONA.estado).toBe("sincrono");
  });
});

describe("estado visível da aba", () => {
  it("sem linha é sem execução", () => {
    expect(estadoVisivelDaAba(null)).toBe("sem_execucao");
    expect(rotuloDoEstadoVisivel("sem_execucao")).toBe("Sem execução nesta aba.");
  });

  it("na fila e processando com a etapa atual", () => {
    expect(estadoVisivelDaAba(exec({ estado: "na_fila" }))).toBe("na_fila");
    expect(rotuloDoEstadoVisivel("na_fila")).toBe("Na fila");
    const proc = exec({ estado: "processando", etapa_texto: "lendo extrato pág. 12 de 43" });
    expect(estadoVisivelDaAba(proc)).toBe("processando");
    expect(rotuloDoEstadoVisivel("processando", proc.etapa_texto)).toBe("lendo extrato pág. 12 de 43");
    expect(execucaoEmAndamento(proc)).toBe(true);
  });

  it("concluído, erro e desatualizado gravado", () => {
    expect(estadoVisivelDaAba(exec({ estado: "concluido" }))).toBe("concluido");
    expect(estadoVisivelDaAba(exec({ estado: "erro", erro_motivo: "PDF com senha" }))).toBe("erro");
    expect(estadoVisivelDaAba(exec({ estado: "desatualizado" }))).toBe("desatualizado");
    expect(rotuloDoEstadoVisivel("desatualizado")).toBe("desatualizado — rode de novo");
  });

  it("execução concluída fica desatualizada se o hash da entrada mudou ou o campo foi editado", () => {
    const feita = exec({ estado: "concluido", entrada_hash: "aaa" });
    expect(estadoVisivelDaAba(feita, { hashAtual: "aaa" })).toBe("concluido");
    expect(estadoVisivelDaAba(feita, { hashAtual: "bbb" })).toBe("desatualizado");
    expect(estadoVisivelDaAba(feita, { hashAtual: "aaa", entradaSuja: true })).toBe("desatualizado");
  });

  it("a hora da última execução prefere o término", () => {
    expect(horaDaUltimaExecucao(exec({
      estado: "concluido",
      iniciado_em: "2026-11-01T12:00:00.000Z",
      terminado_em: "2026-11-01T12:05:00.000Z",
    }))).toBe("2026-11-01T12:05:00.000Z");
  });
});

describe("checklist do que falta para rodar", () => {
  it("renda pede processo; FC e Migra pedem renda confirmada", () => {
    expect(checklistDaAba("renda", { temProcesso: false, rendaConfirmada: false, analiseLigada: true }))
      .toContain("Salve a ficha para abrir o processo.");
    expect(checklistDaAba("fc", { temProcesso: true, rendaConfirmada: false, analiseLigada: true }))
      .toContain("Confirme a renda antes de rodar esta etapa.");
    expect(checklistDaAba("migra", { temProcesso: true, rendaConfirmada: true, analiseLigada: true })).toEqual([]);
    expect(checklistDaAba("renda", { temProcesso: true, rendaConfirmada: false, analiseLigada: false }))
      .toContain("Esta etapa está desligada em Configurações › Locação.");
    expect(checklistDaAba("documentos", { temProcesso: false, rendaConfirmada: false, analiseLigada: false }))
      .toEqual([]);
  });
});
