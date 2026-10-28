import { describe, expect, it } from "vitest";

import { hashCpfDoParticipante, mascararCpf } from "@/lib/locacao/cpf";

describe("cpf do participante", () => {
  it("máscara guarda só o 9º dígito e os dois finais — exemplo fictício", () => {
    expect(mascararCpf("529.982.247-25")).toBe("***.***.**7-25");
    expect(mascararCpf("52998224725")).toBe("***.***.**7-25");
  });

  it("recusa tamanho errado", () => {
    expect(mascararCpf("123")).toBeNull();
    expect(hashCpfDoParticipante("123")).toBeNull();
  });

  it("hash é estável e tem 64 hex", () => {
    const a = hashCpfDoParticipante("52998224725");
    const b = hashCpfDoParticipante("529.982.247-25");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
