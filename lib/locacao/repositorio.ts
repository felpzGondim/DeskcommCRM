/**
 * Persistência do processo de locação. Service role + organization_id da sessão.
 * Audit e logs nunca levam CPF, nome, telefone ou valores da ficha.
 */
import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { chaveEndereco, codigoFc, type PartesDoEndereco } from "@/lib/locacao/endereco";
import { tabelaLocacao } from "@/lib/locacao/admin";
import { ehStatusFinal, transicaoPermitida, type StatusDoProcesso } from "@/lib/locacao/status";
import type {
  EstadoDaAnaliseFc,
  EstadoDaAnaliseSeguro,
  MotivoDeCancelamento,
  OrigemDaAnalise,
  OrigemDaConversaDoProcesso,
  OrigemDaFichaDoProcesso,
  OrigemDoVinculoSuperlogica,
  PapelDoProcesso,
  RelacaoDeContatoDoProcesso,
  TipoDeEventoDoProcesso,
} from "@/lib/locacao/vocabulario";

export class LocacaoErro extends Error {
  constructor(readonly codigo: string, message: string) {
    super(message);
    this.name = "LocacaoErro";
  }
}

function asRec(row: unknown): Record<string, unknown> {
  return (row ?? {}) as Record<string, unknown>;
}

export async function buscarImovelParecido(
  admin: SupabaseClient,
  orgId: string,
  partes: PartesDoEndereco,
  superlogicaImovelId?: number | null,
): Promise<Record<string, unknown>[]> {
  const chave = chaveEndereco(partes);
  if (superlogicaImovelId) {
    const { data } = await tabelaLocacao(admin, "locacao_imoveis")
      .select("id,logradouro,numero,complemento,chave_endereco,superlogica_imovel_id")
      .eq("organization_id", orgId)
      .eq("superlogica_imovel_id", superlogicaImovelId)
      .maybeSingle();
    if (data) return [asRec(data)];
  }
  const { data } = await tabelaLocacao(admin, "locacao_imoveis")
    .select("id,logradouro,numero,complemento,chave_endereco,superlogica_imovel_id")
    .eq("organization_id", orgId)
    .eq("chave_endereco", chave)
    .limit(5);
  return (data ?? []).map(asRec);
}

export async function criarOuReusarImovel(
  admin: SupabaseClient,
  orgId: string,
  partes: PartesDoEndereco & { bairro?: string; cidade?: string; uf?: string; tipo?: string | null },
  opts?: { superlogicaImovelId?: number | null; catalogProductId?: string | null; imovelId?: string | null },
): Promise<string> {
  if (opts?.imovelId) return opts.imovelId;
  const achados = await buscarImovelParecido(admin, orgId, partes, opts?.superlogicaImovelId);
  if (achados[0]?.id) return String(achados[0].id);
  const { data, error } = await tabelaLocacao(admin, "locacao_imoveis").insert({
    organization_id: orgId,
    logradouro: partes.logradouro,
    numero: partes.numero ?? null,
    complemento: partes.complemento ?? null,
    bairro: partes.bairro ?? null,
    cidade: partes.cidade ?? null,
    uf: partes.uf ?? null,
    cep: partes.cep ?? null,
    chave_endereco: chaveEndereco(partes),
    codigo_fc: codigoFc(partes),
    tipo: partes.tipo ?? null,
    superlogica_imovel_id: opts?.superlogicaImovelId ?? null,
    catalog_product_id: opts?.catalogProductId ?? null,
  }).select("id").single();
  if (error || !data) throw new LocacaoErro("imovel_gravacao", "imovel");
  return String(asRec(data).id);
}

export async function gravarEvento(
  admin: SupabaseClient,
  input: {
    orgId: string;
    processoId: string;
    tipo: TipoDeEventoDoProcesso;
    de?: string | null;
    para?: string | null;
    atorTipo: "usuario" | "sistema" | "hub";
    atorId?: string | null;
    detalhe?: Record<string, unknown>;
  },
): Promise<void> {
  await tabelaLocacao(admin, "locacao_processo_eventos").insert({
    organization_id: input.orgId,
    processo_id: input.processoId,
    tipo: input.tipo,
    de: input.de ?? null,
    para: input.para ?? null,
    ator_tipo: input.atorTipo,
    ator_id: input.atorId ?? null,
    detalhe: input.detalhe ?? {},
  });
}

export async function criarProcesso(
  admin: SupabaseClient,
  input: {
    orgId: string;
    userId: string;
    imovelId: string;
    conversationId: string;
    contactId: string | null;
    papelInicial: PapelDoProcesso;
    relacao?: RelacaoDeContatoDoProcesso | null;
  },
): Promise<string> {
  const processoId = randomUUID();
  const { error } = await tabelaLocacao(admin, "locacao_processos").insert({
    id: processoId,
    organization_id: input.orgId,
    imovel_id: input.imovelId,
    status: "lead",
    created_by: input.userId,
  });
  if (error) throw new LocacaoErro("processo_gravacao", "processo");
  await tabelaLocacao(admin, "locacao_processo_participantes").insert({
    organization_id: input.orgId,
    processo_id: processoId,
    contact_id: input.contactId,
    papel: input.papelInicial,
    relacao: input.papelInicial === "contato" ? (input.relacao ?? "outro") : null,
    principal: input.papelInicial === "locatario",
    interlocutor_principal: true,
    created_by: input.userId,
  });
  await tabelaLocacao(admin, "locacao_processo_conversas").insert({
    organization_id: input.orgId,
    processo_id: processoId,
    conversation_id: input.conversationId,
    origem: "criacao" satisfies OrigemDaConversaDoProcesso,
    created_by: input.userId,
  });
  await gravarEvento(admin, {
    orgId: input.orgId, processoId, tipo: "status", de: null, para: "lead",
    atorTipo: "usuario", atorId: input.userId, detalhe: { origem: "criacao" },
  });
  return processoId;
}

export async function lerProcesso(
  admin: SupabaseClient,
  orgId: string,
  processoId: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await tabelaLocacao(admin, "locacao_processos")
    .select("id,imovel_id,status,status_mudou_em,motivo_status,motivo_cancelamento,ficha_versao_atual,aprovado_por,aprovado_em,superlogica_contrato_id,encerrado_em,created_at,renda_confirmada_em,renda_confirmada_por,renda_confirmada_ficha_versao")
    .eq("organization_id", orgId).eq("id", processoId).maybeSingle();
  return data ? asRec(data) : null;
}

export async function lerFichaAtualDoProcesso(
  admin: SupabaseClient,
  orgId: string,
  processoId: string,
): Promise<{ versao: number; origem: string; ficha: unknown; campos_alterados: string[] } | null> {
  const proc = await lerProcesso(admin, orgId, processoId);
  const versao = Number(asRec(proc).ficha_versao_atual ?? 0);
  if (!proc || versao <= 0) return null;
  const { data } = await tabelaLocacao(admin, "locacao_processo_fichas")
    .select("versao,origem,ficha,campos_alterados")
    .eq("organization_id", orgId).eq("processo_id", processoId).eq("versao", versao)
    .maybeSingle();
  if (!data) return null;
  const row = asRec(data);
  return {
    versao: Number(row.versao ?? versao),
    origem: typeof row.origem === "string" ? row.origem : "preliminar_ia",
    ficha: row.ficha,
    campos_alterados: Array.isArray(row.campos_alterados)
      ? row.campos_alterados.filter((v): v is string => typeof v === "string")
      : [],
  };
}

export async function listarProcessosDaConversa(
  admin: SupabaseClient,
  orgId: string,
  conversationId: string,
): Promise<Record<string, unknown>[]> {
  const { data: ligacoes } = await tabelaLocacao(admin, "locacao_processo_conversas")
    .select("processo_id,ultimo_uso_em")
    .eq("organization_id", orgId).eq("conversation_id", conversationId)
    .order("ultimo_uso_em", { ascending: false });
  const ids = (ligacoes ?? []).map((l) => String(asRec(l).processo_id));
  if (ids.length === 0) return [];
  const { data } = await tabelaLocacao(admin, "locacao_processos")
    .select("id,imovel_id,status,encerrado_em,status_mudou_em,renda_confirmada_em")
    .eq("organization_id", orgId).in("id", ids);
  const porId = new Map((data ?? []).map((p) => [String(asRec(p).id), asRec(p)]));
  return ids.map((id) => porId.get(id)).filter((p): p is Record<string, unknown> => !!p);
}

export async function mudarStatus(
  admin: SupabaseClient,
  input: {
    orgId: string;
    processoId: string;
    de: StatusDoProcesso;
    para: StatusDoProcesso;
    quem: "atendente" | "aprovador" | "sistema";
    userId: string | null;
    motivo?: string | null;
    motivoCancelamento?: MotivoDeCancelamento | null;
  },
): Promise<void> {
  const regra = transicaoPermitida(input.de, input.para, input.quem);
  if (!regra) throw new LocacaoErro("transicao_recusada", "status");
  if (regra.exigeMotivo && !input.motivo?.trim()) throw new LocacaoErro("motivo_obrigatorio", "motivo");
  const encerrar = ehStatusFinal(input.para);
  const patch: Record<string, unknown> = {
    status: input.para,
    status_mudou_em: new Date().toISOString(),
    motivo_status: input.motivo?.slice(0, 180) ?? null,
  };
  if (input.para === "cancelado") patch.motivo_cancelamento = input.motivoCancelamento ?? "outro";
  if (input.para === "aprovado") {
    patch.aprovado_por = input.userId;
    patch.aprovado_em = new Date().toISOString();
  }
  if (encerrar) patch.encerrado_em = new Date().toISOString();
  const { error } = await tabelaLocacao(admin, "locacao_processos")
    .update(patch).eq("organization_id", input.orgId).eq("id", input.processoId).eq("status", input.de);
  if (error) throw new LocacaoErro("status_gravacao", "status");
  await gravarEvento(admin, {
    orgId: input.orgId, processoId: input.processoId, tipo: "status",
    de: input.de, para: input.para,
    atorTipo: input.quem === "sistema" ? "sistema" : "usuario",
    atorId: input.userId, detalhe: { motivo: input.motivo ? true : false },
  });
}

export async function listarParticipantes(
  admin: SupabaseClient,
  orgId: string,
  processoId: string,
): Promise<Record<string, unknown>[]> {
  const { data } = await tabelaLocacao(admin, "locacao_processo_participantes")
    .select("id,contact_id,papel,relacao,principal,interlocutor_principal,fracao,nome_exibicao,cpf_mascarado,removido_em")
    .eq("organization_id", orgId).eq("processo_id", processoId)
    .is("removido_em", null);
  return (data ?? []).map(asRec);
}

/** Hash incluso: só no servidor da análise FC. Nunca vai para a tela. */
export async function listarParticipantesParaFc(
  admin: SupabaseClient,
  orgId: string,
  processoId: string,
): Promise<Record<string, unknown>[]> {
  const { data } = await tabelaLocacao(admin, "locacao_processo_participantes")
    .select("id,papel,principal,cpf_hash,cpf_mascarado,removido_em")
    .eq("organization_id", orgId).eq("processo_id", processoId)
    .is("removido_em", null);
  return (data ?? []).map(asRec);
}

export async function lerParticipanteDoProcesso(
  admin: SupabaseClient,
  orgId: string,
  processoId: string,
  participanteId: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await tabelaLocacao(admin, "locacao_processo_participantes")
    .select("id,papel,principal,cpf_hash,cpf_mascarado,removido_em")
    .eq("organization_id", orgId).eq("processo_id", processoId)
    .eq("id", participanteId).maybeSingle();
  if (!data || asRec(data).removido_em) return null;
  return asRec(data);
}

export async function adicionarParticipante(
  admin: SupabaseClient,
  input: {
    orgId: string;
    processoId: string;
    userId: string;
    contactId?: string | null;
    papel: PapelDoProcesso;
    relacao?: RelacaoDeContatoDoProcesso | null;
    principal?: boolean;
    cpfHash?: string | null;
    cpfMascarado?: string | null;
    cpfEncrypted?: Uint8Array | null;
    nomeExibicao?: string | null;
    fracao?: number | null;
  },
): Promise<string> {
  const { data, error } = await tabelaLocacao(admin, "locacao_processo_participantes").insert({
    organization_id: input.orgId,
    processo_id: input.processoId,
    contact_id: input.contactId ?? null,
    papel: input.papel,
    relacao: input.papel === "contato" ? (input.relacao ?? "outro") : null,
    principal: input.principal ?? false,
    cpf_hash: input.cpfHash ?? null,
    cpf_mascarado: input.cpfMascarado ?? null,
    cpf_encrypted: input.cpfEncrypted ?? null,
    nome_exibicao: input.nomeExibicao ?? null,
    fracao: input.fracao ?? null,
    created_by: input.userId,
  }).select("id").single();
  if (error || !data) throw new LocacaoErro("participante_gravacao", "participante");
  const id = String(asRec(data).id);
  await gravarEvento(admin, {
    orgId: input.orgId, processoId: input.processoId, tipo: "participante",
    atorTipo: "usuario", atorId: input.userId,
    detalhe: { participante_id: id, papel: input.papel },
  });
  return id;
}

export async function ligarConversa(
  admin: SupabaseClient,
  input: { orgId: string; processoId: string; conversationId: string; userId: string; origem?: OrigemDaConversaDoProcesso },
): Promise<void> {
  const { error } = await tabelaLocacao(admin, "locacao_processo_conversas").insert({
    organization_id: input.orgId,
    processo_id: input.processoId,
    conversation_id: input.conversationId,
    origem: input.origem ?? "manual",
    created_by: input.userId,
  });
  if (error && !String(error.message).includes("duplicate")) {
    throw new LocacaoErro("conversa_gravacao", "conversa");
  }
  await tabelaLocacao(admin, "locacao_processo_conversas").update({
    ultimo_uso_em: new Date().toISOString(),
  }).eq("organization_id", input.orgId).eq("processo_id", input.processoId)
    .eq("conversation_id", input.conversationId);
}

export async function gravarFichaDoProcesso(
  admin: SupabaseClient,
  input: {
    orgId: string;
    processoId: string;
    userId: string;
    ficha: unknown;
    origem: OrigemDaFichaDoProcesso;
    baseVersao: number | null;
    camposAlterados: string[];
  },
): Promise<number> {
  const { data: proc } = await tabelaLocacao(admin, "locacao_processos")
    .select("ficha_versao_atual").eq("organization_id", input.orgId).eq("id", input.processoId).maybeSingle();
  const atual = Number(asRec(proc).ficha_versao_atual ?? 0);
  if (input.baseVersao !== atual) throw new LocacaoErro("ficha_conflito_de_versao", "ficha");
  const versao = atual + 1;
  const { error } = await tabelaLocacao(admin, "locacao_processo_fichas").insert({
    organization_id: input.orgId,
    processo_id: input.processoId,
    versao,
    base_versao: input.baseVersao,
    ficha: input.ficha,
    origem: input.origem,
    campos_alterados: input.camposAlterados,
    alterado_por: input.userId,
  });
  if (error) throw new LocacaoErro("ficha_gravacao", "ficha");
  await tabelaLocacao(admin, "locacao_processos").update({ ficha_versao_atual: versao })
    .eq("organization_id", input.orgId).eq("id", input.processoId);
  await gravarEvento(admin, {
    orgId: input.orgId, processoId: input.processoId, tipo: "ficha",
    atorTipo: "usuario", atorId: input.userId,
    detalhe: { versao, campos: input.camposAlterados },
  });
  return versao;
}

const COLUNAS_FC =
  "id,processo_id,participante_id,cpf_hash,pedido_id,hub_job_id,estado,origem,documento_id,resultado,erro_codigo,hub_estado,reaproveitou_de,autorizado_por,autorizado_em,concluida_em,ficha_versao";

export async function lerAnaliseFcEmAndamento(
  admin: SupabaseClient,
  orgId: string,
  cpfHash: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await tabelaLocacao(admin, "locacao_analises_fc")
    .select(COLUNAS_FC)
    .eq("organization_id", orgId).eq("cpf_hash", cpfHash)
    .in("estado", ["solicitada", "aguardando_cobranca", "cobrando"])
    .maybeSingle();
  return data ? asRec(data) : null;
}

export async function fcEmAndamento(
  admin: SupabaseClient,
  orgId: string,
  cpfHash: string,
): Promise<boolean> {
  return !!(await lerAnaliseFcEmAndamento(admin, orgId, cpfHash));
}

export async function lerAnaliseFc(
  admin: SupabaseClient,
  orgId: string,
  pedidoId: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await tabelaLocacao(admin, "locacao_analises_fc")
    .select(COLUNAS_FC)
    .eq("organization_id", orgId).eq("pedido_id", pedidoId).maybeSingle();
  return data ? asRec(data) : null;
}

export async function lerAnaliseFcMaisRecenteDoParticipante(
  admin: SupabaseClient,
  orgId: string,
  processoId: string,
  participanteId: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await tabelaLocacao(admin, "locacao_analises_fc")
    .select(COLUNAS_FC)
    .eq("organization_id", orgId).eq("processo_id", processoId)
    .eq("participante_id", participanteId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data ? asRec(data) : null;
}

export async function lerAnaliseFcMaisRecenteDoProcesso(
  admin: SupabaseClient,
  orgId: string,
  processoId: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await tabelaLocacao(admin, "locacao_analises_fc")
    .select(COLUNAS_FC)
    .eq("organization_id", orgId).eq("processo_id", processoId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data ? asRec(data) : null;
}

export async function fcReaproveitavel(
  admin: SupabaseClient,
  orgId: string,
  cpfHash: string,
  dias = 90,
): Promise<Record<string, unknown> | null> {
  const corte = new Date(Date.now() - dias * 86400000).toISOString();
  const { data } = await tabelaLocacao(admin, "locacao_analises_fc")
    .select("id,resultado,concluida_em,processo_id")
    .eq("organization_id", orgId).eq("cpf_hash", cpfHash).eq("estado", "concluida")
    .gte("concluida_em", corte)
    .order("concluida_em", { ascending: false }).limit(1).maybeSingle();
  return data ? asRec(data) : null;
}

export async function abrirAnaliseFc(
  admin: SupabaseClient,
  input: {
    orgId: string; processoId: string; participanteId: string; userId: string;
    cpfHash: string | null; fichaVersao: number | null; reaproveitouDe?: string | null;
  },
): Promise<string> {
  const pedidoId = randomUUID();
  const { error } = await tabelaLocacao(admin, "locacao_analises_fc").insert({
    organization_id: input.orgId,
    processo_id: input.processoId,
    participante_id: input.participanteId,
    cpf_hash: input.cpfHash,
    pedido_id: pedidoId,
    ficha_versao: input.fichaVersao,
    estado: input.reaproveitouDe ? "reaproveitada" : "solicitada",
    reaproveitou_de: input.reaproveitouDe ?? null,
    autorizado_por: input.userId,
    autorizado_em: new Date().toISOString(),
    concluida_em: input.reaproveitouDe ? new Date().toISOString() : null,
  });
  if (error?.code === "23505" && input.cpfHash && !input.reaproveitouDe) {
    const corrida = await lerAnaliseFcEmAndamento(admin, input.orgId, input.cpfHash);
    const reuso = typeof corrida?.pedido_id === "string" ? corrida.pedido_id : "";
    if (reuso) return reuso;
  }
  if (error) throw new LocacaoErro("analise_fc_gravacao", "analise_fc");
  await gravarEvento(admin, {
    orgId: input.orgId, processoId: input.processoId, tipo: "analise_fc",
    atorTipo: "usuario", atorId: input.userId,
    detalhe: { pedido_id: pedidoId, reaproveitada: !!input.reaproveitouDe },
  });
  return pedidoId;
}

export async function marcarEstadoAnaliseFc(
  admin: SupabaseClient,
  input: {
    orgId: string; pedidoId: string;
    estado: EstadoDaAnaliseFc;
    hubJobId?: string | null;
    hubEstado?: string | null;
    resultado?: Record<string, unknown> | null;
    documentoId?: string | null;
    erroCodigo?: string | null;
    autorizadoPor?: string | null;
  },
): Promise<void> {
  const patch: Record<string, unknown> = { estado: input.estado };
  if (input.hubJobId !== undefined) patch.hub_job_id = input.hubJobId;
  if (input.hubEstado !== undefined) patch.hub_estado = input.hubEstado;
  if (input.resultado !== undefined) patch.resultado = input.resultado;
  if (input.documentoId !== undefined) patch.documento_id = input.documentoId;
  if (input.erroCodigo !== undefined) patch.erro_codigo = input.erroCodigo;
  if (input.autorizadoPor !== undefined) {
    patch.autorizado_por = input.autorizadoPor;
    patch.autorizado_em = new Date().toISOString();
  }
  const { error } = await tabelaLocacao(admin, "locacao_analises_fc")
    .update(patch).eq("organization_id", input.orgId).eq("pedido_id", input.pedidoId);
  if (error) throw new LocacaoErro("analise_fc_estado", "analise_fc");
  // A janela de reuso de 90 dias lê concluida_em. Atualizar FC numa linha já
  // concluída não pode recarregar o prazo — só carimba a primeira virada.
  if (input.estado === "concluida" || input.estado === "reaproveitada") {
    const { error: stampErr } = await tabelaLocacao(admin, "locacao_analises_fc")
      .update({ concluida_em: new Date().toISOString() })
      .eq("organization_id", input.orgId).eq("pedido_id", input.pedidoId)
      .is("concluida_em", null);
    if (stampErr) throw new LocacaoErro("analise_fc_estado", "analise_fc");
  }
}

export async function guardarLaudoFc(
  admin: SupabaseClient,
  input: {
    orgId: string;
    processoId: string;
    userId: string;
    participanteId?: string | null;
    bytes: Buffer;
    mime: string;
    ext: "pdf" | "png" | "jpg" | "webp";
  },
): Promise<string> {
  const docId = randomUUID();
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const md5 = createHash("md5").update(input.bytes).digest("hex");
  const path = `${input.orgId}/processos/${input.processoId}/laudo_fc/${docId}.${input.ext}`;
  const { error: upErr } = await admin.storage.from("locacao-processos").upload(path, input.bytes, {
    contentType: input.mime,
    upsert: false,
  });
  if (upErr) throw new LocacaoErro("analise_fc_laudo", "analise_fc");
  const { error } = await tabelaLocacao(admin, "locacao_processo_documentos").insert({
    id: docId,
    organization_id: input.orgId,
    processo_id: input.processoId,
    participante_id: input.participanteId ?? null,
    categoria: "laudo_fc",
    origem: "hub_fc",
    storage_path: path,
    mime: input.mime,
    tamanho_bytes: input.bytes.length,
    sha256,
    md5,
    created_by: input.userId,
  });
  if (error) throw new LocacaoErro("analise_fc_laudo", "analise_fc");
  return docId;
}

const COLUNAS_SEGURO =
  "id,processo_id,participante_id,pedido_id,hub_job_id,estado,origem,documento_id,resultado,erro_codigo,hub_estado,concluida_em,ficha_versao";

export async function lerAnaliseSeguroEmAndamento(
  admin: SupabaseClient,
  orgId: string,
  processoId: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await tabelaLocacao(admin, "locacao_analises_seguro")
    .select(COLUNAS_SEGURO)
    .eq("organization_id", orgId).eq("processo_id", processoId)
    .in("estado", ["solicitada", "cotando"])
    .maybeSingle();
  return data ? asRec(data) : null;
}

export async function lerAnaliseSeguroMaisRecente(
  admin: SupabaseClient,
  orgId: string,
  processoId: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await tabelaLocacao(admin, "locacao_analises_seguro")
    .select(COLUNAS_SEGURO)
    .eq("organization_id", orgId).eq("processo_id", processoId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? asRec(data) : null;
}

export async function seguroEmAndamento(
  admin: SupabaseClient,
  orgId: string,
  processoId: string,
): Promise<boolean> {
  return !!(await lerAnaliseSeguroEmAndamento(admin, orgId, processoId));
}

export async function lerAnaliseSeguro(
  admin: SupabaseClient,
  orgId: string,
  pedidoId: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await tabelaLocacao(admin, "locacao_analises_seguro")
    .select(COLUNAS_SEGURO)
    .eq("organization_id", orgId).eq("pedido_id", pedidoId).maybeSingle();
  return data ? asRec(data) : null;
}

export async function abrirAnaliseSeguro(
  admin: SupabaseClient,
  input: {
    orgId: string; processoId: string; userId: string;
    participanteId?: string | null; fichaVersao?: number | null;
    origem?: OrigemDaAnalise;
  },
): Promise<{ pedidoId: string; reusou: boolean }> {
  const existente = await lerAnaliseSeguroEmAndamento(admin, input.orgId, input.processoId);
  const pedidoExistente = typeof existente?.pedido_id === "string" ? existente.pedido_id : "";
  if (pedidoExistente) return { pedidoId: pedidoExistente, reusou: true };

  const pedidoId = randomUUID();
  const { error } = await tabelaLocacao(admin, "locacao_analises_seguro").insert({
    organization_id: input.orgId,
    processo_id: input.processoId,
    participante_id: input.participanteId ?? null,
    pedido_id: pedidoId,
    ficha_versao: input.fichaVersao ?? null,
    estado: "solicitada",
    origem: input.origem ?? "hub",
    autorizado_por: input.userId,
    autorizado_em: new Date().toISOString(),
  });
  if (error?.code === "23505") {
    const corrida = await lerAnaliseSeguroEmAndamento(admin, input.orgId, input.processoId);
    const reuso = typeof corrida?.pedido_id === "string" ? corrida.pedido_id : "";
    if (reuso) return { pedidoId: reuso, reusou: true };
    throw new LocacaoErro("analise_seguro_gravacao", "analise_seguro");
  }
  if (error) throw new LocacaoErro("analise_seguro_gravacao", "analise_seguro");
  await gravarEvento(admin, {
    orgId: input.orgId, processoId: input.processoId, tipo: "migra",
    atorTipo: "usuario", atorId: input.userId,
    detalhe: { pedido_id: pedidoId, origem: input.origem ?? "hub" },
  });
  return { pedidoId, reusou: false };
}

export async function guardarPrintMigra(
  admin: SupabaseClient,
  input: {
    orgId: string;
    processoId: string;
    userId: string;
    participanteId?: string | null;
    bytes: Buffer;
    mime: string;
    ext: "png" | "jpg" | "webp" | "pdf";
  },
): Promise<string> {
  const docId = randomUUID();
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const md5 = createHash("md5").update(input.bytes).digest("hex");
  const path = `${input.orgId}/processos/${input.processoId}/cotacao_seguro/${docId}.${input.ext}`;
  const { error: upErr } = await admin.storage.from("locacao-processos").upload(path, input.bytes, {
    contentType: input.mime,
    upsert: false,
  });
  if (upErr) throw new LocacaoErro("analise_seguro_print", "analise_seguro");
  const { error } = await tabelaLocacao(admin, "locacao_processo_documentos").insert({
    id: docId,
    organization_id: input.orgId,
    processo_id: input.processoId,
    participante_id: input.participanteId ?? null,
    categoria: "cotacao_seguro",
    origem: "hub_migra",
    storage_path: path,
    mime: input.mime,
    tamanho_bytes: input.bytes.length,
    sha256,
    md5,
    created_by: input.userId,
  });
  if (error) throw new LocacaoErro("analise_seguro_print", "analise_seguro");
  return docId;
}

export async function marcarEstadoAnaliseSeguro(
  admin: SupabaseClient,
  input: {
    orgId: string; pedidoId: string;
    estado: EstadoDaAnaliseSeguro;
    hubJobId?: string | null;
    hubEstado?: string | null;
    resultado?: Record<string, unknown> | null;
    documentoId?: string | null;
    erroCodigo?: string | null;
  },
): Promise<void> {
  const patch: Record<string, unknown> = { estado: input.estado };
  if (input.hubJobId !== undefined) patch.hub_job_id = input.hubJobId;
  if (input.hubEstado !== undefined) patch.hub_estado = input.hubEstado;
  if (input.resultado !== undefined) patch.resultado = input.resultado;
  if (input.documentoId !== undefined) patch.documento_id = input.documentoId;
  if (input.erroCodigo !== undefined) patch.erro_codigo = input.erroCodigo;
  if (input.estado === "concluida") patch.concluida_em = new Date().toISOString();
  const { error } = await tabelaLocacao(admin, "locacao_analises_seguro")
    .update(patch).eq("organization_id", input.orgId).eq("pedido_id", input.pedidoId);
  if (error) throw new LocacaoErro("analise_seguro_estado", "analise_seguro");
}

export async function confirmarRendaDoProcesso(
  admin: SupabaseClient,
  input: { orgId: string; processoId: string; userId: string; fichaVersao: number },
): Promise<void> {
  const { error } = await tabelaLocacao(admin, "locacao_processos").update({
    renda_confirmada_em: new Date().toISOString(),
    renda_confirmada_por: input.userId,
    renda_confirmada_ficha_versao: input.fichaVersao,
  }).eq("organization_id", input.orgId).eq("id", input.processoId);
  if (error) throw new LocacaoErro("renda_confirmacao", "renda");
  await gravarEvento(admin, {
    orgId: input.orgId, processoId: input.processoId, tipo: "renda",
    atorTipo: "usuario", atorId: input.userId,
    detalhe: { ficha_versao: input.fichaVersao, confirmada: true },
  });
}

export async function gravarRascunhoRelatorio(
  admin: SupabaseClient,
  input: { orgId: string; processoId: string; userId: string; texto: string },
): Promise<void> {
  const { error } = await tabelaLocacao(admin, "locacao_processos").update({
    relatorio_rascunho: input.texto,
    relatorio_rascunho_em: new Date().toISOString(),
    relatorio_rascunho_por: input.userId,
  }).eq("organization_id", input.orgId).eq("id", input.processoId);
  if (error) throw new LocacaoErro("relatorio_rascunho", "relatorio");
  await gravarEvento(admin, {
    orgId: input.orgId, processoId: input.processoId, tipo: "relatorio",
    atorTipo: "usuario", atorId: input.userId,
    detalhe: { rascunho: true },
  });
}

export async function marcarRelatorioAprovado(
  admin: SupabaseClient,
  input: { orgId: string; processoId: string; userId: string; documentoId: string },
): Promise<void> {
  const { error } = await tabelaLocacao(admin, "locacao_processos").update({
    relatorio_aprovado_em: new Date().toISOString(),
    relatorio_aprovado_por: input.userId,
    relatorio_documento_id: input.documentoId,
    relatorio_rascunho: null,
  }).eq("organization_id", input.orgId).eq("id", input.processoId);
  if (error) throw new LocacaoErro("relatorio_aprovacao", "relatorio");
  await gravarEvento(admin, {
    orgId: input.orgId, processoId: input.processoId, tipo: "relatorio",
    atorTipo: "usuario", atorId: input.userId,
    detalhe: { documento_id: input.documentoId, aprovado: true },
  });
}

export async function ligarVinculoManual(
  admin: SupabaseClient,
  input: {
    orgId: string; contactId: string; pessoaId: string; userId: string;
    tipos?: string[]; origem?: OrigemDoVinculoSuperlogica;
  },
): Promise<string> {
  const { data: existente } = await tabelaLocacao(admin, "contato_superlogica_vinculos")
    .select("id,superlogica_pessoa_id").eq("organization_id", input.orgId)
    .eq("contact_id", input.contactId).eq("ativo", true).maybeSingle();
  if (existente) {
    const atual = String(asRec(existente).superlogica_pessoa_id);
    if (atual === input.pessoaId) return String(asRec(existente).id);
    throw new LocacaoErro("vinculo_diferente", "vinculo");
  }
  const { data, error } = await tabelaLocacao(admin, "contato_superlogica_vinculos").insert({
    organization_id: input.orgId,
    contact_id: input.contactId,
    superlogica_pessoa_id: input.pessoaId,
    tipos: (input.tipos ?? []).filter((t) => ["locatario", "fiador", "proprietario"].includes(t)),
    origem: input.origem ?? "manual",
    vinculado_por: input.userId,
  }).select("id").single();
  if (error || !data) throw new LocacaoErro("vinculo_gravacao", "vinculo");
  return String(asRec(data).id);
}

export async function desligarVinculo(
  admin: SupabaseClient,
  input: { orgId: string; vinculoId: string; userId: string; motivo: "errado" | "numero_mudou" | "lgpd" | "outro" },
): Promise<void> {
  const { error } = await tabelaLocacao(admin, "contato_superlogica_vinculos").update({
    ativo: false,
    desfeito_por: input.userId,
    desfeito_em: new Date().toISOString(),
    motivo_desfeito: input.motivo,
  }).eq("organization_id", input.orgId).eq("id", input.vinculoId).eq("ativo", true);
  if (error) throw new LocacaoErro("vinculo_desligar", "vinculo");
}

export async function vinculoDoContato(
  admin: SupabaseClient,
  orgId: string,
  contactId: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await tabelaLocacao(admin, "contato_superlogica_vinculos")
    .select("id,superlogica_pessoa_id,tipos,origem,qualidade,ativo")
    .eq("organization_id", orgId).eq("contact_id", contactId).eq("ativo", true).maybeSingle();
  return data ? asRec(data) : null;
}
