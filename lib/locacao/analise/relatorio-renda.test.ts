import {describe, expect, it} from "vitest";
import {fichaVazia} from "@/lib/locacao/ficha-schema";
import {montarRelatorioDeRenda} from "@/lib/locacao/analise/relatorio-renda";

describe("relatório documental de renda", () => {
  it("identifica ausência de comprovantes e calcula sobre a RENDA escolhida", () => {
    const ficha = fichaVazia();
    ficha.pessoas[0]!.nome.valor = "Pessoa Teste";
    ficha.pessoas[0]!.renda_individual.valor = 5000;
    ficha.renda.mensal.valor = 5000;
    ficha.imovel.aluguel.valor = 1500;
    const relatorio = montarRelatorioDeRenda(ficha, [], ["Extrato pendente"]);
    expect(relatorio.match(/^## [1-6]\./gm)).toHaveLength(6);
    expect(relatorio).toContain("30.00%");
    expect(relatorio).toContain("Extrato pendente");
    expect(relatorio).toContain("Documentos bancários analisados: 0");
    expect(relatorio).not.toMatch(/risco baixo|aprovado/i);
  });
  it("não calcula comprometimento sem renda positiva e preserva pendências extensas", () => {
    const ficha = fichaVazia();
    const pendencias = Array.from({length: 100}, (_, i) => "Pendência " + i + " · " + "Documento a conferir. ".repeat(5));
    const relatorio = montarRelatorioDeRenda(ficha, [], pendencias);
    expect(relatorio.length).toBeGreaterThan(4000);
    expect(relatorio).toContain("Pendência 99");
    expect(relatorio).toContain("Comprometimento não calculável");
  });
});
