import { describe, expect, it } from "vitest";

import {
  ABAS_DA_EXECUCAO,
  CATEGORIAS_DE_DOCUMENTO,
  CHAVES_DA_ANALISE,
  ESTADOS_DA_ANALISE_FC,
  ESTADOS_DA_ANALISE_SEGURO,
  ESTADOS_DA_EXECUCAO,
  ORIGENS_DA_ANALISE,
  ORIGENS_DA_EXECUCAO,
  ORIGENS_DA_FICHA_DO_PROCESSO,
  ORIGENS_DO_DOCUMENTO,
  ORIGENS_DO_VALOR_DO_IMOVEL,
  TIPOS_DE_EVENTO_DO_PROCESSO,
} from "@/lib/locacao/vocabulario";

describe("vocabulário da Fase 4", () => {
  it("eventos renda e relatorio existem; Contratar não existe", () => {
    expect(TIPOS_DE_EVENTO_DO_PROCESSO).toContain("renda");
    expect(TIPOS_DE_EVENTO_DO_PROCESSO).toContain("relatorio");
    expect(TIPOS_DE_EVENTO_DO_PROCESSO).toContain("valores_imovel");
    expect(TIPOS_DE_EVENTO_DO_PROCESSO as readonly string[]).not.toContain("contratar");
    expect(ORIGENS_DO_VALOR_DO_IMOVEL).toEqual(["superlogica", "conversa", "manual"]);
  });

  it("seguro e FC compartilham origem hub|manual e login_necessario", () => {
    expect(ORIGENS_DA_ANALISE).toEqual(["hub", "manual"]);
    expect(ESTADOS_DA_ANALISE_FC).toContain("login_necessario");
    expect(ESTADOS_DA_ANALISE_SEGURO).toContain("login_necessario");
    expect(ESTADOS_DA_ANALISE_SEGURO).not.toContain("aguardando_cobranca");
  });

  it("ficha e documento aceitam origem manual / manual_assistido", () => {
    expect(ORIGENS_DA_FICHA_DO_PROCESSO).toContain("manual");
    expect(ORIGENS_DO_DOCUMENTO).toContain("manual_assistido");
  });

  it("as cinco chaves da análise são as do plano, sem preço", () => {
    expect(CHAVES_DA_ANALISE).toEqual(["renda", "seguro", "fc", "relatorio", "manual"]);
    expect(CHAVES_DA_ANALISE as readonly string[]).not.toContain("fc_preco");
  });

  it("execução por aba e ficha cadastral impressa (0772)", () => {
    expect(ABAS_DA_EXECUCAO).toContain("documentos");
    expect(ESTADOS_DA_EXECUCAO).toContain("na_fila");
    expect(ESTADOS_DA_EXECUCAO).toContain("desatualizado");
    expect(ORIGENS_DA_EXECUCAO).toEqual(["botao", "chat"]);
    expect(CATEGORIAS_DE_DOCUMENTO).toContain("ficha_cadastral");
    expect(CATEGORIAS_DE_DOCUMENTO).toContain("ficha_migra");
    expect(ORIGENS_DO_DOCUMENTO).toContain("ficha_cadastral");
    expect(ORIGENS_DO_DOCUMENTO).toContain("contrato");
  });
});
