import { describe, expect, it } from "vitest";

import {
  MOTIVOS_RENDA,
  fraseDoMotivoDeLeitura,
  motivoDeLeituraDoErro,
} from "@/lib/locacao/analise/motivos-renda";

describe("motivos da renda", () => {
  it("402, timeout e senha viram frase simples; falha genérica é leitura de imagem", () => {
    expect(motivoDeLeituraDoErro(new Error("402 Payment Required"))).toBe("sem_credito");
    expect(motivoDeLeituraDoErro(new Error("AbortError: timeout"))).toBe("timeout");
    expect(motivoDeLeituraDoErro(new Error("PasswordException"))).toBe("senha");
    expect(motivoDeLeituraDoErro(new Error("boom"))).toBe("falha");
    expect(fraseDoMotivoDeLeitura("sem_credito")).toBe(MOTIVOS_RENDA.leitura_imagem_falhou);
    expect(fraseDoMotivoDeLeitura("ilegivel")).toBe(MOTIVOS_RENDA.extrato_ilegivel);
    expect(fraseDoMotivoDeLeitura("timeout")).toBe(MOTIVOS_RENDA.timeout);
    expect(fraseDoMotivoDeLeitura("senha")).toBe(MOTIVOS_RENDA.pdf_senha);
  });

  it("nenhum motivo fica vazio", () => {
    for (const frase of Object.values(MOTIVOS_RENDA)) {
      expect(frase.trim().length).toBeGreaterThan(3);
    }
  });
});
