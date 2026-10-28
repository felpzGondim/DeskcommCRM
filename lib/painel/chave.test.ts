import { describe, expect, it } from "vitest";

import { ferramentasDoPainelLigadas, lerPainelAgenteSettings } from "./chave";

describe("chave do campo /pergunta", () => {
  it("ausente ou lixo = desligada", () => {
    expect(ferramentasDoPainelLigadas(undefined)).toBe(false);
    expect(ferramentasDoPainelLigadas(null)).toBe(false);
    expect(ferramentasDoPainelLigadas({ painel_agente: { ferramentas_habilitado: "sim" } })).toBe(false);
    expect(lerPainelAgenteSettings({ painel_agente: { ferramentas_habilitado: true } }).ferramentas_habilitado).toBe(true);
  });
});
