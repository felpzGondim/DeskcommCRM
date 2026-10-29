import { describe, expect, it } from "vitest";

import {
  FRASE_PACOTE_AUSENTE,
  leitorSuperlogicaDesligado,
  lerSeguroIncendioNoTexto,
  montarPacote,
  textoDoPacote,
} from "./pacote";

describe("pacote 3x da locação", () => {
  it("3x = aluguel + condomínio + IPTU + seguro-incêndio, sem fiança", () => {
    const p = montarPacote({
      conversa: {
        aluguelCentavos: 200_000,
        condominioCentavos: 50_000,
        iptuCentavos: 20_000,
        seguroIncendioCentavos: 10_000,
      },
    });
    expect(p.totalCentavos).toBe(280_000);
    expect(p.vezes3Centavos).toBe(840_000);
    expect(textoDoPacote(p)).toMatch(/seguro-incêndio/);
    expect(textoDoPacote(p)).toMatch(/sem seguro-fiança/);
    expect(textoDoPacote(p)).not.toMatch(/fiança: R\$/);
  });

  it("componente ausente é declarado, não some em silêncio", () => {
    const p = montarPacote({
      conversa: { aluguelCentavos: 200_000, condominioCentavos: 50_000 },
    });
    expect(p.faltantes).toEqual(expect.arrayContaining(["IPTU", "seguro-incêndio"]));
    expect(textoDoPacote(p)).toMatch(/IPTU: a informação IPTU não foi encontrada/);
    expect(p.vezes3Centavos).toBe(3 * (200_000 + 50_000));
  });

  it("sem aluguel não calcula 3x", () => {
    const p = montarPacote({ conversa: { condominioCentavos: 50_000 } });
    expect(p.vezes3Centavos).toBeNull();
    expect(textoDoPacote(p)).toContain(FRASE_PACOTE_AUSENTE);
  });

  it("Superlógica prevalece sobre a conversa quando o leitor devolve valor", () => {
    const p = montarPacote({
      superlogica: { aluguelCentavos: 300_000, iptuCentavos: 15_000 },
      conversa: { aluguelCentavos: 200_000, condominioCentavos: 40_000, iptuCentavos: 10_000 },
    });
    expect(p.aluguel).toEqual({ valorCentavos: 300_000, origem: "superlogica" });
    expect(p.condominio).toEqual({ valorCentavos: 40_000, origem: "conversa" });
    expect(p.iptu).toEqual({ valorCentavos: 15_000, origem: "superlogica" });
  });

  it("leitor desligado não inventa endpoint nem credencial", async () => {
    expect(await leitorSuperlogicaDesligado().ler({ orgId: "o", contactId: "c" })).toBeNull();
  });

  it("lê seguro-incêndio no texto da conversa", () => {
    expect(lerSeguroIncendioNoTexto("seguro incêndio R$ 85,00")).toBe(8_500);
  });
});
