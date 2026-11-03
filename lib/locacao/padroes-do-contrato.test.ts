import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { fichaVazia } from "@/lib/locacao/ficha-schema";
import {
  FONTE_PADRAO,
  INDICE_REAJUSTE_PADRAO,
  TAXA_ADM_PADRAO,
  TAXA_LOCACAO_PADRAO,
  aplicarPadroesDoContrato,
} from "@/lib/locacao/padroes-do-contrato";

describe("padrões de contrato depois do preenchimento pela conversa", () => {
  it("preenche só o que está vazio: D+5, +30 meses, IGPM, 5% e 100%", () => {
    const r = aplicarPadroesDoContrato(fichaVazia(), new Date("2026-11-03T15:00:00.000Z"));
    expect(r.vigencia.inicio).toMatchObject({ valor: "2026-11-08", fonte: FONTE_PADRAO });
    expect(r.vigencia.fim).toMatchObject({ valor: "2029-05-08", fonte: FONTE_PADRAO });
    expect(r.contrato.indice_reajuste).toMatchObject({
      valor: INDICE_REAJUSTE_PADRAO,
      fonte: FONTE_PADRAO,
    });
    expect(r.contrato.taxa_adm).toMatchObject({ valor: TAXA_ADM_PADRAO, fonte: FONTE_PADRAO });
    expect(r.contrato.taxa_locacao).toMatchObject({
      valor: TAXA_LOCACAO_PADRAO,
      fonte: FONTE_PADRAO,
    });
  });

  it("não sobrescreve conversa nem edição manual", () => {
    const f = fichaVazia();
    f.vigencia.inicio = {
      valor: "2026-12-01", fonte: "conversa", trecho: "início em dezembro", confianca: 1, message_id: null,
    };
    f.contrato.indice_reajuste = {
      valor: "IPCA", fonte: "atendente", trecho: null, confianca: 1, message_id: null,
    };
    f.contrato.taxa_adm = {
      valor: 8, fonte: "conversa", trecho: "adm 8", confianca: 1, message_id: null,
    };
    const r = aplicarPadroesDoContrato(f, new Date("2026-11-03T15:00:00.000Z"));
    expect(r.vigencia.inicio).toMatchObject({ valor: "2026-12-01", fonte: "conversa" });
    expect(r.vigencia.fim).toMatchObject({ valor: "2029-06-01", fonte: FONTE_PADRAO });
    expect(r.contrato.indice_reajuste).toMatchObject({ valor: "IPCA", fonte: "atendente" });
    expect(r.contrato.taxa_adm).toMatchObject({ valor: 8, fonte: "conversa" });
    expect(r.contrato.taxa_locacao).toMatchObject({ valor: 100, fonte: FONTE_PADRAO });
  });

  it("Preencher pela conversa aplica os padrões depois de preservar edição humana", () => {
    const src = readFileSync(join(process.cwd(), "lib/painel/acoes/ficha.ts"), "utf8");
    const preservar = src.indexOf("preservarEdicoesHumanas(");
    const padroes = src.indexOf("aplicarPadroesDoContrato(");
    expect(preservar).toBeGreaterThan(0);
    expect(padroes).toBeGreaterThan(preservar);
  });
});
