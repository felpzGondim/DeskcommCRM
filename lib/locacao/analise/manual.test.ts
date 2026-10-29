import { describe, expect, it } from "vitest";

import { fichaVazia, pessoaVazia } from "@/lib/locacao/ficha-schema";
import { mascararCpf } from "@/lib/locacao/cpf";
import { codigoFc } from "@/lib/locacao/endereco";
import {
  LINK_FC,
  LINK_MIGRA,
  PASSOS_FC,
  PASSOS_MIGRA,
  cpfClaroDaFicha,
  decodificarAnexoManual,
  estadoAbreManual,
  formatarCpf,
  montarDadosParaCopiar,
  pessoaDaFichaParaManual,
  resultadoManualFc,
  resultadoManualSeguro,
  validarCardsManual,
  validarResultadoManualFc,
  vigenciaManual,
} from "./manual";

function fichaPronta() {
  const f = fichaVazia();
  f.pessoas[0]!.nome.valor = "Inquilino Teste";
  f.pessoas[0]!.cpf.valor = "52998224725";
  f.pessoas[0]!.email.valor = "inquilino@exemplo.com";
  f.pessoas[0]!.celular.valor = "11987654321";
  f.imovel.logradouro.valor = "Rua das Flores";
  f.imovel.numero.valor = "100";
  f.imovel.complemento.valor = "ap 12";
  f.imovel.aluguel.valor = 2500;
  f.renda.proposta_fc.valor = 7500;
  const solidario = pessoaVazia("solidario");
  solidario.nome.valor = "Colocatário";
  solidario.cpf.valor = "39053344705";
  f.pessoas.push(solidario);
  return f;
}

describe("manual assistido — mapeamento puro", () => {
  it("só erro e login_necessario abrem o manual", () => {
    expect(estadoAbreManual("erro")).toBe(true);
    expect(estadoAbreManual("login_necessario")).toBe(true);
    expect(estadoAbreManual("solicitada")).toBe(false);
    expect(estadoAbreManual("concluida")).toBe(false);
    expect(estadoAbreManual("aguardando_cobranca")).toBe(false);
    expect(estadoAbreManual(null)).toBe(false);
  });

  it("dados para copiar mascaram o CPF e não trazem o número claro", () => {
    const dados = montarDadosParaCopiar(fichaPronta(), {
      hoje: new Date("2026-10-28T12:00:00Z"),
    });
    const cpf = dados.campos.find((c) => c.chave === "cpf");
    expect(cpf?.sensivel).toBe(true);
    expect(cpf?.valor).toBe(mascararCpf("52998224725"));
    expect(cpf?.valor).not.toContain("52998224725");
    expect(JSON.stringify(dados)).not.toContain("52998224725");
    expect(dados.campos.find((c) => c.chave === "nome")?.valor).toBe("Inquilino Teste");
    expect(dados.campos.find((c) => c.chave === "renda")?.valor).toBe("7500");
    expect(dados.campos.find((c) => c.chave === "codigo_imovel")?.valor).toBe(
      codigoFc({ logradouro: "Rua das Flores", numero: "100", complemento: "ap 12" }),
    );
    expect(dados.solidarios).toEqual([
      { nome: "Colocatário", cpf_mascarado: mascararCpf("39053344705") },
    ]);
    expect(JSON.stringify(dados.solidarios)).not.toContain("39053344705");
    expect(dados.links).toEqual({ fc: LINK_FC, migra: LINK_MIGRA });
    expect(dados.vigencia).toEqual({ inicio: "2026-11-02", fim: "2029-05-02" });
  });

  it("sem renda comprovada omite o campo e não inventa valor", () => {
    const ficha = fichaPronta();
    ficha.renda.mensal.valor = null;
    ficha.renda.proposta_fc.valor = null;
    const dados = montarDadosParaCopiar(ficha);
    expect(dados.campos.find((c) => c.chave === "renda")).toBeUndefined();
    expect(dados.campos.some((c) => c.valor === "0" && c.chave === "renda")).toBe(false);
  });

  it("hash da tentativa que não casa com a ficha não escolhe outra pessoa", () => {
    const ficha = fichaPronta();
    expect(pessoaDaFichaParaManual(ficha, { cpfHash: "hash-de-outra-pessoa" })).toBeNull();
    expect(pessoaDaFichaParaManual(ficha, {})?.nome.valor).toBe("Inquilino Teste");
  });

  it("o CPF claro só sai da ficha no servidor, nunca no bloco de cópia", () => {
    const ficha = fichaPronta();
    const pessoa = ficha.pessoas[0]!;
    expect(cpfClaroDaFicha(pessoa)).toBe("52998224725");
    expect(formatarCpf("52998224725")).toBe("529.982.247-25");
    const dados = montarDadosParaCopiar(ficha);
    expect(dados.campos.some((c) => c.valor.includes("529.982"))).toBe(false);
  });

  it("resultado da FC e cards da Migra usam o mesmo sanitizador do robô", () => {
    expect(validarResultadoManualFc({})).toMatch(/score ou o risco/);
    expect(validarResultadoManualFc({ score: 720, risco: "baixo" })).toBeNull();
    const fc = resultadoManualFc({ score: 720, risco: "baixo", id_fc: "FC-1" }, true);
    expect(fc).toEqual(expect.objectContaining({
      score: 720,
      risco: "baixo",
      id_fc: "FC-1",
      laudo_disponivel: true,
      cobranca: null,
    }));
    expect(fc).not.toHaveProperty("cpf");

    expect(validarCardsManual([])).toMatch(/card/);
    expect(validarCardsManual([{ seguradora: "Porto" }])).toBeNull();
    const seguro = resultadoManualSeguro([
      { seguradora: "Porto", codigo: "ABC", score: 99, cpf: "52998224725" },
    ]);
    expect(seguro.cards).toEqual([
      expect.objectContaining({ seguradora: "Porto", codigo: "ABC" }),
    ]);
    expect(JSON.stringify(seguro)).not.toMatch(/score|52998224725/);
  });

  it("o anexo manual reusa o teto de 2 MB do laudo/print do robô", () => {
    const ok = Buffer.from("%PDF-1.4").toString("base64");
    expect(decodificarAnexoManual({ bytes_b64: ok, mime: "application/pdf" }, "laudo")?.ext).toBe("pdf");
    const grande = Buffer.alloc(2 * 1024 * 1024 + 1, 1).toString("base64");
    expect(decodificarAnexoManual({ bytes_b64: grande, mime: "application/pdf" }, "laudo")).toBeNull();
    expect(PASSOS_FC.some((p) => /SALVAR/i.test(p))).toBe(true);
    expect(PASSOS_MIGRA.some((p) => /Contratar/.test(p))).toBe(true);
    expect(PASSOS_FC.join(" ")).not.toMatch(/R\$|25[,.]30/);
  });
});
