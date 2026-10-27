/** Contrato da API publicada pelo Brisa Hub; valores padrão pertencem ao Hub. */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { fetchDeSaida } from "@/lib/mcp/servidor-externo/chamada";
import type { ServidorMcpExterno } from "@/lib/mcp/servidor-externo/registro";

const texto = z.string().trim().min(1).max(240);
const dinheiro = z.number().finite().nonnegative();
const pessoa = z.object({
  cpf: z.string().regex(/^\d{11}$/),
  dados: z.object({
    nome: texto.optional(), email: z.email().max(240).optional(), celular: texto.optional(),
    nascimento: z.iso.date().optional(), rg: texto.optional(), profissao: texto.optional(),
    endereco: texto.optional(), numero: texto.optional(), complemento: texto.optional(),
    bairro: texto.optional(), cep: texto.optional(), cidade: texto.optional(), uf: texto.optional(),
  }).strict().optional(),
}).strict();

export const dadosContratoSchema = z.object({
  imovel: z.object({ endereco: texto, numero: texto.optional(), complemento: texto.optional() }).strict(),
  locatarios: z.array(pessoa).min(1).max(10), fiadores: z.array(pessoa).max(10).optional(),
  aluguel: dinheiro.positive(), data_inicio: z.iso.date(), data_fim: z.iso.date().optional(),
  prazo_meses: z.number().int().positive().max(1200).optional(),
  dia_vencimento: z.number().int().min(1).max(31),
  indice_reajuste: z.enum(["IGPM", "IPCA"]), tipo: z.enum(["residencial", "comercial"]),
  garantia: z.enum(["nenhuma", "caucao", "seguro_fianca", "fiador"]),
  caucao_valor: dinheiro.optional(), seguradora_fianca: texto.optional(), apolice: texto.optional(),
  taxa_adm: dinheiro.optional(), taxa_locacao: dinheiro.optional(),
  observacao: z.string().trim().max(2000).optional(),
  iptu: z.object({ valor_mensal: dinheiro }).strict().optional(),
  seguro_fianca: z.object({ valor_mensal: dinheiro }).strict().optional(),
}).strict();
export type DadosContrato = z.infer<typeof dadosContratoSchema>;

const lista = z.array(z.string().max(4000)).max(100);
export const preparoContratoSchema = z.object({
  pronto: z.boolean(), preview_id: z.string().regex(/^[0-9a-f]{36}$/).optional(),
  validade_s: z.number().positive().optional(),
  resumo: z.object({ texto: z.string().min(1).max(40000) }),
  pendencias: lista, avisos: lista.optional().default([]),
}).refine((v) => !v.pronto || !!v.preview_id);
export const resultadoContratoSchema = z.object({
  gravado: z.boolean(), completo: z.boolean().optional(),
  id_contrato: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]).optional(),
  situacao: z.string().max(100).optional(), divergencias: lista.optional().default([]),
  avisos: lista.optional().default([]), proximo_passo: z.string().max(4000).optional(),
  acao_humana: z.string().max(4000).optional(), acoes_manuais: lista.optional().default([]),
}).refine((v) => !v.gravado || !!v.id_contrato);
export type ResultadoContrato = z.infer<typeof resultadoContratoSchema>;

const reciboSchema = z.object({ preview: z.string().regex(/^[0-9a-f]{36}$/), chave: z.string().uuid(), expira: z.number() });
export function selarContrato(preview: string, validade: number, segredo: string, escopo: string): string {
  const corpo = Buffer.from(JSON.stringify({ preview, chave: randomUUID(),
    expira: Date.now() + Math.min(validade, 1800) * 1000 })).toString("base64url");
  const assinatura = createHmac("sha256", segredo).update(`contrato:${escopo}:${corpo}`).digest("base64url");
  return `${corpo}.${assinatura}`;
}
export function abrirContrato(token: string, segredo: string, escopo: string) {
  try {
    const [corpo, assinatura, sobra] = token.split(".");
    if (!corpo || !assinatura || sobra) return null;
    const esperada = createHmac("sha256", segredo).update(`contrato:${escopo}:${corpo}`).digest();
    const recebida = Buffer.from(assinatura, "base64url");
    if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) return null;
    const recibo = reciboSchema.parse(JSON.parse(Buffer.from(corpo, "base64url").toString()));
    return recibo.expira > Date.now() ? recibo : null;
  } catch { return null; }
}

/** Mesma origem e credencial do cadastro MCP; a API do Hub revalida a permissão de escrita. */
export async function chamarApiContrato(servidor: ServidorMcpExterno, etapa: "preparar" | "confirmar", dados: unknown) {
  const url = new URL(servidor.endpoint);
  if (!/\/mcp\/?$/.test(url.pathname)) throw new Error("hub_endpoint_invalid");
  url.pathname = url.pathname.replace(/\/mcp\/?$/, `/contrato/${etapa}`);
  const resposta = await fetchDeSaida(servidor.endpoint)(url.href, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${servidor.chave}` },
    body: JSON.stringify(dados), signal: AbortSignal.timeout(90_000), redirect: "error",
  });
  if (!resposta.ok) {
    // Nunca repassar erros remotos, que podem incluir CPF ou credenciais.
    throw new Error(resposta.status === 401 || resposta.status === 403 ? "hub_contract_permission" : "hub_contract_failed");
  }
  return resposta.json() as Promise<unknown>;
}
