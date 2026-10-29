import { describe, expect, it } from "vitest";

import {
  completarFicha,
  extrairJsonDaIa,
  fichaPreliminarSchema,
  fichaVazia,
  pessoaVazia,
} from "@/lib/locacao/ficha-schema";

describe("ficha preliminar — schema", () => {
  it("a ficha vazia fecha o contrato que as rotas posteriores reusam", () => {
    expect(fichaPreliminarSchema.parse(fichaVazia()).versao).toBe("preliminar-v1");
    expect(fichaVazia().pessoas[0]?.papel).toBe("inquilino");
    expect(fichaVazia().pessoas[0]?.principal).toBe(true);
  });

  it("ficha antiga sem bloco de exclusões fecha com listas vazias", () => {
    const antiga = fichaVazia();
    const bruto = {
      ...antiga,
      renda: {
        mensal: antiga.renda.mensal,
        proposta_fc: antiga.renda.proposta_fc,
        documentos: [],
        alertas: [],
      },
    };
    const parsed = fichaPreliminarSchema.parse(bruto);
    expect(parsed.renda.excluida.autotransferencias).toEqual([]);
    expect(parsed.renda.excluida.familiares).toEqual([]);
    expect(parsed.renda.excluida.familiares_provaveis).toEqual([]);
    expect(parsed.renda.pix_terceiros).toEqual([]);
    expect(parsed.renda.vendas_cartao).toEqual([]);
    expect(parsed.renda.evidencias).toEqual([]);
    expect(parsed.renda.bloco_calculado).toBeNull();
  });

  it("completa o que o modelo omitiu sem inventar valor", () => {
    const ficha = completarFicha({
      pessoas: [{ papel: "contato", nome: { valor: "Ana", fonte: "M1", trecho: "Ana" } }],
      renda: { mensal: { valor: 3000, fonte: "M2", trecho: "3000" } },
    });
    expect(ficha.pessoas[0]?.papel).toBe("contato");
    expect(ficha.pessoas[0]?.nome.valor).toBe("Ana");
    expect(ficha.pessoas[0]?.celular.valor).toBeNull();
    expect(ficha.renda.mensal.valor).toBe(3000);
    expect(ficha.imovel.aluguel.valor).toBeNull();
    expect(ficha.versao).toBe("preliminar-v1");
  });

  it("tira cerca de Markdown e recusa texto sem JSON", () => {
    const obj = extrairJsonDaIa("```json\n{\"relatorio\":\"ok\",\"ficha\":{}}\n```");
    expect(obj).toEqual({ relatorio: "ok", ficha: {} });
    expect(() => extrairJsonDaIa("sem objeto")).toThrow("json_ausente");
  });

  it("pessoa nova nasce com o papel pedido e sem dado pessoal", () => {
    const fiador = pessoaVazia("fiador");
    expect(fiador.papel).toBe("fiador");
    expect(fiador.principal).toBe(false);
    expect(fiador.cpf.valor).toBeNull();
  });
});
