import { describe, expect, it } from "vitest";

import { CAMPO_VAZIO } from "@/lib/locacao/ficha-schema";
import {
  campoLocadorVisivel,
  locadorDoVinculo,
  vinculoEhProprietario,
} from "@/lib/locacao/locador-do-vinculo";

describe("locador do vínculo de proprietário", () => {
  it("só aceita o tipo proprietário", () => {
    expect(vinculoEhProprietario(["locatario"])).toBe(false);
    expect(vinculoEhProprietario(["proprietario"])).toBe(true);
    expect(vinculoEhProprietario([], "proprietario")).toBe(true);
  });

  it("devolve nome e contato mascarados de um vínculo fictício", () => {
    const locador = locadorDoVinculo({
      tipos: ["proprietario"],
      nome: "Maria Proprietária",
      documento: "52998224725",
      contato: "11987654321",
    });
    expect(locador?.nome).toBe("Maria Proprietária");
    expect(locador?.documento_mascarado).toBe("***.***.**7-25");
    expect(locador?.contato_mascarado).toBe("(11) *****-4321");
    expect(locadorDoVinculo({ tipos: ["locatario"], nome: "Outra" })).toBeNull();
  });

  it("manual da ficha vence Superlógica; vazio fica editável", () => {
    const manual = campoLocadorVisivel(
      { ...CAMPO_VAZIO, valor: "João Manual", fonte: "atendente" },
      "Nome Superlógica",
    );
    expect(manual).toMatchObject({ valor: "João Manual", origem: "manual" });
    const sl = campoLocadorVisivel({ ...CAMPO_VAZIO }, "Nome Superlógica");
    expect(sl).toMatchObject({ valor: "Nome Superlógica", origem: "superlogica" });
    const vazio = campoLocadorVisivel({ ...CAMPO_VAZIO }, null);
    expect(vazio).toMatchObject({ valor: "", origem: "vazio", rotulo: "vazio" });
  });
});
