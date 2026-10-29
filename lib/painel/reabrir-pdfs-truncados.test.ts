import { beforeEach, describe, expect, it, vi } from "vitest";

import { LIMITES_ANEXOS_PADRAO } from "@/lib/agent-engine/agent/painel-anexos-limites";
import { MAX_DERIVED_CHARS } from "@/lib/messaging/media/derive";
import { AVISO_DERIVADO_TRUNCADO } from "@/lib/painel/texto-derivado";

const enriquecer = vi.fn();
vi.mock("@/lib/agent-engine/agent/painel-leitura-anexos", async (orig) => {
  const real = (await orig()) as object;
  return { ...real, enriquecerAnexosDaAnalise: (...args: unknown[]) => enriquecer(...args) };
});
vi.mock("@/lib/agent-engine/agent/request-deps", () => ({
  requestTurnDeps: () => ({ llmCfg: {} }),
}));
vi.mock("@/lib/ai/visao/ler-documento", () => ({
  lerDocumentoPorVisao: vi.fn(),
}));

import { lerAnexoDoPainel } from "@/lib/painel/acoes/anexo";
import { lerConversaDoPainel } from "@/lib/painel/acoes/conversa";
import { reabrirPdfsTruncados } from "@/lib/painel/reabrir-pdfs-truncados";
import type { ContextoDaFerramenta } from "@/lib/painel/ferramentas/tipos";

const recorte = "débito ".repeat(2000).slice(0, MAX_DERIVED_CHARS);
const completo = `${recorte}\ncrédito 2500 depósito final`;

function ctxCom(
  linhas: Record<string, unknown>[],
  admin = { marca: "admin-da-sessao" },
): ContextoDaFerramenta {
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = () => q;
  q.order = () => q;
  q.limit = async () => ({ data: linhas, error: null });
  q.gte = () => q;
  q.maybeSingle = async () => ({ data: { name: "Maria", display_name: "Maria" }, error: null });
  return {
    orgId: "org-1",
    conversationId: "conversa-1",
    contactId: "contato-1",
    userId: "user-1",
    requestId: "req-1",
    dbSessao: { from: () => q } as never,
    admin: admin as never,
    settings: {},
    idioma: "pt-BR",
    origem: "agente",
  };
}

function pdfNoTeto(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    direction: "inbound",
    type: "document",
    body: "",
    media_derived_text: recorte,
    media_derived_status: "ready",
    media_mime: "application/pdf",
    media_storage_path: "org-1/conversa-1/extrato.pdf",
    media_size_bytes: 12_000,
    metadata: { media_filename: "extrato.pdf" },
    sent_at: "2026-10-28T12:00:00.000Z",
    revoked_at: null,
    ...extra,
  };
}

function fotoNoTeto(): Record<string, unknown> {
  return {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    direction: "inbound",
    type: "image",
    body: "",
    media_derived_text: recorte,
    media_derived_status: "ready",
    media_mime: "image/jpeg",
    media_storage_path: "org-1/conversa-1/holerite.jpg",
    media_size_bytes: 800,
    metadata: { media_filename: "holerite.jpg" },
    sent_at: "2026-10-28T12:01:00.000Z",
    revoked_at: null,
  };
}

describe("reabrir PDF truncado no campo de pergunta", () => {
  beforeEach(() => {
    enriquecer.mockReset();
  });

  it("PDF no teto reabre o original com os limites da análise e o admin da sessão", async () => {
    const admin = { marca: "admin-da-org" };
    const linha = pdfNoTeto();
    enriquecer.mockResolvedValue({
      linhas: [{ ...linha, media_derived_text: completo, original_completo: true }],
      avisos: [],
    });
    const { linhas } = await reabrirPdfsTruncados([linha], ctxCom([linha], admin));
    expect(enriquecer).toHaveBeenCalledTimes(1);
    expect(enriquecer.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ media_mime: "application/pdf" }),
    ]);
    expect(enriquecer.mock.calls[0]?.[1]).toBe("org-1");
    expect(enriquecer.mock.calls[0]?.[2]).toBe("conversa-1");
    expect(enriquecer.mock.calls[0]?.[3]).toEqual(
      expect.objectContaining({
        admin,
        limites: expect.objectContaining({
          paginas_ocr: LIMITES_ANEXOS_PADRAO.paginas_ocr,
          chars_por_arquivo: LIMITES_ANEXOS_PADRAO.chars_por_arquivo,
          chars_conjunto: LIMITES_ANEXOS_PADRAO.chars_conjunto,
        }),
      }),
    );
    expect(linhas[0]?.original_completo).toBe(true);
    expect(linhas[0]?.media_derived_text).toBe(completo);
  });

  it("falha da reabertura deixa o recorte de 8000", async () => {
    const linha = pdfNoTeto();
    enriquecer.mockResolvedValue({
      linhas: [{ ...linha, pendencia_anexo: "arquivo_extenso" }],
      avisos: [{ tipo: "arquivo_extenso", nome: "extrato.pdf" }],
    });
    const { linhas } = await reabrirPdfsTruncados([linha], ctxCom([linha]));
    expect(linhas[0]?.original_completo).toBeUndefined();
    expect(linhas[0]?.media_derived_text).toBe(recorte);
  });

  it("não-PDF no teto não reabre o original", async () => {
    const { linhas } = await reabrirPdfsTruncados([fotoNoTeto()], ctxCom([fotoNoTeto()]));
    expect(enriquecer).not.toHaveBeenCalled();
    expect(linhas[0]?.media_derived_text).toHaveLength(MAX_DERIVED_CHARS);
  });

  it("ler_anexo entrega o texto completo do PDF reaberto", async () => {
    enriquecer.mockResolvedValue({
      linhas: [{ ...pdfNoTeto(), media_derived_text: completo, original_completo: true }],
      avisos: [],
    });
    const r = await lerAnexoDoPainel(ctxCom([pdfNoTeto()]), { nome: "extrato.pdf" });
    expect(r.ok).toBe(true);
    expect(r.texto).toContain("crédito 2500 depósito final");
    expect(r.texto).not.toContain(AVISO_DERIVADO_TRUNCADO);
    expect(enriquecer.mock.calls[0]?.[3]).toEqual(
      expect.objectContaining({ lerDocumento: expect.any(Function) }),
    );
  });

  it("ler_anexo cai no recorte com aviso quando a reabertura falha", async () => {
    enriquecer.mockResolvedValue({
      linhas: [{ ...pdfNoTeto(), pendencia_anexo: "pdf_escaneado" }],
      avisos: [{ tipo: "pdf_escaneado", nome: "extrato.pdf" }],
    });
    const r = await lerAnexoDoPainel(ctxCom([pdfNoTeto()]), { nome: "extrato.pdf" });
    expect(r.texto).toContain(AVISO_DERIVADO_TRUNCADO);
    expect(r.texto).toContain(recorte.slice(0, 40));
    expect(r.texto).not.toContain("crédito 2500 depósito final");
  });

  it("ler_anexo de foto no teto só avisa — não chama a reabertura", async () => {
    const r = await lerAnexoDoPainel(ctxCom([fotoNoTeto()]), { nome: "holerite.jpg" });
    expect(enriquecer).not.toHaveBeenCalled();
    expect(r.texto).toContain(AVISO_DERIVADO_TRUNCADO);
    expect(r.texto).not.toContain("crédito 2500");
  });

  it("ler_conversa reabre o PDF e anexa o texto completo", async () => {
    enriquecer.mockResolvedValue({
      linhas: [{ ...pdfNoTeto(), media_derived_text: completo, original_completo: true }],
      avisos: [],
    });
    const r = await lerConversaDoPainel(ctxCom([pdfNoTeto()]), {});
    expect(enriquecer).toHaveBeenCalledTimes(1);
    expect(enriquecer.mock.calls[0]?.[3]).not.toEqual(
      expect.objectContaining({ lerDocumento: expect.any(Function) }),
    );
    expect(r.texto).toContain("crédito 2500 depósito final");
    expect(r.texto).not.toContain(AVISO_DERIVADO_TRUNCADO);
  });

  it("ler_conversa cai no recorte com aviso quando a reabertura falha", async () => {
    enriquecer.mockResolvedValue({
      linhas: [{ ...pdfNoTeto() }],
      avisos: [],
    });
    const r = await lerConversaDoPainel(ctxCom([pdfNoTeto()]), {});
    expect(r.texto).toContain(AVISO_DERIVADO_TRUNCADO);
    expect(r.texto).not.toContain("crédito 2500 depósito final");
  });

  it("ler_conversa de foto no teto só avisa", async () => {
    const r = await lerConversaDoPainel(ctxCom([fotoNoTeto()]), {});
    expect(enriquecer).not.toHaveBeenCalled();
    expect(r.texto).toContain(AVISO_DERIVADO_TRUNCADO);
  });
});
