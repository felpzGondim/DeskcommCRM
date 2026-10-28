/**
 * Reabre anexos da conversa para a prévia da análise e para a ficha.
 * PDF com texto, PDF escaneado (OCR/visão), foto documental e PDF com senha.
 * Nada disto é gravado — só vive na prévia efêmera até a Fase 3.
 */
import { extractPdfText, PdfExtractError } from "@/lib/ai/rag/extractors/pdf";
import { rasterizarPaginasPdf } from "@/lib/ai/rag/extractors/pdf-paginas";
import { ehErroDeSenhaDePdf } from "@/lib/ai/rag/extractors/pdf-senha";
import type { LerDocumentoFn } from "@/lib/ai/visao/ler-documento";
import { LIMITES_ANEXOS_PADRAO, type LimitesAnexos, ehDescricaoGenericaDeMidia } from "@/lib/agent-engine/agent/painel-anexos-limites";
import { isMediaPathOwnedBy } from "@/lib/messaging/media/upload-validation";
import { createAdminClient } from "@/lib/supabase/admin";

export type AvisoAnexo = {
  tipo: "pdf_protegido" | "pdf_escaneado" | "imagem_sem_leitura" | "arquivo_extenso" | "limite";
  nome: string;
  tentativas?: number;
};

export function nomeDoAnexo(linha: Record<string, unknown>): string {
  const meta = linha.metadata && typeof linha.metadata === "object" ? linha.metadata as Record<string, unknown> : {};
  if (typeof meta.media_filename === "string" && meta.media_filename.trim()) {
    return meta.media_filename.trim().slice(0, 120);
  }
  const path = typeof linha.media_storage_path === "string" ? linha.media_storage_path : "";
  return path.split("/").pop()?.slice(0, 120) || "anexo";
}

function senhaDoArquivo(nome: string, senhas: Record<string, string>): string | undefined {
  const direta = senhas[nome];
  if (direta) return direta;
  const chave = Object.keys(senhas).find((k) => k.toLowerCase() === nome.toLowerCase());
  return chave ? senhas[chave] : undefined;
}

async function baixarDoBucket(
  admin: ReturnType<typeof createAdminClient>,
  path: string,
): Promise<Buffer | null> {
  const { data, error } = await admin.storage.from("whatsapp-media").download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

async function ocrDePdf(
  buffer: Buffer,
  senha: string | undefined,
  limites: LimitesAnexos,
  lerDocumento: LerDocumentoFn,
  organizationId: string,
): Promise<string | null> {
  // Caminho feliz: uma chamada com o PDF inteiro (Gemini lê até 30 páginas).
  const direto = await lerDocumento({ organizationId, buffer, mime: "application/pdf" });
  if (direto.ok && direto.texto.trim()) return direto.texto.trim();
  const paginas = await rasterizarPaginasPdf(buffer, { maxPaginas: limites.paginas_ocr, password: senha });
  if (paginas.length === 0) return null;
  const lote = Math.max(1, limites.paginas_por_lote_ocr);
  const partes: string[] = [];
  for (let i = 0; i < paginas.length; i += lote) {
    const grupo = paginas.slice(i, i + lote);
    const primeira = grupo[0];
    if (!primeira) continue;
    const lido = await lerDocumento({
      organizationId,
      buffer: primeira.bytes,
      mime: primeira.mime,
      mais: grupo.slice(1).map((p) => ({ buffer: p.bytes, mime: p.mime })),
    });
    if (lido.ok && lido.texto.trim()) partes.push(lido.texto.trim());
  }
  const texto = partes.join("\n\n").trim();
  return texto || null;
}

/** Reabre os PDFs originais do próprio tenant; a derivação comum corta em 8 mil caracteres. */
export async function lerPdfsOriginais(
  linhas: readonly Record<string, unknown>[],
  orgId: string,
  conversaId: string,
  admin = createAdminClient(),
  opcoes: {
    limites?: LimitesAnexos;
    senhas?: Record<string, string>;
    lerDocumento?: LerDocumentoFn;
  } = {},
): Promise<Record<string, unknown>[]> {
  const limites = opcoes.limites ?? LIMITES_ANEXOS_PADRAO;
  const senhas = opcoes.senhas ?? {};
  const saida = linhas.map((v) => ({ ...v }));
  let documentos = 0;
  let caracteres = 0;
  for (const linha of saida) {
    if (linha.type !== "document" || linha.direction === "outbound" || linha.media_mime !== "application/pdf" || linha.revoked_at) continue;
    const path = linha.media_storage_path;
    const tamanho = linha.media_size_bytes;
    const nome = nomeDoAnexo(linha);
    if (++documentos > limites.pdfs) {
      linha.pendencia_anexo = "limite";
      continue;
    }
    if (typeof path !== "string" || !isMediaPathOwnedBy(path, orgId, conversaId)) continue;
    if (typeof tamanho === "number" && tamanho > limites.bytes_pdf) {
      linha.pendencia_anexo = "arquivo_extenso";
      continue;
    }
    const senha = senhaDoArquivo(nome, senhas);
    const tentativas = Number(linha.tentativas_senha ?? 0) + (senha ? 1 : 0);
    try {
      const buffer = await baixarDoBucket(admin, path);
      if (!buffer) continue;
      let bruto = "";
      try {
        bruto = await extractPdfText(buffer, senha ? { password: senha } : {});
      } catch (err) {
        if ((err instanceof PdfExtractError && err.motivo === "protegido") || ehErroDeSenhaDePdf(err)) {
          linha.pdf_protegido = true;
          linha.tentativas_senha = tentativas;
          linha.pendencia_anexo = tentativas >= limites.tentativas_senha ? "pdf_protegido_esgotado" : "pdf_protegido";
          continue;
        }
        if (err instanceof PdfExtractError && err.motivo === "sem_texto") {
          if (!opcoes.lerDocumento) {
            linha.pendencia_anexo = "pdf_escaneado";
            continue;
          }
          const ocr = await ocrDePdf(buffer, senha, limites, opcoes.lerDocumento, orgId);
          if (!ocr) {
            linha.pendencia_anexo = "pdf_escaneado";
            continue;
          }
          bruto = ocr;
          linha.leitura_documental = true;
        } else {
          linha.pendencia_anexo = "pdf_escaneado";
          continue;
        }
      }
      if (!bruto || bruto.length > limites.chars_por_arquivo || caracteres + bruto.length > limites.chars_conjunto) {
        linha.pendencia_anexo = "arquivo_extenso";
        continue;
      }
      caracteres += bruto.length;
      linha.media_derived_text = bruto;
      linha.media_derived_status = "ready";
      linha.original_completo = true;
    } catch {
      linha.pendencia_anexo = "pdf_escaneado";
    }
  }
  return saida;
}

export async function lerImagensDocumentais(
  linhas: readonly Record<string, unknown>[],
  orgId: string,
  conversaId: string,
  lerDocumento: LerDocumentoFn,
  admin = createAdminClient(),
  limites: LimitesAnexos = LIMITES_ANEXOS_PADRAO,
): Promise<Record<string, unknown>[]> {
  const saida = linhas.map((v) => ({ ...v }));
  let imagens = 0;
  let caracteres = 0;
  for (const linha of saida) {
    if (linha.type !== "image" || linha.direction === "outbound" || linha.revoked_at) continue;
    const path = linha.media_storage_path;
    const tamanho = linha.media_size_bytes;
    const mime = typeof linha.media_mime === "string" ? linha.media_mime : "image/jpeg";
    if (++imagens > limites.imagens) {
      linha.pendencia_anexo = "limite";
      continue;
    }
    if (typeof path !== "string" || !isMediaPathOwnedBy(path, orgId, conversaId)) {
      linha.pendencia_anexo = "imagem_sem_leitura";
      continue;
    }
    if (typeof tamanho === "number" && tamanho > limites.bytes_imagem) {
      linha.pendencia_anexo = "arquivo_extenso";
      continue;
    }
    try {
      const buffer = await baixarDoBucket(admin, path);
      if (!buffer) {
        linha.pendencia_anexo = "imagem_sem_leitura";
        continue;
      }
      const lido = await lerDocumento({ organizationId: orgId, buffer, mime });
      if (!lido.ok || ehDescricaoGenericaDeMidia(lido.texto)) {
        linha.pendencia_anexo = "imagem_sem_leitura";
        continue;
      }
      if (lido.texto.length > limites.chars_por_arquivo || caracteres + lido.texto.length > limites.chars_conjunto) {
        linha.pendencia_anexo = "arquivo_extenso";
        continue;
      }
      caracteres += lido.texto.length;
      linha.media_derived_text = lido.texto;
      linha.media_derived_status = "ready";
      linha.leitura_documental = true;
      linha.original_completo = true;
    } catch {
      linha.pendencia_anexo = "imagem_sem_leitura";
    }
  }
  return saida;
}

export function frasesDosAvisos(avisos: readonly AvisoAnexo[], tentativasMax = 3): string[] {
  return avisos.map((a) => {
    if (a.tipo === "pdf_protegido") {
      const n = a.tentativas ?? 0;
      return n >= tentativasMax
        ? `PDF protegido por senha: ${a.nome}. Três tentativas falharam; este arquivo fica pendente.`
        : `PDF protegido por senha: ${a.nome}. Informe a senha no painel para ler o arquivo.`;
    }
    if (a.tipo === "pdf_escaneado") return `Não consegui ler o PDF escaneado ${a.nome}. Confira o original.`;
    if (a.tipo === "imagem_sem_leitura") return `A foto ${a.nome} ainda não tem leitura documental.`;
    if (a.tipo === "arquivo_extenso") return `O arquivo ${a.nome} passou do tamanho ou do limite de texto desta análise.`;
    return `Há anexos demais nesta conversa. ${a.nome} ficou de fora do teto.`;
  });
}

export function avisosDosAnexos(linhas: readonly Record<string, unknown>[]): AvisoAnexo[] {
  const avisos: AvisoAnexo[] = [];
  for (const linha of linhas) {
    if (linha.direction === "outbound" || linha.revoked_at) continue;
    const tipo = typeof linha.pendencia_anexo === "string" ? linha.pendencia_anexo : "";
    const nome = nomeDoAnexo(linha);
    if (tipo === "pdf_protegido" || tipo === "pdf_protegido_esgotado") {
      avisos.push({
        tipo: "pdf_protegido",
        nome,
        tentativas: typeof linha.tentativas_senha === "number" ? linha.tentativas_senha : 0,
      });
    } else if (tipo === "pdf_escaneado") avisos.push({ tipo: "pdf_escaneado", nome });
    else if (tipo === "imagem_sem_leitura") avisos.push({ tipo: "imagem_sem_leitura", nome });
    else if (tipo === "arquivo_extenso") avisos.push({ tipo: "arquivo_extenso", nome });
    else if (tipo === "limite") avisos.push({ tipo: "limite", nome });
  }
  return avisos;
}

export function leiturasDocumentais(linhas: readonly Record<string, unknown>[]): Record<string, string> {
  const mapa: Record<string, string> = {};
  for (const linha of linhas) {
    if (linha.leitura_documental !== true && linha.original_completo !== true) continue;
    const path = typeof linha.media_storage_path === "string" ? linha.media_storage_path : "";
    const texto = typeof linha.media_derived_text === "string" ? linha.media_derived_text : "";
    if (path && texto) mapa[path] = texto;
  }
  return mapa;
}

export function aplicarLeiturasDocumentais(
  linhas: readonly Record<string, unknown>[],
  leituras: Record<string, string> | undefined,
): Record<string, unknown>[] {
  if (!leituras) return linhas.map((v) => ({ ...v }));
  return linhas.map((linha) => {
    const path = typeof linha.media_storage_path === "string" ? linha.media_storage_path : "";
    const texto = path ? leituras[path] : undefined;
    if (!texto) return { ...linha };
    return {
      ...linha,
      media_derived_text: texto,
      media_derived_status: "ready",
      leitura_documental: true,
      original_completo: true,
    };
  });
}

export async function enriquecerAnexosDaAnalise(
  linhas: readonly Record<string, unknown>[],
  orgId: string,
  conversaId: string,
  opcoes: {
    admin?: ReturnType<typeof createAdminClient>;
    limites?: LimitesAnexos;
    senhas?: Record<string, string>;
    lerDocumento?: LerDocumentoFn;
  } = {},
): Promise<{ linhas: Record<string, unknown>[]; avisos: AvisoAnexo[] }> {
  const admin = opcoes.admin ?? createAdminClient();
  const comPdf = await lerPdfsOriginais(linhas, orgId, conversaId, admin, opcoes);
  const comImagens = opcoes.lerDocumento
    ? await lerImagensDocumentais(comPdf, orgId, conversaId, opcoes.lerDocumento, admin, opcoes.limites)
    : comPdf;
  return { linhas: comImagens, avisos: avisosDosAnexos(comImagens) };
}
