import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import { PdfExtractError } from "@/lib/ai/rag/extractors/pdf";

const extractPdfDocument = vi.fn();
vi.mock("@/lib/ai/rag/extractors/pdf", async (orig) => {
  const real = (await orig()) as object;
  return { ...real, extractPdfDocument: (...args: unknown[]) => extractPdfDocument(...args) };
});

import { LIMITES_ANEXOS_PADRAO } from "@/lib/agent-engine/agent/painel-anexos-limites";
import {
  aplicarLeiturasDocumentais,
  leiturasDocumentais,
  lerImagensDocumentais,
  lerPdfsOriginais,
} from "@/lib/agent-engine/agent/painel-leitura-anexos";

const pdf = readFileSync("tests/fixtures/sample-text.pdf");

function adminQueEntrega(buffer: Buffer) {
  return {
    storage: {
      from: () => ({
        download: async () => ({
          data: new Blob([new Uint8Array(buffer)]),
          error: null,
        }),
      }),
    },
  };
}

describe("leitura original de anexos", () => {
  beforeEach(() => {
    extractPdfDocument.mockReset();
  });

  it("reabre PDF de texto desta organização e conversa", async () => {
    extractPdfDocument.mockResolvedValue({ texto: "holerite renda liquida 4000", paginas: 1 });
    const linhas = await lerPdfsOriginais(
      [
        {
          type: "document",
          media_mime: "application/pdf",
          media_storage_path: "outra-org/conversa/segredo.pdf",
          media_size_bytes: pdf.length,
        },
        {
          type: "document",
          media_mime: "application/pdf",
          media_storage_path: "org/conversa/extrato.pdf",
          media_size_bytes: pdf.length,
        },
      ],
      "org",
      "conversa",
      adminQueEntrega(pdf) as never,
    );
    expect(extractPdfDocument).toHaveBeenCalledTimes(1);
    expect(linhas[0]?.original_completo).toBeUndefined();
    expect(linhas[1]?.original_completo).toBe(true);
    expect(linhas[1]?.media_derived_text).toBe("holerite renda liquida 4000");
    expect(linhas[1]?.pdf_paginas).toBe(1);
  });

  it("PDF com senha marca pendência visível e tenta de novo com a senha da sessão", async () => {
    extractPdfDocument
      .mockRejectedValueOnce(new PdfExtractError("needs password", undefined, "protegido"))
      .mockResolvedValueOnce({ texto: "extrato com saldo", paginas: 3 });
    const linha = {
      type: "document",
      media_mime: "application/pdf",
      media_storage_path: "org/conversa/extrato.pdf",
      media_size_bytes: pdf.length,
      metadata: { media_filename: "extrato.pdf" },
    };
    const semSenha = await lerPdfsOriginais(
      [linha],
      "org",
      "conversa",
      adminQueEntrega(pdf) as never,
    );
    expect(semSenha[0]?.pdf_protegido).toBe(true);
    expect(semSenha[0]?.pendencia_anexo).toBe("pdf_protegido");
    const comSenha = await lerPdfsOriginais(
      [linha],
      "org",
      "conversa",
      adminQueEntrega(pdf) as never,
      {
        senhas: { "extrato.pdf": "abc" },
      },
    );
    expect(extractPdfDocument).toHaveBeenLastCalledWith(expect.any(Buffer), { password: "abc" });
    expect(comSenha[0]?.original_completo).toBe(true);
    expect(comSenha[0]?.media_derived_text).toBe("extrato com saldo");
    expect(comSenha[0]?.pdf_paginas).toBe(3);
  });

  it("PDF escaneado sem OCR guarda o número de páginas e fica pendente", async () => {
    extractPdfDocument.mockRejectedValue(
      new PdfExtractError("image-only", undefined, "sem_texto", 7),
    );
    const linhas = await lerPdfsOriginais(
      [
        {
          type: "document",
          media_mime: "application/pdf",
          media_storage_path: "org/conversa/extrato.pdf",
          media_size_bytes: pdf.length,
          metadata: { media_filename: "extrato.pdf" },
        },
      ],
      "org",
      "conversa",
      adminQueEntrega(pdf) as never,
    );
    expect(linhas[0]?.pendencia_anexo).toBe("pdf_escaneado");
    expect(linhas[0]?.pdf_paginas).toBe(7);
  });

  it("PDF escaneado passa pela visão documental e não some em silêncio", async () => {
    extractPdfDocument.mockRejectedValue(
      new PdfExtractError("image-only", undefined, "sem_texto", 4),
    );
    const lerDocumento = vi.fn(async () => ({ ok: true as const, texto: "RG 123 nome Maria" }));
    const raster = vi
      .spyOn(await import("@/lib/ai/rag/extractors/pdf-paginas"), "rasterizarPaginasPdf")
      .mockResolvedValue([{ pagina: 1, mime: "image/png", bytes: Buffer.from("png") }]);
    const linhas = await lerPdfsOriginais(
      [
        {
          type: "document",
          media_mime: "application/pdf",
          media_storage_path: "org/conversa/rg.pdf",
          media_size_bytes: pdf.length,
        },
      ],
      "org",
      "conversa",
      adminQueEntrega(pdf) as never,
      { lerDocumento },
    );
    expect(linhas[0]?.leitura_documental).toBe(true);
    expect(linhas[0]?.original_completo).toBe(true);
    expect(linhas[0]?.media_derived_text).toContain("RG 123");
    expect(linhas[0]?.pdf_paginas).toBe(4);
    raster.mockRestore();
  });

  it("imagem só fica legível com o passo documental, não com a descrição do worker", async () => {
    const lerDocumento = vi.fn(async () => ({ ok: true as const, texto: "renda liquida 4000" }));
    const linhas = await lerImagensDocumentais(
      [
        {
          type: "image",
          media_mime: "image/jpeg",
          media_storage_path: "org/conversa/holerite.jpg",
          media_size_bytes: 1200,
        },
      ],
      "org",
      "conversa",
      lerDocumento,
      adminQueEntrega(Buffer.from("img")) as never,
    );
    expect(linhas[0]?.leitura_documental).toBe(true);
    expect(linhas[0]?.media_derived_text).toBe("renda liquida 4000");
    const generica = await lerImagensDocumentais(
      [
        {
          type: "image",
          media_mime: "image/jpeg",
          media_storage_path: "org/conversa/foto.jpg",
          media_size_bytes: 800,
        },
      ],
      "org",
      "conversa",
      async () => ({ ok: true, texto: "Parece um extrato" }),
      adminQueEntrega(Buffer.from("img")) as never,
    );
    expect(generica[0]?.leitura_documental).toBeUndefined();
    expect(generica[0]?.pendencia_anexo).toBe("imagem_sem_leitura");
  });

  it("no fallback do raster, manda páginas em lotes e não uma a uma", async () => {
    extractPdfDocument.mockRejectedValue(
      new PdfExtractError("image-only", undefined, "sem_texto", 12),
    );
    const lerDocumento = vi.fn(async (e: { mime: string; mais?: unknown[] }) =>
      e.mime === "application/pdf"
        ? { ok: false as const, motivo: "falha" as const }
        : { ok: true as const, texto: "pagina" },
    );
    const raster = vi
      .spyOn(await import("@/lib/ai/rag/extractors/pdf-paginas"), "rasterizarPaginasPdf")
      .mockResolvedValue(
        Array.from({ length: 12 }, (_, i) => ({
          pagina: i + 1,
          mime: "image/png" as const,
          bytes: Buffer.from(`p${i}`),
        })),
      );
    const linhas = await lerPdfsOriginais(
      [
        {
          type: "document",
          media_mime: "application/pdf",
          media_storage_path: "org/conversa/extrato.pdf",
          media_size_bytes: pdf.length,
        },
      ],
      "org",
      "conversa",
      adminQueEntrega(pdf) as never,
      {
        lerDocumento,
        limites: LIMITES_ANEXOS_PADRAO,
      },
    );
    const chamadasPng = lerDocumento.mock.calls.filter((c) => c[0]?.mime === "image/png");
    expect(chamadasPng).toHaveLength(3);
    expect(chamadasPng[0]?.[0]?.mais).toHaveLength(4);
    expect(linhas[0]?.media_derived_text).toContain("pagina");
    raster.mockRestore();
  });

  it("sela o texto extraído para a confirmação não precisar da senha de novo", async () => {
    extractPdfDocument.mockResolvedValue({ texto: "extrato com saldo 4000", paginas: 2 });
    const linhas = await lerPdfsOriginais(
      [
        {
          type: "document",
          media_mime: "application/pdf",
          media_storage_path: "org/conversa/extrato.pdf",
          media_size_bytes: pdf.length,
        },
      ],
      "org",
      "conversa",
      adminQueEntrega(pdf) as never,
      { senhas: { "extrato.pdf": "abc" } },
    );
    const mapa = leiturasDocumentais(linhas);
    expect(mapa["org/conversa/extrato.pdf"]).toBe("extrato com saldo 4000");
    const cruas = [
      {
        type: "document",
        media_mime: "application/pdf",
        media_storage_path: "org/conversa/extrato.pdf",
      },
    ];
    const aplicadas = aplicarLeiturasDocumentais(cruas, mapa);
    expect(aplicadas[0]?.original_completo).toBe(true);
    expect(aplicadas[0]?.media_derived_text).toBe("extrato com saldo 4000");
  });
});
