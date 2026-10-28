import { describe, expect, it } from "vitest";

import { parseCsv } from "@/lib/contacts/csv";
import {
  emailDaLinhaGoogle,
  expandirLinhaGoogle,
  indicesGoogleContatos,
  nomeDaLinhaGoogle,
  telefonesDaLinhaGoogle,
} from "@/lib/contacts/planilha-google";

/**
 * CSVs FICTÍCIOS — nomes e números de exemplo, nenhum dado real.
 * O formato copia o que o Google Contatos exporta (EN e PT).
 */
const CSV_EN = [
  "Name,Given Name,Additional Name,Family Name,E-mail 1 - Value,Phone 1 - Value,Phone 2 - Value",
  '"Maria Souza","Maria","","Souza",maria.souza.exemplo@example.com,"+55 11 90000-0001 ::: +55 11 90000-0002","+55 21 90000-0003"',
  ',"João","Carlos","Silva",joao.silva.exemplo@example.com,"(11) 90000-0004",',
].join("\n");

const CSV_PT = [
  "Nome,Nome do meio,Sobrenome,E-mail 1 - Valor,Telefone 1 - Valor,Telefone 2 - Valor",
  '"Ana Lima","","Lima",ana.lima.exemplo@example.com,"+55 11 91111-0001",',
  ',"Pedro","Santos",,"(21) 91111-0002 ::: (21) 91111-0003"',
].join("\n");

const CSV_FIRST_LAST = [
  "First Name,Middle Name,Last Name,Phone 1 - Value",
  "Carla,Beatriz,Nunes,+5511922220001",
].join("\n");

const CSV_GIVEN_FAMILY = [
  "Given Name,Family Name,Phone 1 - Value",
  "Diego,Ramos,+5511933330001",
].join("\n");

describe("detecção pelo cabeçalho do Google Contatos", () => {
  it("reconhece o export em inglês", () => {
    const header = parseCsv(CSV_EN)[0]!;
    const i = indicesGoogleContatos(header);
    expect(i).not.toBeNull();
    expect(i?.nomeCompleto).toBe(0);
    expect(i?.primeiro).toBe(1);
    expect(i?.meio).toBe(2);
    expect(i?.sobrenome).toBe(3);
    expect(i?.emails).toEqual([4]);
    expect(i?.telefones).toEqual([5, 6]);
  });

  it("reconhece o export em português", () => {
    const header = parseCsv(CSV_PT)[0]!;
    const i = indicesGoogleContatos(header);
    expect(i).not.toBeNull();
    expect(i?.nomeCompleto).toBe(0);
    expect(i?.meio).toBe(1);
    expect(i?.sobrenome).toBe(2);
    expect(i?.emails).toEqual([3]);
    expect(i?.telefones).toEqual([4, 5]);
  });

  it("planilha simples desta casa não é Google", () => {
    expect(indicesGoogleContatos(["nome", "telefone", "email"])).toBeNull();
    expect(indicesGoogleContatos(["Name", "Phone", "Email"])).toBeNull();
  });
});

describe("nome da linha — Name/Nome ou junção das partes", () => {
  it("usa Name quando a coluna está preenchida", () => {
    const rows = parseCsv(CSV_EN);
    const i = indicesGoogleContatos(rows[0]!)!;
    expect(nomeDaLinhaGoogle(rows[1]!, i)).toBe("Maria Souza");
  });

  it("junta Given + Additional + Family quando Name veio vazio", () => {
    const rows = parseCsv(CSV_EN);
    const i = indicesGoogleContatos(rows[0]!)!;
    expect(nomeDaLinhaGoogle(rows[2]!, i)).toBe("João Carlos Silva");
  });

  it("export PT: Nome preenchido; Nome vazio junta meio + sobrenome", () => {
    const rows = parseCsv(CSV_PT);
    const i = indicesGoogleContatos(rows[0]!)!;
    expect(nomeDaLinhaGoogle(rows[1]!, i)).toBe("Ana Lima");
    expect(nomeDaLinhaGoogle(rows[2]!, i)).toBe("Pedro Santos");
  });

  it("First + Middle + Last e Given + Family", () => {
    const first = parseCsv(CSV_FIRST_LAST);
    expect(nomeDaLinhaGoogle(first[1]!, indicesGoogleContatos(first[0]!)!)).toBe("Carla Beatriz Nunes");
    const given = parseCsv(CSV_GIVEN_FAMILY);
    expect(nomeDaLinhaGoogle(given[1]!, indicesGoogleContatos(given[0]!)!)).toBe("Diego Ramos");
  });

  it("Nome só com o primeiro e Sobrenome ao lado vira nome completo", () => {
    const i = indicesGoogleContatos(["Nome", "Sobrenome", "Telefone 1 - Valor"])!;
    expect(nomeDaLinhaGoogle(["Bia", "Costa", "+5511944440001"], i)).toBe("Bia Costa");
  });
});

describe("telefones — Phone N - Value / Telefone N - Valor e o separador :::", () => {
  it("inglês: duas colunas e uma célula com ::: viram três números distintos", () => {
    const rows = parseCsv(CSV_EN);
    const i = indicesGoogleContatos(rows[0]!)!;
    expect(telefonesDaLinhaGoogle(rows[1]!, i)).toEqual([
      "+5511900000001",
      "+5511900000002",
      "+5521900000003",
    ]);
  });

  it("português: ::: na mesma célula", () => {
    const rows = parseCsv(CSV_PT);
    const i = indicesGoogleContatos(rows[0]!)!;
    expect(telefonesDaLinhaGoogle(rows[2]!, i)).toEqual(["+5521911110002", "+5521911110003"]);
  });

  it("e-mail da primeira coluna E-mail N válida", () => {
    const rows = parseCsv(CSV_EN);
    const i = indicesGoogleContatos(rows[0]!)!;
    expect(emailDaLinhaGoogle(rows[1]!, i)).toBe("maria.souza.exemplo@example.com");
  });
});

describe("uma linha do Google vira um contato por telefone", () => {
  it("três números, o mesmo nome e o mesmo e-mail", () => {
    const rows = parseCsv(CSV_EN);
    const i = indicesGoogleContatos(rows[0]!)!;
    const { contatos, motivo } = expandirLinhaGoogle(rows[1]!, i);
    expect(motivo).toBeNull();
    expect(contatos).toHaveLength(3);
    expect(contatos.map((c) => c.phone_number)).toEqual([
      "+5511900000001",
      "+5511900000002",
      "+5521900000003",
    ]);
    expect(new Set(contatos.map((c) => c.name))).toEqual(new Set(["Maria Souza"]));
    expect(contatos[0]?.email).toBe("maria.souza.exemplo@example.com");
    expect(contatos.slice(1).every((c) => c.email === undefined)).toBe(true);
  });

  it("linha sem telefone e sem e-mail é pulada", () => {
    const i = indicesGoogleContatos(["Name", "Phone 1 - Value"])!;
    const { contatos, motivo } = expandirLinhaGoogle(["Alguém", ""], i);
    expect(contatos).toEqual([]);
    expect(motivo).toMatch(/sem telefone nem e-mail/);
  });
});
