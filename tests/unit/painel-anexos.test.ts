import { describe, expect, it } from "vitest";

import {
  LIMITES_ANEXOS_PADRAO,
  ehDescricaoGenericaDeMidia,
  janelaUtilDaAnalise,
  limitesDaAnalise,
  textoCombinadoDaMensagem,
} from "@/lib/agent-engine/agent/painel-anexos-limites";
import { montarFichaTemporaria } from "@/lib/agent-engine/agent/painel-acoes-hub";
import { ferramentaAceitaArquivos } from "@/lib/agent-engine/agent/painel-arquivos-hub";
import { avisosDosAnexos, frasesDosAvisos } from "@/lib/agent-engine/agent/painel-leitura-anexos";
import { fontesDaAnalise, pendenciasDaPrevia, previaSchema } from "@/lib/agent-engine/agent/painel-analise-preparo";
import { ehErroDeSenhaDePdf } from "@/lib/ai/rag/extractors/pdf-senha";
import { PdfExtractError } from "@/lib/ai/rag/extractors/pdf";

const previa = previaSchema.parse({
  candidato: { nome: { valor: "Maria", fonte: "M1", trecho: "Maria" }, cpf: { valor: "52998224725", fonte: "M1", trecho: "52998224725" },
    email: { valor: "maria@example.com", fonte: "M1", trecho: "maria@example.com" } },
  imovel: { codigo_fc: { valor: "A10", fonte: "M1", trecho: "A10" }, logradouro: { valor: null, fonte: null, trecho: null },
    apartamento: { valor: null, fonte: null, trecho: null }, aluguel: { valor: 1200, fonte: "M1", trecho: "1200" } },
  renda: { mensal: { valor: 4000, fonte: "M2", trecho: "4000" }, documentos: [
    { fonte: "M2", tipo: "holerite", periodo: "10/2026", resumo: "Renda líquida", valor_comprovado: 4000 },
  ] }, pendencias: [],
});

describe("texto combinado da mensagem (bug da legenda)", () => {
  it("junta legenda e texto derivado em vez de descartar o derivado", () => {
    expect(textoCombinadoDaMensagem("holerite", "renda liquida 4000")).toBe("holerite\nrenda liquida 4000");
    expect(textoCombinadoDaMensagem("holerite", "")).toBe("holerite");
    expect(textoCombinadoDaMensagem("", "renda liquida 4000")).toBe("renda liquida 4000");
    expect(textoCombinadoDaMensagem(null, "ocr")).toBe("ocr");
  });

  it("a fonte da análise usa os dois textos também na imagem", () => {
    const fontes = fontesDaAnalise([{
      type: "image", body: "meu holerite", media_derived_status: "ready",
      media_derived_text: "renda liquida 4000", leitura_documental: true,
    }]);
    expect(fontes[0]?.texto).toContain("meu holerite");
    expect(fontes[0]?.texto).toContain("renda liquida 4000");
    expect(fontes[0]?.legivel).toBe(true);
  });

  it("descrição genérica do worker não libera confirmação", () => {
    const fontes = fontesDaAnalise([{
      type: "image", body: "foto", media_derived_status: "ready",
      media_derived_text: "Parece um extrato",
    }]);
    expect(fontes[0]?.legivel).toBe(false);
    expect(ehDescricaoGenericaDeMidia("Parece um extrato")).toBe(true);
    expect(pendenciasDaPrevia(previa, fontes)).toContain(
      "Há anexos sem leitura completa (imagem, PDF escaneado ou arquivo extenso). Confira os originais antes de confirmar.",
    );
  });

  it("foto de holerite com leitura documental serve de comprovante de renda", () => {
    const fontes = fontesDaAnalise([
      { type: "image", body: "holerite", media_derived_status: "ready",
        media_derived_text: "holerite renda liquida 4000", leitura_documental: true },
      { type: "text", body: "Maria 52998224725 maria@example.com A10 aluguel 1200" },
    ]);
    expect(pendenciasDaPrevia(previa, fontes)).toEqual([]);
  });
});

describe("janela e limites", () => {
  it("não bloqueia conversa longa: lê as 200 mais recentes, inclusive o papo", () => {
    const linhas = Array.from({ length: 250 }, (_, i) => (
      i === 0
        ? { type: "document", body: "RG", media_mime: "application/pdf" }
        : { type: "text", body: i % 17 === 0 ? `aluguel ${1200 + i}` : "ok" }
    ));
    const janela = janelaUtilDaAnalise(linhas);
    expect(janela).toHaveLength(200);
    expect(janela[0]?.type).toBe("document");
    expect(janela.some((l) => l.body === "ok")).toBe(true);
    expect(janelaUtilDaAnalise(linhas.slice(0, 30))).toHaveLength(30);
  });

  it("aceita recorte em organizations.settings.locacao.anexos e ignora lixo", () => {
    const l = limitesDaAnalise({ locacao: { anexos: { pdfs: 4, mensagens_brutas: 9999, imagens: "x", paginas_ocr: 30 } } });
    expect(l.pdfs).toBe(4);
    expect(l.mensagens_brutas).toBe(400);
    expect(l.imagens).toBe(8);
    expect(l.paginas_ocr).toBe(30);
  });

  it("o padrão cabe um extrato de 30 páginas", () => {
    expect(LIMITES_ANEXOS_PADRAO.paginas_ocr).toBe(30);
    expect(LIMITES_ANEXOS_PADRAO.bytes_pdf).toBe(20 * 1024 * 1024);
    expect(LIMITES_ANEXOS_PADRAO.chars_por_arquivo).toBe(120_000);
    expect(LIMITES_ANEXOS_PADRAO.chars_conjunto).toBe(200_000);
    expect(LIMITES_ANEXOS_PADRAO.paginas_por_lote_ocr).toBe(5);
    expect(LIMITES_ANEXOS_PADRAO.mensagens_brutas).toBe(200);
  });
});

describe("ficha usa o conteúdo extraído", () => {
  it("manda o texto derivado, não só nome e legenda", () => {
    const ficha = montarFichaTemporaria([{
      type: "image", body: "holerite", media_mime: "image/jpeg",
      media_derived_status: "ready", media_derived_text: "renda liquida 4000",
      metadata: { media_filename: "foto.jpg", media_url: "https://secreto.test" },
    }]);
    expect(ficha.anexos[0]).toEqual({
      nome: "foto.jpg", mime: "image/jpeg", legenda: "holerite", conteudo: "renda liquida 4000",
    });
    expect(JSON.stringify(ficha)).not.toMatch(/secreto/);
  });
});

describe("PDF protegido e avisos", () => {
  it("reconhece erro de senha sem olhar o conteúdo", () => {
    expect(ehErroDeSenhaDePdf({ name: "PasswordException", message: "No password given" })).toBe(true);
    expect(ehErroDeSenhaDePdf(new PdfExtractError("x", undefined, "protegido"))).toBe(true);
    expect(ehErroDeSenhaDePdf(new PdfExtractError("image-only", undefined, "sem_texto"))).toBe(false);
  });

  it("PDF com senha vira aviso nomeado, não silêncio", () => {
    const avisos = avisosDosAnexos([{
      type: "document", pendencia_anexo: "pdf_protegido", tentativas_senha: 1,
      metadata: { media_filename: "extrato.pdf" },
    }]);
    expect(avisos[0]).toMatchObject({ tipo: "pdf_protegido", nome: "extrato.pdf", tentativas: 1 });
    expect(frasesDosAvisos(avisos).join(" ")).toContain("Informe a senha");
    expect(frasesDosAvisos(avisos).join(" ")).not.toMatch(/52998224725|Maria/);
  });
});

describe("arquivos no Hub", () => {
  it("só manda URL se a ferramenta anunciar o campo", () => {
    expect(ferramentaAceitaArquivos({ name: "iniciar_analise_inquilino", inputSchema: { properties: { pedido_id: {} } } })).toBe(false);
    expect(ferramentaAceitaArquivos({ name: "iniciar_analise_inquilino", inputSchema: { properties: { arquivos: {} } } })).toBe(true);
    expect(ferramentaAceitaArquivos({ name: "x", inputSchema: { properties: { anexos: {} } } })).toBe(true);
  });
});
