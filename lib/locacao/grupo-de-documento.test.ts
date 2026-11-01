import { describe, expect, it } from "vitest";

import {
  GRUPOS_DE_DOCUMENTO,
  ROTULOS_DO_GRUPO,
  TEXTO_GRUPO_VAZIO,
  TIPOS_PENDENTES_FICHA_CADASTRAL,
  agruparDocumentos,
  grupoDoDocumento,
  hrefAssinadoDoDocumento,
} from "./grupo-de-documento";

describe("classificação dos documentos por origem", () => {
  it("agrupa anexos da conversa e upload do inquilino", () => {
    expect(grupoDoDocumento({origem: "mensagem", origem_arquivo: "anexo_conversa", categoria: "documento_pessoal"}))
      .toBe("inquilino");
    expect(grupoDoDocumento({origem: "processo", origem_arquivo: "upload_manual", categoria: "comprovante_renda"}))
      .toBe("inquilino");
    expect(grupoDoDocumento({origem: "processo", origem_arquivo: "anexo_conversa", categoria: "outro"}))
      .toBe("inquilino");
  });

  it("agrupa laudo da FC e cotação/consulta da Migra pelos tipos que já existem", () => {
    expect(grupoDoDocumento({origem: "processo", origem_arquivo: "hub_fc", categoria: "laudo_fc"})).toBe("laudo_fc");
    expect(grupoDoDocumento({origem: "processo", origem_arquivo: "manual_assistido", categoria: "laudo_fc"})).toBe("laudo_fc");
    expect(grupoDoDocumento({origem: "processo", origem_arquivo: "hub_migra", categoria: "cotacao_seguro"})).toBe("migra");
    expect(grupoDoDocumento({origem: "processo", origem_arquivo: "manual_assistido", categoria: "cotacao_seguro"})).toBe("migra");
  });

  it("agrupa contrato pela categoria e deixa a ficha cadastral só no tipo ainda inexistente", () => {
    expect(grupoDoDocumento({origem: "processo", origem_arquivo: "relatorio", categoria: "contrato"})).toBe("contrato");
    expect(grupoDoDocumento({
      origem: "processo",
      origem_arquivo: TIPOS_PENDENTES_FICHA_CADASTRAL.origem,
      categoria: TIPOS_PENDENTES_FICHA_CADASTRAL.categoria,
    })).toBe("ficha_cadastral");
    expect(grupoDoDocumento({origem: "processo", origem_arquivo: "relatorio", categoria: "relatorio"}))
      .toBe("inquilino");
  });

  it("mantém a ordem dos cinco grupos e marca vazio com o texto combinado", () => {
    expect([...GRUPOS_DE_DOCUMENTO]).toEqual([
      "inquilino", "ficha_cadastral", "laudo_fc", "migra", "contrato",
    ]);
    const grupos = agruparDocumentos([
      {id: "m1", origem: "mensagem" as const, origem_arquivo: "anexo_conversa", categoria: "outro"},
      {id: "c1", origem: "processo" as const, origem_arquivo: "relatorio", categoria: "contrato"},
    ]);
    expect(grupos.inquilino.map((d) => d.id)).toEqual(["m1"]);
    expect(grupos.contrato.map((d) => d.id)).toEqual(["c1"]);
    expect(grupos.ficha_cadastral).toEqual([]);
    expect(grupos.laudo_fc).toEqual([]);
    expect(grupos.migra).toEqual([]);
    expect(ROTULOS_DO_GRUPO.ficha_cadastral).toBe("Ficha cadastral impressa");
    expect(TEXTO_GRUPO_VAZIO).toBe("nenhum arquivo ainda");
  });

  it("monta a URL same-origin da assinatura sem dado pessoal", () => {
    const conversa = "20000000-0000-4000-8000-000000000001";
    const arquivo = "30000000-0000-4000-8000-000000000001";
    expect(hrefAssinadoDoDocumento({conversationId: conversa, id: arquivo, origem: "mensagem"}))
      .toBe(`/api/v1/conversations/${conversa}/locacao/documentos?arquivo=${arquivo}&origem=mensagem&redirect=1`);
    expect(hrefAssinadoDoDocumento({conversationId: conversa, id: arquivo, origem: "processo", download: true}))
      .toContain("download=1");
    expect(hrefAssinadoDoDocumento({conversationId: conversa, id: arquivo, origem: "mensagem"}))
      .not.toMatch(/@|\+55|cpf/i);
  });
});
