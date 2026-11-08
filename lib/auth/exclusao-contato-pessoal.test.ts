import { describe, expect, it } from "vitest";

import { conversaTemContatoPessoal } from "./exclusao-contato-pessoal";

const ORG = "11111111-1111-4111-8111-111111111111";
const OUTRA = "22222222-2222-4222-8222-222222222222";
const CONV = "aaaaaaaa-1111-4111-8111-111111111111";
const CONTATO = "bbbbbbbb-1111-4111-8111-111111111111";

function banco(linhas: {
  conversations?: Array<Record<string, unknown>>;
  contacts?: Array<Record<string, unknown>>;
}) {
  return {
    from(tabela: string) {
      let rows = (tabela === "conversations" ? linhas.conversations : linhas.contacts) ?? [];
      const q = {
        select: () => q,
        eq(coluna: string, valor: string) {
          rows = rows.filter((r) => r[coluna] === valor);
          return q;
        },
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      };
      return q;
    },
  };
}

describe("conversaTemContatoPessoal (rotas autenticadas por cookie)", () => {
  it("recusa só quando is_personal é true na mesma organização", async () => {
    const db = banco({
      conversations: [{ id: CONV, organization_id: ORG, contact_id: CONTATO }],
      contacts: [{ id: CONTATO, organization_id: ORG, is_personal: true }],
    });
    expect(await conversaTemContatoPessoal(db, ORG, CONV)).toBe(true);
  });

  it("não recusa contato operacional (is_personal false)", async () => {
    const db = banco({
      conversations: [{ id: CONV, organization_id: ORG, contact_id: CONTATO }],
      contacts: [{ id: CONTATO, organization_id: ORG, is_personal: false }],
    });
    expect(await conversaTemContatoPessoal(db, ORG, CONV)).toBe(false);
  });

  it("não recusa quando a marca não veio — operação comum segue", async () => {
    const db = banco({
      conversations: [{ id: CONV, organization_id: ORG, contact_id: CONTATO }],
      contacts: [{ id: CONTATO, organization_id: ORG }],
    });
    expect(await conversaTemContatoPessoal(db, ORG, CONV)).toBe(false);
  });

  it("não trata contato de outra organização como pessoal desta", async () => {
    const db = banco({
      conversations: [{ id: CONV, organization_id: ORG, contact_id: CONTATO }],
      contacts: [{ id: CONTATO, organization_id: OUTRA, is_personal: true }],
    });
    expect(await conversaTemContatoPessoal(db, ORG, CONV)).toBe(false);
  });
});
