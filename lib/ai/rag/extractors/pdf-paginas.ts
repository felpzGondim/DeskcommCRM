/**
 * Rasteriza páginas de um PDF sem texto selecionável para a visão documental.
 * O canvas nativo é optional do pdfjs — se não estiver instalado, devolve
 * lista vazia. Quem chama tenta a visão no PDF inteiro antes, e vira
 * pendência visível se os dois caminhos falharem.
 */
import type * as PdfjsDist from "pdfjs-dist";

import { PdfExtractError } from "@/lib/ai/rag/extractors/pdf";
import { ehErroDeSenhaDePdf } from "@/lib/ai/rag/extractors/pdf-senha";

export interface PaginaRasterizada {
  pagina: number;
  mime: "image/png";
  bytes: Buffer;
}

type CanvasNativo = {
  createCanvas: (largura: number, altura: number) => {
    getContext: (tipo: "2d") => unknown;
    toBuffer: (tipo: "image/png") => Buffer;
  };
};

async function carregarCanvasNativo(): Promise<CanvasNativo | null> {
  try {
    // Specifier montado para o bundler não resolver no collect do Vitest.
    const spec = ["@", "napi-rs", "/canvas"].join("");
    return (await import(spec)) as CanvasNativo;
  } catch {
    return null;
  }
}

export async function rasterizarPaginasPdf(
  buffer: Buffer,
  opcoes: { maxPaginas: number; password?: string } = { maxPaginas: 8 },
): Promise<PaginaRasterizada[]> {
  try {
    const pdfjsLib = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as typeof PdfjsDist;
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      ...(opcoes.password ? { password: opcoes.password } : {}),
    });
    const doc = await loadingTask.promise;
    const teto = Math.min(doc.numPages, Math.max(1, opcoes.maxPaginas));
    const canvasMod = await carregarCanvasNativo();
    if (!canvasMod?.createCanvas) return [];
    const saida: PaginaRasterizada[] = [];
    for (let n = 1; n <= teto; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const escala = Math.min(1.6, 1600 / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale: escala });
      const canvas = canvasMod.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext("2d");
      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: ctx as never,
        viewport,
      }).promise;
      saida.push({ pagina: n, mime: "image/png", bytes: Buffer.from(canvas.toBuffer("image/png")) });
    }
    return saida;
  } catch (err) {
    if (ehErroDeSenhaDePdf(err)) {
      throw new PdfExtractError("pdfjs-dist needs a password to open this PDF", err, "protegido");
    }
    throw new PdfExtractError("pdfjs-dist failed to rasterize PDF pages", err);
  }
}
