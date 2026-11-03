/**
 * Valida o imóvel na Superlógica (só GET via Hub), grava o id no
 * `locacao_imoveis` e preenche o locador vazio. Sem log de dado pessoal.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { tabelaLocacao } from "@/lib/locacao/admin";
import { pacoteSuperlogicaLigado } from "@/lib/locacao/chaves";
import { criarLeitorPacoteViaHub } from "@/lib/locacao/extrato/leitor-superlogica-hub";
import type {
  CandidatoImovelHub,
  LeitorDePacoteSuperlogica,
  LeituraDePacoteSuperlogica,
} from "@/lib/locacao/extrato/pacote";
import { completarFicha, type FichaPreliminar } from "@/lib/locacao/ficha-schema";
import {
  AVISO_CHAVE_DESLIGADA,
  AVISO_HUB_INDISPONIVEL,
  AVISO_SEM_BUSCA,
  buscaDoImovel,
  locadorMascaradoDoProprietario,
  preencherLocadorNaFicha,
} from "@/lib/locacao/locador-do-pacote";
import type { LocadorDoVinculo } from "@/lib/locacao/locador-do-vinculo";
import { gravarSuperlogicaImovelId, LocacaoErro } from "@/lib/locacao/repositorio";
import { logger } from "@/lib/logger";

export type ResultadoDaValidacaoDoImovel = {
  status: LeituraDePacoteSuperlogica["status"] | "chave_desligada" | "sem_busca";
  aviso: string | null;
  locador: LocadorDoVinculo | null;
  ficha: FichaPreliminar | null;
  candidatos: CandidatoImovelHub[];
  haMais: boolean;
  superlogicaImovelId: number | null;
  idGravado: boolean;
  leitura: LeituraDePacoteSuperlogica | null;
};

function asRec(row: unknown): Record<string, unknown> {
  return (row ?? {}) as Record<string, unknown>;
}

export function buscaDaFicha(ficha: FichaPreliminar | null | undefined): string | null {
  if (!ficha) return null;
  return buscaDoImovel({
    logradouro: ficha.imovel.logradouro.valor,
    numero: ficha.imovel.numero.valor,
    complemento: ficha.imovel.complemento.valor,
    cep: ficha.imovel.cep.valor,
    codigo: ficha.imovel.codigo_fc.valor,
  });
}

export async function lerEnderecoDoImovelCrm(
  admin: SupabaseClient,
  orgId: string,
  imovelId: string,
): Promise<{
  superlogicaImovelId: number | null;
  busca: string | null;
}> {
  const { data } = await tabelaLocacao(admin, "locacao_imoveis")
    .select("superlogica_imovel_id,logradouro,numero,complemento,cep,codigo_fc")
    .eq("organization_id", orgId)
    .eq("id", imovelId)
    .maybeSingle();
  if (!data) return { superlogicaImovelId: null, busca: null };
  const r = asRec(data);
  const id = typeof r.superlogica_imovel_id === "number"
    ? r.superlogica_imovel_id
    : Number(r.superlogica_imovel_id) || null;
  return {
    superlogicaImovelId: id != null && id > 0 ? id : null,
    busca: buscaDoImovel({
      logradouro: typeof r.logradouro === "string" ? r.logradouro : null,
      numero: typeof r.numero === "string" ? r.numero : null,
      complemento: typeof r.complemento === "string" ? r.complemento : null,
      cep: typeof r.cep === "string" ? r.cep : null,
      codigo: typeof r.codigo_fc === "string" ? r.codigo_fc : null,
    }),
  };
}

async function persistirIdSeHouver(
  admin: SupabaseClient,
  input: { orgId: string; imovelId?: string | null; id: number | null },
): Promise<boolean> {
  if (!input.imovelId || input.id == null) return false;
  try {
    const r = await gravarSuperlogicaImovelId(admin, {
      orgId: input.orgId,
      imovelId: input.imovelId,
      superlogicaImovelId: input.id,
    });
    return r === "gravado" || r === "ja_tinha";
  } catch (err) {
    if (err instanceof LocacaoErro) {
      logger.warn("pacote imovel: nao gravou id superlogica", {
        organizationId: input.orgId,
        codigo: err.codigo,
      });
      return false;
    }
    throw err;
  }
}

export async function validarImovelNoSuperlogica(input: {
  admin: SupabaseClient;
  orgId: string;
  contactId: string;
  conversationId?: string;
  settings: unknown;
  ficha?: FichaPreliminar | null;
  imovelId?: string | null;
  idImovel?: number | null;
  busca?: string | null;
  leitor?: LeitorDePacoteSuperlogica;
}): Promise<ResultadoDaValidacaoDoImovel> {
  const vazio = (extra: Partial<ResultadoDaValidacaoDoImovel> = {}): ResultadoDaValidacaoDoImovel => ({
    status: extra.status ?? "indisponivel",
    aviso: extra.aviso ?? null,
    locador: extra.locador ?? null,
    ficha: extra.ficha ?? input.ficha ?? null,
    candidatos: extra.candidatos ?? [],
    haMais: extra.haMais ?? false,
    superlogicaImovelId: extra.superlogicaImovelId ?? null,
    idGravado: extra.idGravado ?? false,
    leitura: extra.leitura ?? null,
  });

  if (!pacoteSuperlogicaLigado(input.settings)) {
    return vazio({ status: "chave_desligada", aviso: AVISO_CHAVE_DESLIGADA });
  }

  let idImovel = input.idImovel ?? null;
  let busca = input.busca?.trim() || null;
  if (input.imovelId) {
    const crm = await lerEnderecoDoImovelCrm(input.admin, input.orgId, input.imovelId);
    if (crm.superlogicaImovelId && idImovel == null) idImovel = crm.superlogicaImovelId;
    if (!busca) busca = crm.busca;
  }
  if (!busca) busca = buscaDaFicha(input.ficha);

  if (idImovel == null && !busca) {
    return vazio({ status: "sem_busca", aviso: AVISO_SEM_BUSCA });
  }

  const leitor = input.leitor ?? criarLeitorPacoteViaHub({
    admin: input.admin,
    conversationId: input.conversationId,
  });

  const ler = async (pedido: { superlogicaImovelId?: number | null; busca?: string | null }) => {
    try {
      return await leitor.ler({
        orgId: input.orgId,
        contactId: input.contactId,
        conversationId: input.conversationId,
        superlogicaImovelId: pedido.superlogicaImovelId ?? null,
        busca: pedido.superlogicaImovelId ? null : (pedido.busca ?? null),
      });
    } catch {
      return { status: "indisponivel" as const, aviso: AVISO_HUB_INDISPONIVEL };
    }
  };

  let leitura = await ler({ superlogicaImovelId: idImovel, busca });
  if (!leitura) {
    return vazio({ status: "indisponivel", aviso: AVISO_HUB_INDISPONIVEL });
  }

  if (leitura.status === "candidatos" && leitura.candidatos?.length === 1 && !leitura.haMais) {
    idImovel = leitura.candidatos[0]!.id_imovel;
    const detalhe = await ler({ superlogicaImovelId: idImovel });
    if (detalhe) leitura = detalhe;
  } else if (leitura.idImovel != null) {
    idImovel = leitura.idImovel;
  }

  if (leitura.status === "candidatos" && (leitura.candidatos?.length ?? 0) > 1) {
    return vazio({
      status: "candidatos",
      aviso: leitura.aviso ?? null,
      candidatos: leitura.candidatos ?? [],
      haMais: leitura.haMais === true,
      leitura,
    });
  }

  const idGravado = await persistirIdSeHouver(input.admin, {
    orgId: input.orgId,
    imovelId: input.imovelId,
    id: leitura.idImovel ?? idImovel,
  });

  const fichaCheia = input.ficha
    ? preencherLocadorNaFicha(completarFicha(input.ficha), leitura.proprietario)
    : null;

  return {
    status: leitura.status ?? (leitura.aviso ? "indisponivel" : "ok"),
    aviso: leitura.aviso ?? null,
    locador: locadorMascaradoDoProprietario(leitura.proprietario),
    ficha: fichaCheia,
    candidatos: leitura.candidatos ?? [],
    haMais: leitura.haMais === true,
    superlogicaImovelId: leitura.idImovel ?? idImovel,
    idGravado,
    leitura,
  };
}

export function pendenciasDoPacote(
  atuais: string[],
  extra: Array<string | null | undefined>,
): string[] {
  return [...new Set([...atuais, ...extra.filter((s): s is string => !!s)])].slice(0, 20);
}
