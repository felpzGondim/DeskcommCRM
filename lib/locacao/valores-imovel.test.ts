import { describe, expect, it } from "vitest";

import { fichaVazia } from "@/lib/locacao/ficha-schema";
import {
  aplicarEdicaoManual,
  CAMPOS_OBRIGATORIOS_DO_PACOTE,
  centavosParaReais,
  exigirObrigatorios,
  extrairValoresDaConversa,
  lerValoresDaLinha,
  pacote3x,
  preencherValores,
  valoresVazios,
} from "@/lib/locacao/valores-imovel";

function ficticios() {
  const v = valoresVazios();
  v.aluguel = { valor: 2000, origem: "conversa", editado_por: null, editado_em: "2026-10-29T00:00:00.000Z" };
  v.condominio = { valor: 500, origem: "conversa", editado_por: null, editado_em: "2026-10-29T00:00:00.000Z" };
  v.iptu = { valor: 200, origem: "conversa", editado_por: null, editado_em: "2026-10-29T00:00:00.000Z" };
  v.seguro_incendio = { valor: 80, origem: "conversa", editado_por: null, editado_em: "2026-10-29T00:00:00.000Z" };
  v.seguro_fianca = { valor: 150, origem: "conversa", editado_por: null, editado_em: "2026-10-29T00:00:00.000Z" };
  return v;
}

describe("valores do imóvel no processo", () => {
  it("3x soma aluguel+condomínio+IPTU+seguro-incêndio e ignora fiança", () => {
    const p = pacote3x(ficticios());
    expect(p).toEqual({ ok: true, total: 2780, vezes3: 8340 });
  });

  it("3x não fecha se faltar um dos quatro, mesmo com fiança", () => {
    const v = ficticios();
    v.iptu = { valor: null, origem: null, editado_por: null, editado_em: null };
    const p = pacote3x(v);
    expect(p.ok).toBe(false);
    if (p.ok) return;
    expect(p.faltantes).toEqual(["iptu"]);
  });

  it("FC/Migra recusam apontando o campo; fiança ausente não recusa", () => {
    const v = valoresVazios();
    v.aluguel = { valor: 2000, origem: "conversa", editado_por: null, editado_em: null };
    v.condominio = { valor: 500, origem: "conversa", editado_por: null, editado_em: null };
    v.iptu = { valor: 200, origem: "conversa", editado_por: null, editado_em: null };
    expect(exigirObrigatorios(v, "fc")).toMatch(/seguro-incêndio/);
    expect(exigirObrigatorios(v, "seguro")).toMatch(/seguro-incêndio/);
    v.seguro_incendio = { valor: 80, origem: "conversa", editado_por: null, editado_em: null };
    expect(exigirObrigatorios(v, "fc")).toBeNull();
    expect(CAMPOS_OBRIGATORIOS_DO_PACOTE).not.toContain("seguro_fianca");
  });

  it("manual não é sobrescrito por Superlógica nem pela conversa", () => {
    const atuais = valoresVazios();
    atuais.aluguel = { valor: 1999, origem: "manual", editado_por: "u1", editado_em: "2026-10-01T00:00:00.000Z" };
    const r = preencherValores({
      atuais,
      superlogica: { aluguel: 3000, condominio: 400 },
      conversa: { aluguel: 2000, condominio: 500 },
    });
    expect(r.valores.aluguel).toMatchObject({ valor: 1999, origem: "manual", editado_por: "u1" });
    expect(r.valores.condominio).toMatchObject({ valor: 400, origem: "superlogica" });
    expect(r.campos).toEqual(["condominio"]);
  });

  it("Superlógica prevalece sobre a conversa; conversa não sobrescreve Superlógica", () => {
    const primeiro = preencherValores({
      atuais: valoresVazios(),
      superlogica: { aluguel: 3000 },
      conversa: { aluguel: 2000, iptu: 180 },
    });
    expect(primeiro.valores.aluguel).toMatchObject({ valor: 3000, origem: "superlogica" });
    expect(primeiro.valores.iptu).toMatchObject({ valor: 180, origem: "conversa" });
    const segundo = preencherValores({
      atuais: primeiro.valores,
      conversa: { aluguel: 1, iptu: 1 },
    });
    expect(segundo.campos).toEqual([]);
    expect(segundo.valores.aluguel.valor).toBe(3000);
  });

  it("edição humana grava origem manual", () => {
    const r = aplicarEdicaoManual(valoresVazios(), { aluguel: 2500, seguro_fianca: 90 }, "user-1", "2026-10-29T12:00:00.000Z");
    expect(r.campos).toEqual(["aluguel", "seguro_fianca"]);
    expect(r.valores.aluguel).toEqual({
      valor: 2500, origem: "manual", editado_por: "user-1", editado_em: "2026-10-29T12:00:00.000Z",
    });
  });

  it("extrai da ficha e do relatório; numeric do Postgres chega como string", () => {
    const f = fichaVazia();
    f.imovel.aluguel.valor = 2100;
    f.imovel.condominio.valor = 350;
    f.imovel.iptu.valor = 120;
    f.contrato.seguro_fianca_mensal.valor = 99;
    const extraido = extrairValoresDaConversa({
      ficha: f,
      relatorio: "seguro-incêndio: R$ 85,00 por mês.",
    });
    expect(extraido).toMatchObject({
      aluguel: 2100,
      condominio: 350,
      iptu: 120,
      seguro_incendio: 85,
      seguro_fianca: 99,
    });
    const linha = lerValoresDaLinha({
      aluguel: "2000.00",
      aluguel_origem: "superlogica",
      condominio: null,
      condominio_origem: null,
    });
    expect(linha.aluguel).toMatchObject({ valor: 2000, origem: "superlogica" });
    expect(linha.condominio.valor).toBeNull();
    expect(centavosParaReais(200_000)).toBe(2000);
  });
});
