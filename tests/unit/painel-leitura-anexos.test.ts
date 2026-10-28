import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import { PdfExtractError } from "@/lib/ai/rag/extractors/pdf";

const extractPdfText = vi.fn();
vi.mock("@/lib/ai/rag/extractors/pdf", async (orig) => {
  const real = await orig();
  return { ...real, extractPdfText: (...args: unknown[]) => extractPdfText(...args) };
});

import { aplicarLeiturasDocumentais, leiturasDocumentais, lerImagensDocumentais, lerPdfsOriginais } from "@/lib/agent-engine/agent/painel-leitura-anexos";

const pdf = readFileSync("tests/fixtures/sample-text.pdf");

function adminQueEntrega(buffer: Buffer) {
  return { storage: { from: () => ({ download: async () => ({
    data: new Blob([new Uint8Array(buffer)]), error: null,
  }) }) } };
}

describe("leitura original de anexos", () => {
  beforeEach(() => {
    extractPdfText.mockReset();
  });

  it("reabre PDF de texto desta organização e conversa", async () => {
    extractPdfText.mockResolvedValue("holerite renda liquida 4000");
    const linhas = await lerPdfsOriginais([
      { type: "document", media_mime: "application/pdf", media_storage_path: "outra-org/conversa/segredo.pdf", media_size_bytes: pdf.length },
      { type: "document", media_mime: "application/pdf", media_storage_path: "org/conversa/extrato.pdf", media_size_bytes: pdf.length },
    ], "org", "conversa", adminQueEntrega(pdf) as never);
    expect(extractPdfText).toHaveBeenCalledTimes(1);
    expect(linhas[0]?.original_completo).toBeUndefined();
    expect(linhas[1]?.original_completo).toBe(true);
    expect(linhas[1]?.media_derived_text).toBe("holerite renda liquida 4000");
  });

  it("PDF com senha marca pendência visível e tenta de novo com a senha da sessão", async () => {
    extractPdfText
      .mockRejectedValueOnce(new PdfExtractError("needs password", undefined, "protegido"))
      .mockResolvedValueOnce("extrato com saldo");
    const linha = {
      type: "document", media_mime: "application/pdf",
      media_storage_path: "org/conversa/extrato.pdf", media_size_bytes: pdf.length,
      metadata: { media_filename: "extrato.pdf" },
    };
    const semSenha = await lerPdfsOriginais([linha], "org", "conversa", adminQueEntrega(pdf) as never);
    expect(semSenha[0]?.pdf_protegido).toBe(true);
    expect(semSenha[0]?.pendencia_anexo).toBe("pdf_protegido");
    const comSenha = await lerPdfsOriginais([linha], "org", "conversa", adminQueEntrega(pdf) as never, {
      senhas: { "extrato.pdf": "abc" },
    });
    expect(extractPdfText).toHaveBeenLastCalledWith(expect.any(Buffer), { password: "abc" });
    expect(comSenha[0]?.original_completo).toBe(true);
    expect(comSenha[0]?.media_derived_text).toBe("extrato com saldo");
  });

  it("PDF escaneado passa pela visão documental e não some em silêncio", async () => {
    extractPdfText.mockRejectedValue(new PdfExtractError("image-only", undefined, "sem_texto"));
    const lerDocumento = vi.fn(async () => ({ ok: true as const, texto: "RG 123 nome Maria" }));
    const raster = vi.spyOn(await import("@/lib/ai/rag/extractors/pdf-paginas"), "rasterizarPaginasPdf")
      .mockResolvedValue([{ pagina: 1, mime: "image/png", bytes: Buffer.from("png") }]);
    const linhas = await lerPdfsOriginais([{
      type: "document", media_mime: "application/pdf",
      media_storage_path: "org/conversa/rg.pdf", media_size_bytes: pdf.length,
    }], "org", "conversa", adminQueEntrega(pdf) as never, { lerDocumento });
    expect(linhas[0]?.leitura_documental).toBe(true);
    expect(linhas[0]?.original_completo).toBe(true);
    expect(linhas[0]?.media_derived_text).toContain("RG 123");
    raster.mockRestore();
  });

  it("imagem só fica legível com o passo documental, não com a descrição do worker", async () => {
    const lerDocumento = vi.fn(async () => ({ ok: true as const, texto: "renda liquida 4000" }));
    const linhas = await lerImagensDocumentais([{
      type: "image", media_mime: "image/jpeg",
      media_storage_path: "org/conversa/holerite.jpg", media_size_bytes: 1200,
    }], "org", "conversa", lerDocumento, adminQueEntrega(Buffer.from("img")) as never);
    expect(linhas[0]?.leitura_documental).toBe(true);
    expect(linhas[0]?.media_derived_text).toBe("renda liquida 4000");
    const generica = await lerImagensDocumentais([{
      type: "image", media_mime: "image/jpeg",
      media_storage_path: "org/conversa/foto.jpg", media_size_bytes: 800,
    }], "org", "conversa", async () => ({ ok: true, texto: "Parece um extrato" }),
    adminQueEntrega(Buffer.from("img")) as never);
    expect(generica[0]?.leitura_documental).toBeUndefined();
    expect(generica[0]?.pendencia_anexo).toBe("imagem_sem_leitura");
  });

  it("sela o texto extraído para a confirmação não precisar da senha de novo", async () => {
    extractPdfText.mockResolvedValue("extrato com saldo 4000");
    const linhas = await lerPdfsOriginais([{
      type: "document", media_mime: "application/pdf",
      media_storage_path: "org/conversa/extrato.pdf", media_size_bytes: pdf.length,
    }], "org", "conversa", adminQueEntrega(pdf) as never, { senhas: { "extrato.pdf": "abc" } });
    const mapa = leiturasDocumentais(linhas);
    expect(mapa["org/conversa/extrato.pdf"]).toBe("extrato com saldo 4000");
    const cruas = [{
      type: "document", media_mime: "application/pdf",
      media_storage_path: "org/conversa/extrato.pdf",
    }];
    const aplicadas = aplicarLeiturasDocumentais(cruas, mapa);
    expect(aplicadas[0]?.original_completo).toBe(true);
    expect(aplicadas[0]?.media_derived_text).toBe("extrato com saldo 4000");
  });
});
