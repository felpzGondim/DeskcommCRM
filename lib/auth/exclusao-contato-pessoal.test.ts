import { describe, expect, it } from "vitest";

import {
  avaliarContatoPessoalDaConversa,
  conversaTemContatoPessoal,
} from "./exclusao-contato-pessoal";

const ORG = "11111111-1111-4111-8111-111111111111";
const OUTRA = "22222222-2222-4222-8222-222222222222";
const CONV = "aaaaaaaa-1111-4111-8111-111111111111";
const CONTATO = "bbbbbbbb-1111-4111-8111-111111111111";

function banco(linhas: {
  conversations?: Array<Record<string, unknown>>;
  contacts?: Array<Record<string, unknown>>;
  erroConversas?: unknown;
  erroContatos?: unknown;
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
        maybeSingle: async () => {
          if (tabela === "conversations" && linhas.erroConversas) {
            return { data: null, error: linhas.erroConversas };
          }
          if (tabela === "contacts" && linhas.erroContatos) {
            return { data: null, error: linhas.erroContatos };
          }
          return { data: rows[0] ?? null, error: null };
        },
      };
      return q;
    },
  };
}

describe("avaliarContatoPessoalDaConversa — fail closed", () => {
  it("permite só is_personal === false na mesma organização", async () => {
    const db = banco({
      conversations: [{ id: CONV, organization_id: ORG, contact_id: CONTATO }],
      contacts: [{ id: CONTATO, organization_id: ORG, is_personal: false }],
    });
    expect(await avaliarContatoPessoalDaConversa(db, ORG, CONV)).toEqual({ recusar: false });
    expect(await conversaTemContatoPessoal(db, ORG, CONV)).toBe(false);
  });

  it("recusa is_personal true", async () => {
    const db = banco({
      conversations: [{ id: CONV, organization_id: ORG, contact_id: CONTATO }],
      contacts: [{ id: CONTATO, organization_id: ORG, is_personal: true }],
    });
    expect(await avaliarContatoPessoalDaConversa(db, ORG, CONV)).toEqual({
      recusar: true,
      motivo: "contato_pessoal",
    });
    expect(await conversaTemContatoPessoal(db, ORG, CONV)).toBe(true);
  });

  it("erro na consulta da conversa não vira operacional", async () => {
    const db = banco({
      conversations: [{ id: CONV, organization_id: ORG, contact_id: CONTATO }],
      contacts: [{ id: CONTATO, organization_id: ORG, is_personal: false }],
      erroConversas: { message: "db" },
    });
    expect(await avaliarContatoPessoalDaConversa(db, ORG, CONV)).toEqual({
      recusar: true,
      motivo: "nao_provado",
    });
  });

  it("erro na consulta do contato não vira operacional", async () => {
    const db = banco({
      conversations: [{ id: CONV, organization_id: ORG, contact_id: CONTATO }],
      contacts: [{ id: CONTATO, organization_id: ORG, is_personal: false }],
      erroContatos: { message: "db" },
    });
    expect(await avaliarContatoPessoalDaConversa(db, ORG, CONV)).toEqual({
      recusar: true,
      motivo: "nao_provado",
    });
  });

  it("conversa ausente recusa", async () => {
    const db = banco({ contacts: [{ id: CONTATO, organization_id: ORG, is_personal: false }] });
    expect(await avaliarContatoPessoalDaConversa(db, ORG, CONV)).toEqual({
      recusar: true,
      motivo: "nao_provado",
    });
  });

  it("contact_id ausente recusa", async () => {
    const db = banco({
      conversations: [{ id: CONV, organization_id: ORG }],
      contacts: [{ id: CONTATO, organization_id: ORG, is_personal: false }],
    });
    expect(await avaliarContatoPessoalDaConversa(db, ORG, CONV)).toEqual({
      recusar: true,
      motivo: "nao_provado",
    });
  });

  it("contato sem linha recusa", async () => {
    const db = banco({
      conversations: [{ id: CONV, organization_id: ORG, contact_id: CONTATO }],
    });
    expect(await avaliarContatoPessoalDaConversa(db, ORG, CONV)).toEqual({
      recusar: true,
      motivo: "nao_provado",
    });
  });

  it("is_personal ausente ou malformado recusa", async () => {
    const semMarca = banco({
      conversations: [{ id: CONV, organization_id: ORG, contact_id: CONTATO }],
      contacts: [{ id: CONTATO, organization_id: ORG }],
    });
    const malformado = banco({
      conversations: [{ id: CONV, organization_id: ORG, contact_id: CONTATO }],
      contacts: [{ id: CONTATO, organization_id: ORG, is_personal: "true" }],
    });
    expect(await avaliarContatoPessoalDaConversa(semMarca, ORG, CONV)).toEqual({
      recusar: true,
      motivo: "nao_provado",
    });
    expect(await avaliarContatoPessoalDaConversa(malformado, ORG, CONV)).toEqual({
      recusar: true,
      motivo: "nao_provado",
    });
  });

  it("contato de outra organização não prova esta", async () => {
    const db = banco({
      conversations: [{ id: CONV, organization_id: ORG, contact_id: CONTATO }],
      contacts: [{ id: CONTATO, organization_id: OUTRA, is_personal: false }],
    });
    expect(await avaliarContatoPessoalDaConversa(db, ORG, CONV)).toEqual({
      recusar: true,
      motivo: "nao_provado",
    });
  });
});
