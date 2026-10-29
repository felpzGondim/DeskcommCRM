import { describe, expect, it } from "vitest";

import {
  analiseLigada,
  arquivosLigados,
  driveLigado,
  ehAprovador,
  lerLocacaoSettings,
  pacoteSuperlogicaLigado,
  processosLigados,
  vinculoLigado,
} from "@/lib/locacao/chaves";

describe("chaves de locação", () => {
  it("ausente = desligado", () => {
    expect(processosLigados(null)).toBe(false);
    expect(processosLigados({})).toBe(false);
    expect(arquivosLigados({ locacao: {} })).toBe(false);
    expect(driveLigado({ locacao: { processos_habilitado: true, arquivos_habilitado: true } })).toBe(false);
    expect(vinculoLigado({})).toBe(false);
    expect(pacoteSuperlogicaLigado({})).toBe(false);
  });

  it("drive só liga se processos, arquivos e drive estão true", () => {
    expect(driveLigado({
      locacao: { processos_habilitado: true, arquivos_habilitado: true, drive_habilitado: true },
    })).toBe(true);
    expect(driveLigado({
      locacao: { processos_habilitado: false, arquivos_habilitado: true, drive_habilitado: true },
    })).toBe(false);
  });

  it("aprovador: platform admin ou lista; lista vazia = só o admin da plataforma", () => {
    expect(ehAprovador("u1", true, {})).toBe(true);
    expect(ehAprovador("u1", false, {})).toBe(false);
    const uid = "00000000-0000-4000-8000-000000000001";
    expect(ehAprovador(uid, false, { locacao: { aprovador_user_ids: [uid] } })).toBe(true);
  });

  it("lixo no jsonb não derruba", () => {
    expect(lerLocacaoSettings({ locacao: "x" }).processos_habilitado).toBe(false);
  });

  it("chaves da Fase 4 nascem desligadas e exigem processos", () => {
    expect(analiseLigada(null, "renda")).toBe(false);
    expect(analiseLigada({ locacao: { analise: { renda: true } } }, "renda")).toBe(false);
    expect(analiseLigada({
      locacao: { processos_habilitado: true, analise: { renda: true } },
    }, "renda")).toBe(true);
    expect(analiseLigada({
      locacao: { processos_habilitado: true, analise: { renda: true } },
    }, "seguro")).toBe(false);
    const lido = lerLocacaoSettings({});
    expect(lido.analise.renda).toBe(false);
    expect(lido.analise.seguro).toBe(false);
    expect(lido.analise.fc).toBe(false);
    expect(lido.analise.relatorio).toBe(false);
    expect(lido.analise.manual).toBe(false);
  });
});
