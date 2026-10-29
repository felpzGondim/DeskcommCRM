import {describe, expect, it} from "vitest";
import {fichaVazia, pessoaVazia} from "@/lib/locacao/ficha-schema";
import {normalizarRendaUtilizada, preencherRendaDeclaradaInicial, preservarEdicoesHumanas, rendaDaPessoa} from "@/lib/locacao/renda-utilizada";

describe("RENDA compartilhada na esteira", () => {
  it("migra a renda declarada legada quando existe uma única pessoa", () => {
    const ficha = fichaVazia(); ficha.renda.mensal.valor = 5000; ficha.renda.proposta_fc.valor = 9000;
    const atual = normalizarRendaUtilizada(ficha);
    expect(atual.pessoas[0]!.renda_individual.valor).toBe(5000);
    expect(atual.renda.proposta_fc.valor).toBe(5000);
  });
  it("não transfere a renda de um candidato para outro", () => {
    const ficha = fichaVazia(); ficha.pessoas.push(pessoaVazia("solidario")); ficha.renda.mensal.valor = 5000;
    expect(rendaDaPessoa(ficha, ficha.pessoas[1]!)).toBeNull();
    expect(normalizarRendaUtilizada(ficha).renda.mensal.valor).toBeNull();
  });
  it("utiliza o valor individual e calcula o total sem a renda do fiador", () => {
    const ficha = fichaVazia(); ficha.pessoas[0]!.renda_individual.valor = 5000;
    const solidario = pessoaVazia("solidario"); solidario.renda_individual.valor = 3000;
    const fiador = pessoaVazia("fiador"); fiador.renda_individual.valor = 20000;
    ficha.pessoas.push(solidario, fiador);
    expect(normalizarRendaUtilizada(ficha).renda.mensal.valor).toBe(8000);
    expect(rendaDaPessoa(ficha, fiador)).toBe(20000);
  });
  it("reextração preserva renda e aluguel corrigidos manualmente", () => {
    const antes = fichaVazia();
    antes.pessoas[0]!.cpf.valor = "52998224725";
    antes.pessoas[0]!.renda_individual = {...antes.pessoas[0]!.renda_individual, valor: 5000, fonte: "atendente"};
    antes.imovel.aluguel = {...antes.imovel.aluguel, valor: 1500, fonte: "atendente"};
    const extraida = structuredClone(antes); extraida.pessoas[0]!.renda_individual.valor = 20000; extraida.imovel.aluguel.valor = 3000;
    const atual = preservarEdicoesHumanas(extraida, antes);
    expect(atual.pessoas[0]!.renda_individual.valor).toBe(5000);
    expect(atual.imovel.aluguel.valor).toBe(1500);
    expect(atual.renda.proposta_fc.valor).toBe(5000);
  });
  it("inicia pela renda declarada e permite limpá-la manualmente", () => {
    const inicial = preencherRendaDeclaradaInicial(fichaVazia(), 500000);
    expect(inicial.pessoas[0]!.renda_individual.valor).toBe(5000);
    inicial.pessoas[0]!.renda_individual = {...inicial.pessoas[0]!.renda_individual, valor: null, fonte: "atendente"};
    const limpa = normalizarRendaUtilizada(inicial);
    expect(limpa.pessoas[0]!.renda_individual.valor).toBeNull();
    expect(limpa.renda.mensal.valor).toBeNull();
  });
  it("recalcula o pacote quando os valores da locação são corrigidos", () => {
    const ficha = fichaVazia();
    ficha.imovel.aluguel = {...ficha.imovel.aluguel, valor: 1500, fonte: "atendente"};
    ficha.imovel.condominio.valor = 85; ficha.imovel.iptu.valor = 70; ficha.imovel.seguro_incendio.valor = 20;
    ficha.renda.bloco_calculado = {comprovada: 6000, declarada: 5000, tabela: "memória documental",
      motivo_nao_comprovacao: null, pacote: 9999, tres_vezes_pacote: 29997, abaixo_de_3x: true};
    const atual = normalizarRendaUtilizada(ficha);
    expect(atual.renda.bloco_calculado?.pacote).toBe(1675);
    expect(atual.renda.bloco_calculado?.tres_vezes_pacote).toBe(5025);
    expect(atual.renda.bloco_calculado?.abaixo_de_3x).toBe(false);
    expect(atual.renda.bloco_calculado?.tabela).toBe("memória documental");
  });
});
