import { describe, expect, it } from "vitest";

import {
  decidirAtualizacaoDeNome,
  formMarcou,
  nomePrincipalVazio,
} from "./atualizar-nome-na-importacao";

describe("nomePrincipalVazio", () => {
  it("trata null, vazio, espaços, telefone e rótulo técnico como vazios", () => {
    expect(nomePrincipalVazio(null)).toBe(true);
    expect(nomePrincipalVazio("")).toBe(true);
    expect(nomePrincipalVazio("   ")).toBe(true);
    expect(nomePrincipalVazio("+55 11 99999-8888")).toBe(true);
    expect(nomePrincipalVazio("5511999998888")).toBe(true);
    expect(nomePrincipalVazio("Contato 5431")).toBe(true);
  });

  it("um nome de gente não é vazio", () => {
    expect(nomePrincipalVazio("Maria da Silva")).toBe(false);
    expect(nomePrincipalVazio("João")).toBe(false);
  });
});

describe("decidirAtualizacaoDeNome", () => {
  it("preenche quando a ficha está vazia e a planilha tem nome", () => {
    expect(decidirAtualizacaoDeNome(null, "Maria da Silva")).toEqual({ tipo: "preencher" });
    expect(decidirAtualizacaoDeNome("", "Maria")).toEqual({ tipo: "preencher" });
    expect(decidirAtualizacaoDeNome("+5511999998888", "Maria")).toEqual({ tipo: "preencher" });
  });

  it("não toca quando a planilha não trouxe nome novo", () => {
    expect(decidirAtualizacaoDeNome(null, null)).toEqual({ tipo: "sem_nome_novo" });
    expect(decidirAtualizacaoDeNome("Maria", "   ")).toEqual({ tipo: "sem_nome_novo" });
    expect(decidirAtualizacaoDeNome("Maria", "+5511999998888")).toEqual({ tipo: "sem_nome_novo" });
  });

  it("mantém o nome da ficha quando é o mesmo da planilha (caixa e espaços)", () => {
    expect(decidirAtualizacaoDeNome("Maria da Silva", "maria da silva")).toEqual({ tipo: "mesmo" });
    expect(decidirAtualizacaoDeNome("  João  ", "joão")).toEqual({ tipo: "mesmo" });
  });

  it("substitui quando a ficha já tem um nome diferente — é o comportamento da opção", () => {
    expect(decidirAtualizacaoDeNome("Carlos", "Carlos Silva")).toEqual({ tipo: "substituir" });
    expect(decidirAtualizacaoDeNome("Ana", "Maria")).toEqual({ tipo: "substituir" });
  });
});

describe("formMarcou", () => {
  it("só liga com os valores explícitos do checkbox", () => {
    expect(formMarcou("true")).toBe(true);
    expect(formMarcou("on")).toBe(true);
    expect(formMarcou("1")).toBe(true);
    expect(formMarcou("false")).toBe(false);
    expect(formMarcou(null)).toBe(false);
    expect(formMarcou("")).toBe(false);
  });
});
