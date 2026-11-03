import {describe, expect, it} from "vitest";
import {fichaVazia, pessoaVazia} from "@/lib/locacao/ficha-schema";
import {fichaTemRendaComprovada, normalizarRendaUtilizada, preencherRendaDeclaradaInicial, preservarEdicoesHumanas, rendaDaPessoa} from "@/lib/locacao/renda-utilizada";

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
  it("reextração vazia preserva valores da conversa e não sobrescreve o atendente", () => {
    const antes = fichaVazia();
    antes.imovel.aluguel = {...antes.imovel.aluguel, valor: 2100, fonte: "conversa"};
    antes.imovel.condominio = {...antes.imovel.condominio, valor: 350, fonte: "conversa"};
    antes.imovel.iptu = {...antes.imovel.iptu, valor: 99, fonte: "atendente"};
    const extraida = fichaVazia();
    extraida.imovel.aluguel.valor = 9999;
    extraida.imovel.aluguel.fonte = "M1";
    const atual = preservarEdicoesHumanas(extraida, antes);
    expect(atual.imovel.aluguel).toMatchObject({ valor: 9999, fonte: "M1" });
    expect(atual.imovel.condominio).toMatchObject({ valor: 350, fonte: "conversa" });
    expect(atual.imovel.iptu).toMatchObject({ valor: 99, fonte: "atendente" });
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
    expect(atual.renda.bloco_calculado?.pacote).toBe(1655);
    expect(atual.renda.bloco_calculado?.tres_vezes_pacote).toBe(4965);
    expect(atual.renda.bloco_calculado?.abaixo_de_3x).toBe(false);
    expect(atual.renda.bloco_calculado?.tabela).toBe("memória documental");
  });
  it("Preencher pela conversa não sobrescreve renda comprovada da análise", () => {
    const comprovada = fichaVazia();
    comprovada.renda.mensal.valor = 7200;
    comprovada.renda.proposta_fc.valor = 7200;
    comprovada.renda.bloco_calculado = {
      comprovada: 7200, declarada: 5000, tabela: "extrato",
      motivo_nao_comprovacao: null, pacote: 2000, tres_vezes_pacote: 6000, abaixo_de_3x: false,
    };
    comprovada.pessoas[0]!.renda_individual = {
      ...comprovada.pessoas[0]!.renda_individual, valor: 7200, fonte: "analise",
    };
    expect(fichaTemRendaComprovada(comprovada)).toBe(true);
    const extraida = fichaVazia();
    extraida.pessoas[0]!.cpf.valor = comprovada.pessoas[0]!.cpf.valor;
    extraida.pessoas[0]!.nome.valor = comprovada.pessoas[0]!.nome.valor;
    extraida.pessoas[0]!.renda_individual = {
      ...extraida.pessoas[0]!.renda_individual, valor: 4000, fonte: "conversa",
    };
    extraida.renda.mensal.valor = 4000;
    const reextraida = preservarEdicoesHumanas(extraida, comprovada);
    expect(reextraida.renda.bloco_calculado?.comprovada).toBe(7200);
    expect(reextraida.renda.mensal.valor).toBe(7200);
    expect(reextraida.pessoas[0]!.renda_individual.valor).toBe(7200);
    const ignorouDeclarada = preencherRendaDeclaradaInicial(comprovada, 300000);
    expect(ignorouDeclarada.renda.bloco_calculado?.comprovada).toBe(7200);
    expect(ignorouDeclarada.pessoas[0]!.renda_individual.valor).toBe(7200);
  });
});
