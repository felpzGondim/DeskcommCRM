/**
 * Leitor SOMENTE LEITURA do pacote 3× (aluguel, condomínio, IPTU,
 * seguro-incêndio) via Brisa Hub. Seguro-fiança fica de fora.
 *
 * O CRM não fala com a Superlógica: só GET no Hub. Contrato em
 * `docs/planos/hub-pacote-imovel-superlogica.md`. Falha do Hub não
 * lança — devolve aviso para o chamador cair na conversa.
 */
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { SupabaseClient } from "@supabase/supabase-js";

import { tabelaLocacao } from "@/lib/locacao/admin";
import { listarProcessosDaConversa } from "@/lib/locacao/repositorio";
import { vinculoDaLinha, vinculoEmCustomFields } from "@/lib/locacao/superlogica-id";
import { logger } from "@/lib/logger";
import { chamarFerramentaRemota, fetchDeSaida } from "@/lib/mcp/servidor-externo/chamada";
import { carregarServidorMcpExterno } from "@/lib/mcp/servidor-externo/carregar";
import { lerEndpointMcpExterno, type ServidorMcpExterno } from "@/lib/mcp/servidor-externo/registro";
import { abrirChaveMcpExterno } from "@/lib/mcp/servidor-externo/segredo";

import {
  AVISO_HUB_INDISPONIVEL,
  avisoDoStatusDoPacote,
} from "@/lib/locacao/locador-do-pacote";

import type {
  CandidatoImovelHub,
  LeitorDePacoteSuperlogica,
  LeituraDePacoteSuperlogica,
  ProprietarioDoPacote,
  StatusDoPacoteHub,
} from "./pacote";

export const NOME_FERRAMENTA_PACOTE_SUPERLOGICA = "ler_pacote_imovel";
export const CAMINHO_PACOTE_HUB = "/imovel/pacote";
export const AVISO_PACOTE_SUPERLOGICA_INDISPONIVEL = AVISO_HUB_INDISPONIVEL;

const TIMEOUT_MS = 8_000;

const COLUNAS_DO_SEGREDO =
  "settings, mcp_externo_chave_encrypted, mcp_externo_chave_iv, mcp_externo_chave_tag";

export type PedidoPacoteHub = {
  idImovel?: number | null;
  idPessoa?: string | null;
  busca?: string | null;
};

export type ClientePacoteHub = {
  get(pedido: PedidoPacoteHub): Promise<unknown>;
};

export type DepsDoLeitorPacoteHub = {
  admin: SupabaseClient;
  conversationId?: string;
  cliente?: ClientePacoteHub;
  fetch?: FetchLike;
};

function avisoSo(status?: StatusDoPacoteHub): LeituraDePacoteSuperlogica {
  return {
    ...(status ? { status } : { status: "indisponivel" }),
    aviso: avisoDoStatusDoPacote(status) ?? AVISO_PACOTE_SUPERLOGICA_INDISPONIVEL,
  };
}

export function numeroImovelSuperlogica(v: unknown): number | null {
  if (typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 999_999_999_999) {
    return v;
  }
  if (typeof v === "string" && /^\d{1,12}$/.test(v.trim())) {
    const n = Number(v.trim());
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  return null;
}

function centavosDoCampo(
  obj: Record<string, unknown>,
  campoCentavos: string,
  campoReais: string,
): number | null {
  const c = obj[campoCentavos];
  if (typeof c === "number" && Number.isFinite(c) && c >= 0) return Math.round(c);
  if (typeof c === "string" && /^\d+$/.test(c.trim())) {
    const n = Number(c.trim());
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  const r = obj[campoReais];
  if (typeof r === "number" && Number.isFinite(r) && r >= 0) return Math.round(r * 100);
  if (typeof r === "string" && r.trim()) {
    const n = Number(r.replace(",", "."));
    if (Number.isFinite(n) && n >= 0) return Math.round(n * 100);
  }
  return null;
}

export function urlDoPacoteHub(endpointMcp: string, pedido: PedidoPacoteHub): URL {
  const url = new URL(endpointMcp);
  if (!/\/mcp\/?$/.test(url.pathname)) {
    throw new Error("hub_endpoint_invalid");
  }
  url.pathname = url.pathname.replace(/\/mcp\/?$/, CAMINHO_PACOTE_HUB);
  if (pedido.idImovel != null) url.searchParams.set("id_imovel", String(pedido.idImovel));
  if (pedido.idPessoa) url.searchParams.set("id_pessoa", pedido.idPessoa);
  if (pedido.busca) url.searchParams.set("busca", pedido.busca);
  return url;
}

function statusDoPacote(v: unknown): StatusDoPacoteHub | "" {
  if (v === "ok" || v === "nao_encontrado" || v === "pedido_invalido"
    || v === "multiplos_contratos" || v === "candidatos"
    || v === "indisponivel" || v === "nao_permitido") {
    return v;
  }
  return "";
}

function candidatoDoHub(v: unknown): CandidatoImovelHub | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const id = numeroImovelSuperlogica(o.id_imovel ?? o.idImovel);
  if (id == null) return null;
  return {
    id_imovel: id,
    codigo: textoOpcional(o.codigo),
    endereco: textoOpcional(o.endereco),
    cep: textoOpcional(o.cep),
  };
}

function proprietarioDoHub(v: unknown): ProprietarioDoPacote | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const contato = o.contato && typeof o.contato === "object" && !Array.isArray(o.contato)
    ? (o.contato as Record<string, unknown>)
    : {};
  const nome = textoOpcional(o.nome);
  const cpfCnpj = textoOpcional(o.cpf_cnpj ?? o.cpfCnpj ?? o.documento);
  const idPessoa = textoOpcional(o.id_pessoa ?? o.idPessoa);
  const email = textoOpcional(contato.email ?? o.email);
  const telefone = textoOpcional(contato.telefone ?? o.telefone);
  if (!nome && !cpfCnpj && !idPessoa && !email && !telefone) return null;
  return { nome, cpfCnpj, idPessoa, email, telefone };
}

export function interpretarPacoteHub(dados: unknown): LeituraDePacoteSuperlogica {
  if (!dados || typeof dados !== "object" || Array.isArray(dados)) return avisoSo();
  const d = dados as Record<string, unknown>;
  const status = statusDoPacote(d.status) || statusDoPacote(d.resultado);
  if (status === "indisponivel" || status === "nao_permitido") return avisoSo(status || "indisponivel");
  if (status === "nao_encontrado" || status === "pedido_invalido" || status === "multiplos_contratos") {
    return avisoSo(status);
  }
  if (status === "candidatos" || Array.isArray(d.candidatos)) {
    const lista = (Array.isArray(d.candidatos) ? d.candidatos : [])
      .map(candidatoDoHub)
      .filter((c): c is CandidatoImovelHub => c != null)
      .slice(0, 20);
    const haMais = d.ha_mais === true || d.haMais === true;
    if (lista.length === 1 && !haMais) {
      return {
        status: "candidatos",
        idImovel: lista[0]!.id_imovel,
        candidatos: lista,
        haMais: false,
      };
    }
    return {
      status: "candidatos",
      candidatos: lista,
      haMais,
      aviso: avisoDoStatusDoPacote("candidatos") ?? undefined,
    };
  }
  if (d.encontrado === false && !status) return avisoSo("nao_encontrado");
  const pacoteBruto = d.pacote && typeof d.pacote === "object" && !Array.isArray(d.pacote)
    ? (d.pacote as Record<string, unknown>)
    : d;
  const aluguel = centavosDoCampo(pacoteBruto, "aluguel_centavos", "aluguel");
  const condominio = centavosDoCampo(pacoteBruto, "condominio_centavos", "condominio");
  const iptu = centavosDoCampo(pacoteBruto, "iptu_centavos", "iptu");
  const seguroIncendio = centavosDoCampo(
    pacoteBruto,
    "seguro_incendio_centavos",
    "seguro_incendio",
  );
  const endereco = textoOpcional(pacoteBruto.endereco ?? pacoteBruto.logradouro);
  const cep = textoOpcional(pacoteBruto.cep);
  const idImovel = numeroImovelSuperlogica(pacoteBruto.id_imovel ?? d.id_imovel);
  const idContrato = numeroImovelSuperlogica(pacoteBruto.id_contrato ?? d.id_contrato);
  const proprietario = proprietarioDoHub(d.proprietario);
  const base: LeituraDePacoteSuperlogica = {
    status: status === "ok" || !status ? "ok" : status,
    ...(idImovel != null ? { idImovel } : {}),
    ...(idContrato != null ? { idContrato } : {}),
    ...(proprietario ? { proprietario } : {}),
    ...(endereco ? { endereco } : {}),
    ...(cep ? { cep } : {}),
  };
  if (aluguel == null && condominio == null && iptu == null && seguroIncendio == null) {
    if (proprietario || endereco || cep || idImovel != null) return base;
    return status === "ok" ? base : avisoSo();
  }
  return {
    ...base,
    ...(aluguel != null ? { aluguelCentavos: aluguel } : {}),
    ...(condominio != null ? { condominioCentavos: condominio } : {}),
    ...(iptu != null ? { iptuCentavos: iptu } : {}),
    ...(seguroIncendio != null ? { seguroIncendioCentavos: seguroIncendio } : {}),
  };
}

function textoOpcional(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, 180) : null;
}

export async function resolverIdsDoPacote(
  admin: SupabaseClient,
  input: {
    orgId: string;
    contactId: string;
    conversationId?: string;
    superlogicaImovelId?: number | null;
    busca?: string | null;
  },
): Promise<PedidoPacoteHub> {
  let idImovel = numeroImovelSuperlogica(input.superlogicaImovelId);
  let idPessoa: string | null = null;
  const busca = input.busca?.trim() || null;

  if (input.contactId) {
    const { data: vinculo } = await admin
      .from("contato_superlogica_vinculos")
      .select("superlogica_pessoa_id,tipos")
      .eq("organization_id", input.orgId)
      .eq("contact_id", input.contactId)
      .eq("ativo", true)
      .maybeSingle();
    idPessoa = vinculoDaLinha(vinculo).superlogica_id_pessoa;
    if (!idPessoa) {
      const { data: contato } = await admin
        .from("contacts")
        .select("custom_fields")
        .eq("organization_id", input.orgId)
        .eq("id", input.contactId)
        .maybeSingle();
      const cf = contato && typeof contato === "object"
        ? (contato as { custom_fields?: unknown }).custom_fields
        : null;
      idPessoa = vinculoEmCustomFields(cf).superlogica_id_pessoa;
    }
  }

  if (idImovel == null && input.conversationId) {
    const processos = await listarProcessosDaConversa(admin, input.orgId, input.conversationId);
    const imovelCrmId = processos
      .map((p) => p.imovel_id)
      .find((id) => typeof id === "string" && id);
    if (typeof imovelCrmId === "string" && imovelCrmId) {
      const { data: imovel } = await tabelaLocacao(admin, "locacao_imoveis")
        .select("superlogica_imovel_id")
        .eq("organization_id", input.orgId)
        .eq("id", imovelCrmId)
        .maybeSingle();
      idImovel = numeroImovelSuperlogica(
        imovel && typeof imovel === "object"
          ? (imovel as { superlogica_imovel_id?: unknown }).superlogica_imovel_id
          : null,
      );
    }
  }

  return { idImovel, idPessoa, busca };
}

async function credencialDoHub(
  admin: SupabaseClient,
  orgId: string,
): Promise<ServidorMcpExterno | null> {
  const { data, error } = await admin
    .from("organizations")
    .select(COLUNAS_DO_SEGREDO)
    .eq("id", orgId)
    .maybeSingle();
  if (error || !data) return null;
  const linha = data as {
    settings?: unknown;
    mcp_externo_chave_encrypted?: unknown;
    mcp_externo_chave_iv?: unknown;
    mcp_externo_chave_tag?: unknown;
  };
  const endpoint = lerEndpointMcpExterno(linha.settings);
  const chave = abrirChaveMcpExterno({
    mcp_externo_chave_encrypted: linha.mcp_externo_chave_encrypted as string | undefined,
    mcp_externo_chave_iv: linha.mcp_externo_chave_iv as string | undefined,
    mcp_externo_chave_tag: linha.mcp_externo_chave_tag as string | undefined,
  });
  if (!endpoint || !chave) return null;
  return { endpoint, chave };
}

async function lerViaHttp(
  servidor: ServidorMcpExterno,
  pedido: PedidoPacoteHub,
  fetchImpl?: FetchLike,
): Promise<{ status: number; dados: unknown } | { status: number; dados: null }> {
  const url = urlDoPacoteHub(servidor.endpoint, pedido);
  const saida = fetchImpl ?? fetchDeSaida(servidor.endpoint);
  const resposta = await saida(url.href, {
    method: "GET",
    headers: { Authorization: "Bearer" + " " + servidor.chave },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "error",
  });
  let dados: unknown = null;
  try {
    dados = await resposta.json();
  } catch {
    dados = null;
  }
  return { status: resposta.status, dados };
}

async function lerViaMcp(
  admin: SupabaseClient,
  input: {
    orgId: string;
    contactId: string;
    conversationId?: string;
  },
  pedido: PedidoPacoteHub,
  fetchImpl?: FetchLike,
): Promise<LeituraDePacoteSuperlogica> {
  const montado = await carregarServidorMcpExterno(admin, input.orgId, {
    ...(input.contactId
      ? {
          contatoDoTurno: input.contactId,
          conversaDoTurno: input.conversationId,
          noAtendimento: true,
        }
      : {}),
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
  const ferramenta = montado?.ferramentas.find(
    (f) => f.name === NOME_FERRAMENTA_PACOTE_SUPERLOGICA && f.somenteLeitura === true,
  );
  if (!montado || !ferramenta) return avisoSo();
  const argumentos: Record<string, unknown> = {};
  if (pedido.idImovel != null) argumentos.id_imovel = pedido.idImovel;
  if (pedido.idPessoa) argumentos.id_pessoa = pedido.idPessoa;
  if (pedido.busca) argumentos.busca = pedido.busca;
  const r = await chamarFerramentaRemota(montado.servidor, ferramenta.name, argumentos, {
    cabecalhos: montado.cabecalhos,
    ...(montado.fetch ? { fetch: montado.fetch } : {}),
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
    timeoutMs: TIMEOUT_MS,
  });
  return interpretarPacoteHub(r.dados);
}

export function criarLeitorPacoteViaHub(deps: DepsDoLeitorPacoteHub): LeitorDePacoteSuperlogica {
  return {
    async ler(input) {
      try {
        const conversationId = input.conversationId ?? deps.conversationId;
        const ids = await resolverIdsDoPacote(deps.admin, {
          orgId: input.orgId,
          contactId: input.contactId,
          conversationId,
          superlogicaImovelId: input.superlogicaImovelId,
          busca: input.busca,
        });
        if (ids.idImovel == null && !ids.idPessoa && !ids.busca) return null;
        if (deps.cliente) {
          const bruto = await deps.cliente.get(ids);
          return interpretarPacoteHub(bruto);
        }
        const servidor = await credencialDoHub(deps.admin, input.orgId);
        if (!servidor) return avisoSo();
        try {
          const http = await lerViaHttp(servidor, ids, deps.fetch);
          if (http.status === 404) {
            return await lerViaMcp(
              deps.admin,
              { orgId: input.orgId, contactId: input.contactId, conversationId },
              ids,
              deps.fetch,
            );
          }
          if (http.status >= 200 && http.status < 300) {
            return interpretarPacoteHub(http.dados);
          }
          return avisoSo();
        } catch {
          return avisoSo();
        }
      } catch (err) {
        logger.warn("pacote superlogica: hub indisponivel; caindo na conversa", {
          organizationId: input.orgId,
          erro: err instanceof Error ? err.name : "desconhecido",
        });
        return avisoSo();
      }
    },
  };
}
