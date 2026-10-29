import { describe, expect, it } from "vitest";

import {
  exigirRendaConfirmada,
  processoTemRendaConfirmada,
  TEXTO_SEM_RENDA_CONFIRMADA,
} from "@/lib/locacao/analise/trava";

describe("trava dos botões 2 e 3 sem renda confirmada", () => {
  it("sem timestamp, recusa", () => {
    expect(processoTemRendaConfirmada({})).toBe(false);
    expect(processoTemRendaConfirmada(null)).toBe(false);
    const recusa = exigirRendaConfirmada({ id: "p" });
    expect(recusa?.ok).toBe(false);
    expect(recusa?.texto).toBe(TEXTO_SEM_RENDA_CONFIRMADA);
  });

  it("com renda_confirmada_em, libera", () => {
    expect(processoTemRendaConfirmada({ renda_confirmada_em: "2026-10-28T12:00:00Z" })).toBe(true);
    expect(exigirRendaConfirmada({ renda_confirmada_em: "2026-10-28T12:00:00Z" })).toBeNull();
  });
});
