import { describe, expect, it } from "vitest";

import { classificarCasamento } from "@/lib/superlogica/classificacao";

const c = (id: string, vinculo: string | null = null) => ({
  contact_id: id, chave: "1187654321", vinculoAtivoPessoaId: vinculo,
});
const p = (id: string, qualidade: "exato" | "sem_9" | "ddd_presumido" = "exato") => ({
  superlogica_pessoa_id: id, tipo: "locatario", ativo: true, qualidade,
});

describe("classificação do casamento", () => {
  it("único exato liga sozinho no padrão (a)", () => {
    const r = classificarCasamento(c("a"), [p("1")]);
    expect(r.categoria).toBe("unico_exato");
    expect(r.ligaSozinho).toBe(true);
  });

  it("único parcial vai para revisão", () => {
    const r = classificarCasamento(c("a"), [p("1", "sem_9")]);
    expect(r.categoria).toBe("unico_parcial");
    expect(r.ligaSozinho).toBe(false);
  });

  it("várias pessoas no mesmo número nunca ligam sozinhas", () => {
    const r = classificarCasamento(c("a"), [p("1"), p("2")]);
    expect(r.categoria).toBe("varias_pessoas_um_numero");
    expect(r.ligaSozinho).toBe(false);
  });

  it("já vinculado igual não faz nada; diferente nunca sobrescreve", () => {
    expect(classificarCasamento(c("a", "1"), [p("1")]).categoria).toBe("ja_vinculado_igual");
    const d = classificarCasamento(c("a", "1"), [p("2")]);
    expect(d.categoria).toBe("ja_vinculado_diferente");
    expect(d.ligaSozinho).toBe(false);
  });

  it("número mudou: tinha vínculo e a chave atual não casa", () => {
    expect(classificarCasamento(c("a", "1"), []).categoria).toBe("numero_mudou");
  });
});
