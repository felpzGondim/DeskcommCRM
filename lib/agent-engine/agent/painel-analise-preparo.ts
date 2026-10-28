/** Retrato revisto pelo atendente antes de criar um job de análise no Hub. */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";

import { isValidCpf } from "@/lib/legal/perfil-do-pais";
import { ehDescricaoGenericaDeMidia, textoCombinadoDaMensagem } from "@/lib/agent-engine/agent/painel-anexos-limites";
import { scrubMessage } from "@/lib/sentry/scrub";

export { lerPdfsOriginais } from "@/lib/agent-engine/agent/painel-leitura-anexos";

const texto = z.string().trim().max(180);
const campo = z.object({ valor: texto.nullable(), fonte: z.string().max(16).nullable(), trecho: z.string().max(240).nullable() });
const numero = z.object({ valor: z.number().finite().nonnegative().nullable(), fonte: z.string().max(16).nullable(), trecho: z.string().max(240).nullable() });

export const previaSchema = z.object({
  candidato: z.object({ nome: campo, cpf: campo, email: campo }),
  imovel: z.object({ codigo_fc: campo, logradouro: campo, apartamento: campo, aluguel: numero }),
  renda: z.object({ mensal: numero, documentos: z.array(z.object({
    fonte: z.string().max(16), tipo: z.enum(["holerite", "ctps", "extrato", "outro"]),
    periodo: texto.nullable(), resumo: z.string().max(500),
    valor_comprovado: z.number().finite().nonnegative().nullable(),
  })).max(20) }),
  pendencias: z.array(z.string().max(180)).max(20),
});
export type PreviaAnalise = z.infer<typeof previaSchema>;

export interface FonteAnalise { id: string; direcao: "cliente" | "empresa"; tipo: string; nome: string; texto: string; legivel: boolean }

function comprovanteLegivel(f: FonteAnalise): boolean {
  return f.legivel && (f.tipo === "document" || f.tipo === "image");
}

export function fontesDaAnalise(linhas: readonly Record<string, unknown>[]): FonteAnalise[] {
  return linhas.filter((m) => !m.revoked_at).reverse().map((m, i) => {
    const tipo = typeof m.type === "string" ? m.type : "text";
    const direcao = m.direction === "outbound" ? "empresa" : "cliente";
    const meta = m.metadata && typeof m.metadata === "object" ? m.metadata as Record<string, unknown> : {};
    const nome = typeof meta.media_filename === "string" ? meta.media_filename.slice(0, 100) : "";
    const derivado = m.media_derived_status === "ready" && typeof m.media_derived_text === "string"
      ? m.media_derived_text : "";
    const corpo = typeof m.body === "string" ? m.body : "";
    const textoFonte = textoCombinadoDaMensagem(corpo, derivado);
    const documental = m.leitura_documental === true && !!derivado && !ehDescricaoGenericaDeMidia(derivado);
    return { id: `M${i + 1}`, direcao, tipo, nome, texto: textoFonte.slice(0, 42000),
      legivel: (tipo === "text" && textoFonte.length <= 42000) ||
        (tipo === "audio" && !!derivado && derivado.length < 8000) ||
        (tipo === "document" && direcao === "cliente" && m.original_completo === true && textoFonte.length <= 42000) ||
        (tipo === "image" && direcao === "cliente" && documental && textoFonte.length <= 42000) };
  });
}

export function hashDasFontes(fontes: readonly FonteAnalise[]): string {
  return createHash("sha256").update(JSON.stringify(fontes)).digest("hex");
}

function evidencia(conf: { fonte: string | null; trecho: string | null }, fontes: readonly FonteAnalise[]) {
  const f = fontes.find((v) => v.id === conf.fonte);
  return !!f?.legivel && !!conf.trecho && f.texto.toLocaleLowerCase().includes(conf.trecho.toLocaleLowerCase());
}

function valorNoTrecho(valor: number | null, trecho: string | null): boolean {
  if (valor === null || !trecho) return false;
  const numeros = trecho.match(/(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?/g) ?? [];
  return numeros.some((bruto) => Math.abs(Number(bruto.replaceAll(".", "").replace(",", ".")) - valor) < 0.01);
}

export function pendenciasDaPrevia(p: PreviaAnalise, fontes: readonly FonteAnalise[]): string[] {
  const faltam = [...p.pendencias];
  if (!p.candidato.nome.valor || !evidencia(p.candidato.nome, fontes)) faltam.push("Nome do candidato sem fonte legível.");
  if (!p.candidato.cpf.valor || !isValidCpf(p.candidato.cpf.valor) || !evidencia(p.candidato.cpf, fontes)) faltam.push("CPF do candidato sem fonte legível ou inválido.");
  if (!p.candidato.email.valor || !z.email().safeParse(p.candidato.email.valor).success || !evidencia(p.candidato.email, fontes)) {
    faltam.push("E-mail do candidato necessário para a consulta Migra.");
  }
  if (!p.imovel.codigo_fc.valor && !(p.imovel.logradouro.valor && p.imovel.apartamento.valor)) faltam.push("Imóvel sem código FC ou endereço e apartamento.");
  if (!p.imovel.aluguel.valor || !evidencia(p.imovel.aluguel, fontes) ||
    !valorNoTrecho(p.imovel.aluguel.valor, p.imovel.aluguel.trecho)) faltam.push("Aluguel sem valor confirmado na conversa.");
  if (!p.renda.mensal.valor || !evidencia(p.renda.mensal, fontes) ||
    !valorNoTrecho(p.renda.mensal.valor, p.renda.mensal.trecho) ||
    !fontes.some((f) => f.id === p.renda.mensal.fonte && comprovanteLegivel(f))) {
    faltam.push("Renda mensal sem comprovante legível e origem verificável.");
  }
  if (!p.renda.documentos.length || p.renda.documentos.some((d) => !fontes.some((f) => f.id === d.fonte && comprovanteLegivel(f)))) {
    faltam.push("Comprovantes de renda sem análise individual verificável.");
  }
  for (const f of fontes.filter((v) => v.direcao === "cliente" && v.tipo === "document" && !v.legivel && /protegido/i.test(v.nome + v.texto))) {
    faltam.push(`PDF protegido por senha: ${f.nome || "arquivo"}. Informe a senha no painel.`);
  }
  if (fontes.some((f) => f.direcao === "cliente" && ["document", "image"].includes(f.tipo) && !f.legivel)) {
    faltam.push("Há anexos sem leitura completa (imagem, PDF escaneado ou arquivo extenso). Confira os originais antes de confirmar.");
  }
  if (fontes.some((f) => f.direcao === "cliente" && f.tipo === "text" && !f.legivel)) faltam.push("Há mensagem longa que não foi lida por completo.");
  if (fontes.some((f) => f.direcao === "cliente" && f.tipo === "audio" && !f.legivel)) faltam.push("Há áudio sem transcrição completa nesta conversa.");
  if (fontes.some((f) => f.direcao === "cliente" && f.tipo === "video" && !f.legivel)) faltam.push("Há vídeo sem leitura completa nesta conversa.");
  return [...new Set(faltam)];
}

export function resumoDaPrevia(p: PreviaAnalise, pendencias: readonly string[]): string {
  const cpf = p.candidato.cpf.valor?.replace(/\D/g, "") ?? "";
  const cpfMask = cpf.length === 11 ? `***.***.${cpf.slice(6, 9)}-${cpf.slice(9)}` : "não identificado";
  const dinheiro = (v: number | null) => v === null ? "não identificado" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
  return [
    `Candidato: ${p.candidato.nome.valor || "não identificado"} · CPF ${cpfMask} [${p.candidato.nome.fonte || "sem fonte"}]`,
    `E-mail para Migra: ${p.candidato.email.valor || "não identificado"} [${p.candidato.email.fonte || "sem fonte"}]`,
    `Imóvel: ${p.imovel.codigo_fc.valor || [p.imovel.logradouro.valor, p.imovel.apartamento.valor].filter(Boolean).join(", ") || "não identificado"} [${p.imovel.codigo_fc.fonte || p.imovel.logradouro.fonte || "sem fonte"}]`,
    `Aluguel: ${dinheiro(p.imovel.aluguel.valor)} [${p.imovel.aluguel.fonte || "sem fonte"}]`,
    `Renda mensal preliminar: ${dinheiro(p.renda.mensal.valor)} [${p.renda.mensal.fonte || "sem fonte"}]`,
    ...p.renda.documentos.map((d) =>
      `${d.tipo} (${d.periodo || "período não identificado"}, ${d.fonte}): ${scrubMessage(d.resumo)} · ${dinheiro(d.valor_comprovado)}`),
    ...(pendencias.length ? ["Pendências:", ...pendencias.map((v) => `• ${v}`)] : ["Revise os dados e os documentos originais antes de confirmar."]),
  ].join("\n");
}

interface Cupom { previa: PreviaAnalise; hash: string; expira: number; leituras?: Record<string, string> }
function chave(segredo: string) { return createHash("sha256").update(segredo).digest(); }

export function selarPrevia(dados: Cupom, segredo: string, escopo: string): string {
  if (!segredo) throw new Error("secret_missing");
  const iv = randomBytes(12);
  const cifra = createCipheriv("aes-256-gcm", chave(segredo), iv);
  cifra.setAAD(Buffer.from(escopo));
  const conteudo = Buffer.concat([cifra.update(JSON.stringify(dados)), cifra.final()]);
  return Buffer.concat([iv, cifra.getAuthTag(), conteudo]).toString("base64url");
}

export function abrirPrevia(token: string, segredo: string, escopo: string): Cupom | null {
  if (!segredo || token.length > 120000) return null;
  try {
    const bytes = Buffer.from(token, "base64url");
    if (bytes.length < 29) return null;
    const decifra = createDecipheriv("aes-256-gcm", chave(segredo), bytes.subarray(0, 12));
    decifra.setAAD(Buffer.from(escopo));
    decifra.setAuthTag(bytes.subarray(12, 28));
    const bruto = JSON.parse(Buffer.concat([decifra.update(bytes.subarray(28)), decifra.final()]).toString());
    if (typeof bruto.hash !== "string" || typeof bruto.expira !== "number" || bruto.expira < Date.now()) return null;
    const previa = previaSchema.safeParse(bruto.previa);
    const leituras = bruto.leituras && typeof bruto.leituras === "object" && !Array.isArray(bruto.leituras)
      ? Object.fromEntries(Object.entries(bruto.leituras as Record<string, unknown>)
        .filter((v): v is [string, string] => typeof v[0] === "string" && typeof v[1] === "string"))
      : undefined;
    return previa.success ? { previa: previa.data, hash: bruto.hash, expira: bruto.expira, leituras } : null;
  } catch { return null; }
}
