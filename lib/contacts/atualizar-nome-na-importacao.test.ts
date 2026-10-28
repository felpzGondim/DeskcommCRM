import { describe, expect, it } from "vitest";

import {
  decidirAtualizacaoDeNome,
  formMarcouAtualizar,
  lerIdsDeSubstituicao,
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

  it("é conflito quando a ficha já tem um nome diferente — não sobrescreve sozinha", () => {
    expect(decidirAtualizacaoDeNome("Carlos", "Carlos Silva")).toEqual({ tipo: "conflito" });
    expect(decidirAtualizacaoDeNome("Ana", "Maria")).toEqual({ tipo: "conflito" });
  });
});

describe("lerIdsDeSubstituicao", () => {
  const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  it("lê só UUID v4 válidos de um JSON de array", () => {
    expect([...lerIdsDeSubstituicao(JSON.stringify([A, B, "nao-e-uuid", 3]))].sort()).toEqual(
      [A, B].sort(),
    );
  });

  it("lixo, objeto e JSON quebrado não confirmam ninguém", () => {
    expect(lerIdsDeSubstituicao("")).toEqual(new Set());
    expect(lerIdsDeSubstituicao("{")).toEqual(new Set());
    expect(lerIdsDeSubstituicao('{"id":"x"}')).toEqual(new Set());
    expect(lerIdsDeSubstituicao(null)).toEqual(new Set());
  });
});

describe("formMarcouAtualizar", () => {
  it("só liga com os valores explícitos do checkbox", () => {
    expect(formMarcouAtualizar("true")).toBe(true);
    expect(formMarcouAtualizar("on")).toBe(true);
    expect(formMarcouAtualizar("1")).toBe(true);
    expect(formMarcouAtualizar("false")).toBe(false);
    expect(formMarcouAtualizar(null)).toBe(false);
    expect(formMarcouAtualizar("")).toBe(false);
  });
});
