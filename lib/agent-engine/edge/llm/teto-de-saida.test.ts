import { describe, expect, it } from "vitest";

import { TETO_DE_SAIDA_PADRAO, tetoDeSaida } from "./run-model-call";

describe("tetoDeSaida", () => {
  it("sem teto da organização nem da chamada, usa o padrão em vez de pedir o máximo do modelo", () => {
    expect(tetoDeSaida(undefined, undefined)).toBe(TETO_DE_SAIDA_PADRAO);
  });

  it("o teto da organização vence o padrão, para mais ou para menos", () => {
    expect(tetoDeSaida(16000, undefined)).toBe(16000);
    expect(tetoDeSaida(1000, undefined)).toBe(1000);
  });

  it("sem teto da organização, a chamada pode alargar o padrão", () => {
    expect(tetoDeSaida(undefined, 256)).toBe(256);
    expect(tetoDeSaida(undefined, 9000)).toBe(9000);
    expect(tetoDeSaida(16000, 9000)).toBe(9000);
  });

  it("o teto da organização vence a chamada, para mais ou para menos", () => {
    expect(tetoDeSaida(2000, 9000)).toBe(2000);
    expect(tetoDeSaida(16000, 9000)).toBe(9000);
  });
});
