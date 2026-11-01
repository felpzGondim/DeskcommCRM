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
    expect(ficha.locador.nome.valor).toBeNull();
  });

  it("completa o locador citado na conversa sem inventar documento", () => {
    const ficha = completarFicha({
      locador: { nome: "Maria Locadora", contato: "11987654321" },
    });
    expect(ficha.locador.nome).toMatchObject({ valor: "Maria Locadora", fonte: "conversa" });
    expect(ficha.locador.contato).toMatchObject({ valor: "11987654321", fonte: "conversa" });
    expect(ficha.locador.documento.valor).toBeNull();
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

  it("bloco do imóvel aceita número nu, string BR e preenche origem conversa", () => {
    const ficha = completarFicha({
      imovel: {
        aluguel: 2100,
        condominio: "350,50",
        iptu: { valor: "1.200,00" },
        seguro_incendio: { valor: 85, fonte: "M3", trecho: "seguro 85" },
        logradouro: "Rua das Flores",
        numero: { valor: "100" },
      },
      contrato: { iptu_mensal: 10 },
      garantia: { tipo: "seguro_fianca", valor_mensal: 99 },
      vigencia: { inicio: "2026-11-10", prazo_meses: 30 },
    });
    expect(ficha.imovel.aluguel).toMatchObject({ valor: 2100, fonte: "conversa" });
    expect(ficha.imovel.condominio).toMatchObject({ valor: 350.5, fonte: "conversa" });
    expect(ficha.imovel.iptu).toMatchObject({ valor: 1200, fonte: "conversa" });
    expect(ficha.imovel.seguro_incendio).toMatchObject({ valor: 85, fonte: "M3" });
    expect(ficha.imovel.logradouro).toMatchObject({ valor: "Rua das Flores", fonte: "conversa" });
    expect(ficha.imovel.numero.valor).toBe("100");
    expect(ficha.contrato.iptu_mensal).toMatchObject({ valor: 10, fonte: "conversa" });
    expect(ficha.garantia.tipo).toBe("seguro_fianca");
    expect(ficha.garantia.valor_mensal).toMatchObject({ valor: 99, fonte: "conversa" });
    expect(ficha.vigencia.inicio).toMatchObject({ valor: "2026-11-10", fonte: "conversa" });
    expect(ficha.vigencia.prazo_meses.valor).toBe(30);
  });

  it("não inventa zero nem origem quando o bloco do imóvel veio vazio", () => {
    const ficha = completarFicha({ imovel: { aluguel: {}, condominio: null } });
    expect(ficha.imovel.aluguel).toMatchObject({ valor: null, fonte: null });
    expect(ficha.imovel.condominio).toMatchObject({ valor: null, fonte: null });
  });
});
