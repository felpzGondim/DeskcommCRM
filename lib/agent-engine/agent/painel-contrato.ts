/** Contrato da API publicada pelo Brisa Hub; valores padrão pertencem ao Hub. */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { sanitizarTextoDoLead } from "@/lib/escalacao/sanitizar-texto-do-lead";
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
  // Hub PR #23 / contrato-api.md: o painel precisa enviar estes dois.
  // `split` é o repasse PJBank (PR #17/#18); `isencao_multa_meses` é inteiro ≥ 0.
  split: z.boolean(),
  isencao_multa_meses: z.number().int().min(0).max(120),
}).strict();
export type DadosContrato = z.infer<typeof dadosContratoSchema>;

export type PendenciaContrato = { campo: string; pergunta: string };
const pendenciaBruta = z.union([
  z.string().trim().min(1).max(4000),
  z.object({
    campo: z.string().trim().max(200).optional(),
    pergunta: z.string().trim().min(1).max(4000),
  }), // Sem .strict(): o Hub pode mandar chaves extras (ex.: tipo, id_contrato); só campo/pergunta são usados.
]);
export function normalizarPendencia(valor: z.infer<typeof pendenciaBruta>): PendenciaContrato {
  if (typeof valor === "string") return { campo: "", pergunta: valor };
  return { campo: valor.campo ?? "", pergunta: valor.pergunta };
}
export function normalizarPendencias(lista: readonly z.infer<typeof pendenciaBruta>[]): PendenciaContrato[] {
  return lista.map(normalizarPendencia);
}
export function textoDaPendencia(p: string | PendenciaContrato): string {
  if (typeof p === "string") return p;
  return p.campo ? `${p.campo}: ${p.pergunta}` : p.pergunta;
}

const lista = z.array(z.string().max(4000)).max(100);
export const preparoContratoSchema = z.object({
  pronto: z.boolean(), preview_id: z.string().regex(/^[0-9a-f]{36}$/).optional(),
  validade_s: z.number().positive().optional(),
  resumo: z.object({ texto: z.string().min(1).max(40000) }),
  pendencias: z.array(pendenciaBruta).max(100).transform(normalizarPendencias),
  avisos: lista.optional().default([]),
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

export type CodigoErroContrato =
  | "hub_endpoint_invalid"
  | "hub_contract_permission"
  | "hub_contract_unconfigured"
  | "hub_contract_failed";

/** Erro do Hub com recado sanitizado — CPF, token e URL não passam. */
export class ErroApiContrato extends Error {
  constructor(readonly codigo: CodigoErroContrato, readonly detalhe?: string) {
    super(codigo);
    this.name = "ErroApiContrato";
  }
}

const SEGREDO_NO_TEXTO = /\b\d{11}\b|Bearer\s+\S+|dsk_[A-Za-z0-9]+/i;

function textoBrutoDoErroHub(corpo: unknown): string | null {
  if (typeof corpo === "string") {
    const t = corpo.trim();
    if (!t) return null;
    if (t.startsWith("{") || t.startsWith("[")) {
      try { return textoBrutoDoErroHub(JSON.parse(t)); } catch { return t; }
    }
    return t;
  }
  if (!corpo || typeof corpo !== "object") return null;
  const o = corpo as Record<string, unknown>;
  const error = o.error && typeof o.error === "object" && !Array.isArray(o.error)
    ? o.error as Record<string, unknown> : null;
  for (const c of [o.mensagem, o.message, o.detail, o.erro, o.msg, error?.mensagem, error?.message, error?.detail]) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

/** Lê o JSON de erro do Hub e devolve só a frase segura para a tela. */
export function extrairMensagemErroHub(corpo: unknown): string | undefined {
  const bruto = textoBrutoDoErroHub(corpo);
  if (!bruto || SEGREDO_NO_TEXTO.test(bruto)) return undefined;
  return sanitizarTextoDoLead(bruto, 280) ?? undefined;
}

export function codigoErroContrato(status: number): Exclude<CodigoErroContrato, "hub_endpoint_invalid"> {
  if (status === 401 || status === 403) return "hub_contract_permission";
  if (status === 503) return "hub_contract_unconfigured";
  return "hub_contract_failed";
}

/** Mesma origem e credencial do cadastro MCP; a API do Hub revalida a permissão de escrita. */
export async function chamarApiContrato(servidor: ServidorMcpExterno, etapa: "preparar" | "confirmar", dados: unknown) {
  const url = new URL(servidor.endpoint);
  if (!/\/mcp\/?$/.test(url.pathname)) throw new ErroApiContrato("hub_endpoint_invalid");
  // Canônico do painel (brisa-hub PR #23, docs/contrato-api.md): mesmo host do /mcp.
  // /contratos/preparar-criacao é outra API (plugin SuperLógica), não esta.
  url.pathname = url.pathname.replace(/\/mcp\/?$/, `/contrato/${etapa}`);
  const resposta = await fetchDeSaida(servidor.endpoint)(url.href, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${servidor.chave}` },
    body: JSON.stringify(dados), signal: AbortSignal.timeout(90_000), redirect: "error",
  });
  if (!resposta.ok) {
    let corpo: unknown = null;
    try { corpo = await resposta.json(); } catch { /* corpo vazio ou não-JSON */ }
    throw new ErroApiContrato(codigoErroContrato(resposta.status), extrairMensagemErroHub(corpo));
  }
  return resposta.json() as Promise<unknown>;
}
