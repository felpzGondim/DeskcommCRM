import { describe, expect, it } from "vitest";

import { hashDaEntradaDaRenda } from "@/lib/locacao/analise/entrada-hash";

const BASE = {
  processoId: "00000000-0000-4000-8000-0000000000aa",
  conversationId: "00000000-0000-4000-8000-0000000000bb",
  fichaVersao: 2,
  mensagens: [
    { id: "m2", media_storage_path: "org/c/b.pdf", media_size_bytes: 20 },
    { id: "m1", media_storage_path: "org/c/a.pdf", media_size_bytes: 10 },
  ],
  senhaNomes: ["extrato.pdf"],
};

describe("hash da entrada da renda", () => {
  it("é estável e muda quando a ficha, o anexo ou o nome da senha mudam", () => {
    const a = hashDaEntradaDaRenda(BASE);
    const b = hashDaEntradaDaRenda({
      ...BASE,
      mensagens: [...BASE.mensagens].reverse(),
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDaEntradaDaRenda({ ...BASE, fichaVersao: 3 })).not.toBe(a);
    expect(
      hashDaEntradaDaRenda({
        ...BASE,
        mensagens: [...BASE.mensagens, { id: "m3", media_storage_path: "org/c/c.pdf" }],
      }),
    ).not.toBe(a);
    expect(hashDaEntradaDaRenda({ ...BASE, senhaNomes: ["outro.pdf"] })).not.toBe(a);
  });

  it("não inclui o valor da senha — só o nome do arquivo", () => {
    const src = hashDaEntradaDaRenda.toString();
    expect(src).not.toMatch(/senha\s*:/);
    expect(JSON.stringify(BASE)).not.toMatch(/1234|segredo/);
  });
});
