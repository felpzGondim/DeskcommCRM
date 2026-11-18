import { z } from "zod";

import { BUCKETS_ANEXO_DELEGADO } from "./delegacao-superficie";

export const LIMITE_ARQUIVO_DELEGADO = 16 * 1024 * 1024;
export const LIMITE_BASE64_DELEGADO = 4 * Math.ceil(LIMITE_ARQUIVO_DELEGADO / 3);

const MIMES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
] as const;

const arquivo = z.strictObject({
  base64: z
    .string()
    .min(4)
    .max(LIMITE_BASE64_DELEGADO)
    .refine((s) => {
      if (s.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(s)) return false;
      const padding = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
      return (
        s.indexOf("=") === (padding ? s.length - padding : -1) &&
        (s.length / 4) * 3 - padding <= LIMITE_ARQUIVO_DELEGADO
      );
    }),
  nome: z.string().trim().min(1).max(255),
  mime: z.enum(MIMES),
});

const anexo = z.strictObject({
  bucket: z.enum(BUCKETS_ANEXO_DELEGADO),
  path: z
    .string()
    .min(1)
    .max(500)
    .refine((s) =>
      s
        .split("/")
        .every((p) => p !== "" && p !== "." && p !== ".." && !/[\\%?#\u0000-\u001f]/.test(p)),
    ),
});

const mensagem = {
  texto: z
    .string()
    .min(1)
    .max(4096)
    .refine((s) => !!s.trim())
    .optional(),
  arquivo: arquivo.optional(),
  anexo: anexo.optional(),
  legenda: z
    .string()
    .min(1)
    .max(4096)
    .refine((s) => !!s.trim())
    .optional(),
  idempotency_key: z.uuid().transform((id) => id.toLowerCase()),
};

function camposCompativeis(d: {
  texto?: string;
  legenda?: string;
  arquivo?: unknown;
  anexo?: unknown;
}) {
  const temMidia = !!(d.arquivo || d.anexo);
  return (temMidia || !!d.texto) && !(d.arquivo && d.anexo) && (temMidia || !d.legenda);
}

export const delegacaoEnviarSchema = z
  .strictObject({
    conversation_id: z.uuid().transform((id) => id.toLowerCase()),
    ...mensagem,
  })
  .refine(camposCompativeis)
  .describe("Informe texto, arquivo ou anexo. Em mídia, legenda tem precedência sobre texto.");

export const delegacaoIniciarConversaSchema = z
  .strictObject({
    channel_session_id: z.uuid().transform((id) => id.toLowerCase()),
    telefone: z
      .string()
      .regex(/^\+[1-9]\d{7,14}$/)
      .describe("Telefone em E.164, incluindo + e código do país."),
    nome: z.string().trim().min(1).max(200).optional(),
    ...mensagem,
  })
  .refine(camposCompativeis)
  .describe("Informe texto, arquivo ou anexo. Em mídia, legenda tem precedência sobre texto.");

export type PedidoEnvioDelegado =
  z.infer<typeof delegacaoEnviarSchema> | z.infer<typeof delegacaoIniciarConversaSchema>;
