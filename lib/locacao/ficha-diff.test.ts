import { describe, expect, it } from "vitest";

import { caminhosAlterados } from "@/lib/locacao/ficha-diff";
import { fichaVazia } from "@/lib/locacao/ficha-schema";

describe("caminhos alterados da ficha", () => {
  it("lista só o caminho, nunca o valor", () => {
    const antes = fichaVazia();
    const depois = fichaVazia();
    depois.pessoas[0]!.email.valor = "ana@example.com";
    depois.imovel.aluguel.valor = 2500;
    const caminhos = caminhosAlterados(antes, depois);
    expect(caminhos).toEqual(["imovel.aluguel.valor", "pessoas[0].email.valor"]);
    expect(caminhos.join(" ")).not.toMatch(/ana@|2500|cpf/i);
  });

  it("ficha igual não lista caminho", () => {
    expect(caminhosAlterados(fichaVazia(), fichaVazia())).toEqual([]);
  });
});
