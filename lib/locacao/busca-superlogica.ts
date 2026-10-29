/**
 * Busca só-leitura de pessoas na Superlógica via Brisa Hub.
 *
 * Ferramenta: `buscar_pessoas_superlogica` com `{ pesquisa: nome ou CPF }`.
 * Resposta: `{ resultado, encontrado, status, candidatos, ha_mais }`.
 * Sem match: `status=nao_encontrado` e `candidatos: []`.
 *
 * O CRM não grava o CPF digitado: ele vai só no argumento `pesquisa`, nunca
 * para log, auditoria ou banco. A tela vê no máximo 5 candidatos com o nome
 * parcialmente mascarado. Nada liga o contato sem clique no POST já existente.
 *
 * Cliente injetável: testes passam um mock; produção usa o Hub.
 */
import { chamarFerramentaRemota } from "@/lib/mcp/servidor-externo/chamada";
import { carregarServidorMcpExterno } from "@/lib/mcp/servidor-externo/carregar";
import { idPessoaSuperlogica } from "@/lib/locacao/superlogica-id";
import type { SupabaseClient } from "@supabase/supabase-js";

export { vinculoEmCustomFields } from "@/lib/locacao/superlogica-id";

export const NOME_BUSCA_SUPERLOGICA = "buscar_pessoas_superlogica";

export const TETO_CANDIDATOS = 5;

export const TIPOS_CANDIDATO_HUB = ["locatário", "proprietário", "fiador"] as const;
export type TipoCandidatoHub = (typeof TIPOS_CANDIDATO_HUB)[number];

export type CandidatoBuscaSuperlogica = {
  id: string;
  nome: string;
  tipo: string;
  imovel: string | null;
  contrato: string | null;
};

export type PedidoBuscaSuperlogica = {
  pesquisa: string;
};

export type RespostaBuscaSuperlogica = {
  candidatos: CandidatoBuscaSuperlogica[];
  status: string;
  encontrado: boolean;
  haMais: boolean;
};

export type ClienteBuscaSuperlogica = {
  buscar(pedido: PedidoBuscaSuperlogica): Promise<RespostaBuscaSuperlogica>;
};

export class BuscaSuperlogicaErro extends Error {
  constructor(
    readonly codigo: "tool_unavailable" | "hub_unavailable" | "hub_contract_error",
    message: string,
  ) {
    super(message);
    this.name = "BuscaSuperlogicaErro";
  }
}

let clienteInjetado: ClienteBuscaSuperlogica | null = null;

/** Só teste. Produção nunca chama. */
export function definirClienteBuscaSuperlogicaParaTeste(
  cliente: ClienteBuscaSuperlogica | null,
): void {
  clienteInjetado = cliente;
}

export function clienteBuscaSuperlogica(): ClienteBuscaSuperlogica | null {
  return clienteInjetado;
}

/** Primeiras duas letras de cada palavra; o resto vira asterisco. */
export function mascararNomeParcial(nome: string): string {
  return nome
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((parte) => {
      const letras = Array.from(parte);
      if (letras.length === 0) return "";
      if (letras.length === 1) return `${letras[0]}*`;
      const visivel = letras.slice(0, 2).join("");
      return visivel + "*".repeat(Math.min(letras.length - 2, 8));
    })
    .join(" ");
}

export function tipoParaVinculo(
  tipo: string,
): "locatario" | "fiador" | "proprietario" | undefined {
  const n = tipo.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (n === "inquilino" || n === "locatario") return "locatario";
  if (n === "fiador") return "fiador";
  if (n === "proprietario") return "proprietario";
  return undefined;
}

function textoCurto(v: unknown, teto = 120): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t ? t.slice(0, teto) : null;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v).slice(0, teto);
  return null;
}

export function pesquisaDoPedido(pedido: { pesquisa?: string; nome?: string; cpf?: string }): string {
  const direto = typeof pedido.pesquisa === "string" ? pedido.pesquisa.trim() : "";
  if (direto) return direto.slice(0, 120);
  const nome = typeof pedido.nome === "string" ? pedido.nome.trim() : "";
  if (nome) return nome.slice(0, 120);
  const cpf = typeof pedido.cpf === "string" ? pedido.cpf.replace(/\D/g, "") : "";
  return cpf.slice(0, 14);
}

export function candidatosDaResposta(dados: unknown): CandidatoBuscaSuperlogica[] {
  return interpretarBuscaSuperlogica(dados).candidatos;
}

export function interpretarBuscaSuperlogica(dados: unknown): RespostaBuscaSuperlogica {
  if (!dados || typeof dados !== "object" || Array.isArray(dados)) {
    return { candidatos: [], status: "indisponivel", encontrado: false, haMais: false };
  }
  const d = dados as Record<string, unknown>;
  const status = typeof d.status === "string" ? d.status : typeof d.resultado === "string" ? d.resultado : "";
  const encontrado = d.encontrado === true && status === "ok";
  const haMais = d.ha_mais === true;
  if (status === "nao_encontrado" || d.encontrado === false) {
    return { candidatos: [], status: status || "nao_encontrado", encontrado: false, haMais: false };
  }
  const bruto = d.candidatos;
  if (!encontrado || !Array.isArray(bruto)) {
    return { candidatos: [], status: status || "nao_encontrado", encontrado: false, haMais: false };
  }
  const saida: CandidatoBuscaSuperlogica[] = [];
  for (const item of bruto) {
    if (saida.length >= TETO_CANDIDATOS) break;
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const id = idPessoaSuperlogica(row.id ?? row.superlogica_pessoa_id);
    const nome = textoCurto(row.nome);
    if (!id || !nome) continue;
    saida.push({
      id,
      nome,
      tipo: textoCurto(row.tipo, 40) ?? "",
      imovel: textoCurto(row.imovel),
      contrato: textoCurto(row.contrato, 40),
    });
  }
  return {
    candidatos: saida,
    status: status || "ok",
    encontrado: saida.length > 0,
    haMais,
  };
}

export async function buscarPessoasNoHub(
  admin: SupabaseClient,
  input: {
    orgId: string;
    conversationId: string;
    contactId: string;
    pedido: PedidoBuscaSuperlogica;
  },
): Promise<RespostaBuscaSuperlogica> {
  const pesquisa = pesquisaDoPedido(input.pedido);
  if (pesquisa.length < 2) {
    return { candidatos: [], status: "pedido_invalido", encontrado: false, haMais: false };
  }
  if (clienteInjetado) return clienteInjetado.buscar({ pesquisa });
  const montado = await carregarServidorMcpExterno(admin, input.orgId, {
    contatoDoTurno: input.contactId,
    conversaDoTurno: input.conversationId,
    noAtendimento: true,
  });
  const ferramenta = montado?.ferramentas.find(
    (f) => f.name === NOME_BUSCA_SUPERLOGICA && f.somenteLeitura === true,
  );
  if (!montado || !ferramenta) {
    throw new BuscaSuperlogicaErro(
      "tool_unavailable",
      "A busca na Superlógica não está disponível. Peça à administração para conferir a integração.",
    );
  }
  try {
    const r = await chamarFerramentaRemota(montado.servidor, ferramenta.name, { pesquisa }, {
      cabecalhos: montado.cabecalhos,
      ...(montado.fetch ? { fetch: montado.fetch } : {}),
    });
    return interpretarBuscaSuperlogica(r.dados);
  } catch (err) {
    if (err instanceof BuscaSuperlogicaErro) throw err;
    throw new BuscaSuperlogicaErro(
      "hub_unavailable",
      "Não foi possível consultar a Superlógica agora. Tente novamente.",
    );
  }
}
