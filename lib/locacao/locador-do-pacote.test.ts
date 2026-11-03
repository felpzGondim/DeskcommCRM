import { describe, expect, it } from "vitest";

import { CAMPO_VAZIO, fichaVazia } from "@/lib/locacao/ficha-schema";
import {
  AVISO_HUB_INDISPONIVEL,
  AVISO_IMOVEL_NAO_ENCONTRADO,
  avisoDoStatusDoPacote,
  buscaDoImovel,
  locadorMascaradoDoProprietario,
  preencherLocadorNaFicha,
  rotuloDoCandidato,
} from "@/lib/locacao/locador-do-pacote";

const PROPRIETARIO = {
  nome: "Maria Locadora",
  cpfCnpj: "52998224725",
  idPessoa: "9",
  email: "maria@exemplo.test",
  telefone: "11987654321",
};

describe("busca e locador do pacote Superlógica", () => {
  it("monta a busca pelo endereço; código só quando falta o logradouro", () => {
    expect(buscaDoImovel({
      logradouro: "Rua Exemplo",
      numero: "100",
      complemento: "ap 12",
      cep: "01310-100",
      codigo: "SL-77",
    })).toBe("Rua Exemplo, 100, ap 12 01310-100");
    expect(buscaDoImovel({ codigo: "SL-77" })).toBe("SL-77");
    expect(buscaDoImovel({})).toBeNull();
  });

  it("preenche o locador vazio com origem Superlógica e não sobrescreve manual", () => {
    const vazia = fichaVazia();
    const preenchida = preencherLocadorNaFicha(vazia, PROPRIETARIO);
    expect(preenchida.locador.nome).toMatchObject({ valor: "Maria Locadora", fonte: "superlogica" });
    expect(preenchida.locador.documento).toMatchObject({ valor: "52998224725", fonte: "superlogica" });
    expect(preenchida.locador.contato).toMatchObject({ valor: "11987654321", fonte: "superlogica" });

    const manual = fichaVazia();
    manual.locador.nome = { ...CAMPO_VAZIO, valor: "João Manual", fonte: "atendente" };
    const mantida = preencherLocadorNaFicha(manual, PROPRIETARIO);
    expect(mantida.locador.nome).toMatchObject({ valor: "João Manual", fonte: "atendente" });
    expect(mantida.locador.documento.fonte).toBe("superlogica");
  });

  it("máscara do proprietário não devolve documento ou contato inteiros", () => {
    const locador = locadorMascaradoDoProprietario(PROPRIETARIO);
    expect(locador?.nome).toBe("Maria Locadora");
    expect(locador?.documento_mascarado).toBe("***.***.**7-25");
    expect(locador?.contato_mascarado).toBe("(11) *****-4321");
    expect(JSON.stringify(locador)).not.toMatch(/52998224725|11987654321/);
  });

  it("avisos distinguem hub fora, não encontrado e candidatos", () => {
    expect(avisoDoStatusDoPacote("indisponivel")).toBe(AVISO_HUB_INDISPONIVEL);
    expect(avisoDoStatusDoPacote("nao_encontrado")).toBe(AVISO_IMOVEL_NAO_ENCONTRADO);
    expect(avisoDoStatusDoPacote("candidatos")).toMatch(/Escolha um/);
    expect(avisoDoStatusDoPacote("ok")).toBeNull();
  });

  it("rótulo do candidato não inclui dado de pessoa", () => {
    expect(rotuloDoCandidato({
      id_imovel: 11,
      codigo: "A-1",
      endereco: "Rua Um, 10",
      cep: "01310-100",
    })).toBe("Rua Um, 10 · A-1 · 01310-100");
  });
});
