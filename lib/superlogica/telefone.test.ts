import { describe, expect, it } from "vitest";

import {
  chaveTelefone,
  qualidadeDoCasamento,
  separarNumeros,
} from "@/lib/superlogica/telefone";

describe("chave_telefone (espelho do Hub)", () => {
  const casos = [
    "+55 11 98765-4321",
    "11 98765-4321",
    "011 8765-4321",
    "8765-4321",
  ];
  it("os quatro formatos fictícios dão a mesma chave 1187654321", () => {
    for (const c of casos) {
      expect(chaveTelefone(c)?.chave, c).toBe("1187654321");
    }
  });

  it("sem DDD marca dddPresumido", () => {
    expect(chaveTelefone("8765-4321")?.dddPresumido).toBe(true);
    expect(chaveTelefone("11 98765-4321")?.dddPresumido).toBe(false);
  });

  it("DDD inválido e celular de 9 que não começa com 9 recusam", () => {
    expect(chaveTelefone("00 98765-4321")).toBeNull();
    expect(chaveTelefone("11 18765-4321")).toBeNull();
  });

  it("separa vários números no mesmo campo", () => {
    expect(separarNumeros("11 9999-0000; 11 3333-4444").length).toBe(2);
  });

  it("qualidade: exato / sem_9 / ddd_presumido", () => {
    const a = chaveTelefone("11 98765-4321")!;
    const b = chaveTelefone("11 8765-4321")!;
    const c = chaveTelefone("8765-4321")!;
    expect(qualidadeDoCasamento(a, a)).toBe("exato");
    expect(qualidadeDoCasamento(a, b)).toBe("sem_9");
    expect(qualidadeDoCasamento(a, c)).toBe("ddd_presumido");
  });
});
