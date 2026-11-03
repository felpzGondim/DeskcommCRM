import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { tabelaLocacao } from "@/lib/locacao/admin";
import { processoAtivoDaConversa } from "@/lib/locacao/ficha-compartilhada";
import { lerFichaAtual } from "@/lib/locacao/ficha-repositorio";
import {
  TETO_CHAMADAS_POR_LISTA,
  classificarDocumentoComModelo,
} from "@/lib/locacao/classificar-documento-modelo";
import {
  aplicarEdicaoManual,
  categoriaPeloTextoDerivado,
  classificacaoParaMetadata,
  classificacaoPrecisaPersistir,
  classificarAnexoDaConversa,
  lerClassificacaoSalva,
  sinaisDaFicha,
  type ClassificacaoDeDocumento,
  type ClassificacaoSalva,
  type ParticipanteParaClassificar,
} from "@/lib/locacao/classificar-documento";
import { CATEGORIAS_DE_DOCUMENTO } from "@/lib/locacao/vocabulario";
import type { Json } from "@/lib/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
const objeto = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};

function chaveDaClassificacao(processoId: string | null): string {
  return processoId ?? "conversa";
}

function classificacaoDoMeta(
  meta: Record<string, unknown>,
  processoId: string | null,
): ClassificacaoSalva | null {
  const porProcesso = objeto(meta.locacao_documentos);
  return lerClassificacaoSalva(porProcesso[chaveDaClassificacao(processoId)] ?? porProcesso.conversa);
}

function participantesParaClassificar(linhas: unknown): {
  internos: ParticipanteParaClassificar[];
  publicos: Array<{id: string; papel: string; principal: boolean; nome_exibicao: string | null; cpf_mascarado: string | null}>;
} {
  const internos: ParticipanteParaClassificar[] = [];
  const publicos: Array<{id: string; papel: string; principal: boolean; nome_exibicao: string | null; cpf_mascarado: string | null}> = [];
  for (const bruto of Array.isArray(linhas) ? linhas : []) {
    const p = objeto(bruto);
    if (typeof p.id !== "string") continue;
    internos.push({
      id: p.id,
      papel: typeof p.papel === "string" ? p.papel : "contato",
      principal: p.principal === true,
      cpf_hash: typeof p.cpf_hash === "string" ? p.cpf_hash : null,
    });
    publicos.push({
      id: p.id,
      papel: typeof p.papel === "string" ? p.papel : "contato",
      principal: p.principal === true,
      nome_exibicao: typeof p.nome_exibicao === "string" ? p.nome_exibicao : null,
      cpf_mascarado: typeof p.cpf_mascarado === "string" ? p.cpf_mascarado : null,
    });
  }
  return { internos, publicos };
}

async function gravarClassificacaoDaMensagem(
  admin: SupabaseClient,
  input: {
    orgId: string;
    conversationId: string;
    mensagemId: string;
    processoId: string | null;
    metadataAtual: unknown;
    classificacao: ClassificacaoDeDocumento;
  },
): Promise<boolean> {
  const meta = objeto(input.metadataAtual);
  const novo = {
    ...meta,
    locacao_documentos: {
      ...objeto(meta.locacao_documentos),
      [chaveDaClassificacao(input.processoId)]: classificacaoParaMetadata(input.classificacao),
    },
  };
  let update = admin.from("messages").update({ metadata: novo as Json })
    .eq("organization_id", input.orgId)
    .eq("conversation_id", input.conversationId)
    .eq("id", input.mensagemId);
  update = input.metadataAtual == null
    ? update.is("metadata", null)
    : update.filter("metadata", "eq", JSON.stringify(input.metadataAtual));
  const { data } = await update.select("id").maybeSingle();
  return Boolean(data);
}

async function contexto(id: string, requestId: string) {
  const auth = await requireRole("agent", {requestId, resource: "locacao"});
  if (!auth.ok) return {ok: false as const, response: auth.response};
  const db = await createClient();
  const {data: conv, error} = await db.from("conversations").select("id")
    .eq("organization_id", auth.org.orgId).eq("id", id).maybeSingle();
  if (error || !conv) return {ok: false as const, response: fail("not_found", "Conversa não encontrada.", 404, {requestId})};
  const admin = createAdminClient();
  const processo = await processoAtivoDaConversa(admin, auth.org.orgId, id);
  return {ok: true as const, auth, db, admin, processo, orgId: auth.org.orgId};
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const requestId = randomUUID();
  const {id} = await ctx.params;
  const c = await contexto(id, requestId);
  if (!c.ok) return c.response;
  const url = new URL(req.url);
  const arquivo = url.searchParams.get("arquivo");
  const origem = url.searchParams.get("origem");
  const processoId = c.processo ? String(c.processo.id) : null;
  if (arquivo) {
    if (!z.string().uuid().safeParse(arquivo).success) return fail("validation_failed", "Arquivo inválido.", 422, {requestId});
    let bucket = "whatsapp-media";
    let storagePath: string | null = null;
    if (origem === "mensagem") {
      const {data, error} = await c.db.from("messages").select("media_storage_path")
        .eq("organization_id", c.orgId).eq("conversation_id", id).eq("id", arquivo).is("revoked_at", null).maybeSingle();
      if (error) return fail("internal_error", "Não foi possível consultar o arquivo.", 500, {requestId});
      storagePath = data?.media_storage_path ?? null;
    } else if (origem === "processo" && processoId) {
      bucket = "locacao-processos";
      const {data, error} = await tabelaLocacao(c.admin, "locacao_processo_documentos").select("storage_path")
        .eq("organization_id", c.orgId).eq("processo_id", processoId).eq("id", arquivo).is("removido_em", null).maybeSingle();
      if (error) return fail("internal_error", "Não foi possível consultar o arquivo.", 500, {requestId});
      const row = objeto(data);
      storagePath = typeof row.storage_path === "string" ? row.storage_path : null;
    }
    if (!storagePath || !storagePath.startsWith(c.orgId + "/")) return fail("not_found", "Arquivo indisponível.", 404, {requestId});
    const baixar = url.searchParams.get("download") === "1";
    const {data, error} = await c.admin.storage.from(bucket).createSignedUrl(storagePath, 300, {download: baixar});
    if (error || !data?.signedUrl) return fail("internal_error", "Não foi possível abrir o arquivo.", 500, {requestId});
    if (url.searchParams.get("redirect") === "1") {
      const response = NextResponse.redirect(data.signedUrl, 302);
      response.headers.set("X-Request-Id", requestId);
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
    return ok({url: data.signedUrl}, {requestId, headers: {"Cache-Control": "private, no-store"}});
  }
  const pagina = Math.max(0, Math.min(1000, Math.trunc(Number(url.searchParams.get("pagina")) || 0)));
  const {data: mensagens, error: erroMensagens} = await c.db.from("messages")
    .select("id,type,media_mime,media_storage_path,media_derived_status,media_derived_text,metadata,sent_at")
    .eq("organization_id", c.orgId).eq("conversation_id", id).is("revoked_at", null)
    .in("type", ["document", "image"]).order("sent_at", {ascending: false}).order("id")
    .range(pagina * 100, pagina * 100 + 100);
  if (erroMensagens) return fail("internal_error", "Não foi possível listar os documentos.", 500, {requestId});
  const [docs, partes, ficha, renda] = await Promise.all([
    processoId ? tabelaLocacao(c.admin, "locacao_processo_documentos")
      .select("id,categoria,origem,mime,tamanho_bytes,participante_id,mensagem_id,created_at")
      .eq("organization_id", c.orgId).eq("processo_id", processoId).is("removido_em", null)
      .order("created_at", {ascending: false}) : Promise.resolve({data: [], error: null}),
    processoId ? tabelaLocacao(c.admin, "locacao_processo_participantes")
      .select("id,papel,principal,nome_exibicao,cpf_mascarado,cpf_hash").eq("organization_id", c.orgId).eq("processo_id", processoId)
      .is("removido_em", null) : Promise.resolve({data: [], error: null}),
    lerFichaAtual(c.admin, c.orgId, id),
    processoId ? tabelaLocacao(c.admin, "locacao_execucoes")
      .select("participante_id")
      .eq("organization_id", c.orgId).eq("processo_id", processoId).eq("aba", "renda").eq("estado", "concluido")
      .order("terminado_em", {ascending: false}).limit(1) : Promise.resolve({data: [], error: null}),
  ]);
  if (docs.error || partes.error) return fail("internal_error", "Não foi possível listar o processo.", 500, {requestId});
  const {internos, publicos} = participantesParaClassificar(partes.data);
  const rendaLinha = Array.isArray(renda.data) ? objeto(renda.data[0]) : objeto(renda.data);
  const participanteDaRenda = typeof rendaLinha.participante_id === "string" ? rendaLinha.participante_id : null;
  const sinais = sinaisDaFicha(ficha?.ficha, internos, participanteDaRenda);
  const trabalho = (mensagens ?? []).slice(0, 100).map((m) => {
    const meta = objeto(m.metadata);
    const nome = typeof meta.media_filename === "string" ? meta.media_filename
      : m.type === "image" ? "Imagem recebida" : "Documento recebido";
    const texto = m.media_derived_status === "ready" && typeof m.media_derived_text === "string"
      ? m.media_derived_text : "";
    const salva = classificacaoDoMeta(meta, processoId);
    const classificacao = classificarAnexoDaConversa({
      messageId: m.id,
      salva,
      sinais,
      participantes: internos,
      categoriaDoTexto: categoriaPeloTextoDerivado(nome, texto),
    });
    return {
      mensagem: m, meta, nome, texto, salva, classificacao,
      situacao: !m.media_storage_path ? "Aguardando armazenamento"
        : m.media_derived_status === "ready" ? "Texto disponível" : "Leitura a conferir",
    };
  });
  const residual = trabalho.filter((item) =>
    item.classificacao.categoria_origem === "automatico"
    && item.classificacao.categoria === "outro"
    && !item.classificacao.tentou_modelo
    && item.texto.trim().length >= 8
  ).slice(0, TETO_CHAMADAS_POR_LISTA);
  if (residual.length) {
    try {
      const { requestTurnDeps } = await import("@/lib/agent-engine/agent/request-deps");
      const deps = requestTurnDeps();
      await Promise.all(residual.map(async (item) => {
        const categoria = await classificarDocumentoComModelo({
          organizationId: c.orgId,
          nomeArquivo: item.nome,
          textoDerivado: item.texto,
          llmCfg: deps.llmCfg,
          admin: c.admin,
        });
        item.classificacao = {
          ...classificarAnexoDaConversa({
            messageId: item.mensagem.id,
            salva: item.salva,
            sinais,
            participantes: internos,
            categoriaDoTexto: categoria ?? categoriaPeloTextoDerivado(item.nome, item.texto),
          }),
          tentou_modelo: true,
        };
      }));
    } catch {
      // Sem credencial ou sem pool: a lista segue com a regra pura; a próxima abertura tenta o modelo.
    }
  }
  const gravados: string[] = [];
  await Promise.all(trabalho.map(async (item) => {
    if (!classificacaoPrecisaPersistir(item.salva, item.classificacao)) return;
    try {
      const okGravar = await gravarClassificacaoDaMensagem(c.admin, {
        orgId: c.orgId, conversationId: id, mensagemId: item.mensagem.id,
        processoId, metadataAtual: item.mensagem.metadata, classificacao: item.classificacao,
      });
      if (okGravar) gravados.push(item.mensagem.id);
    } catch {
      // A lista ainda devolve o preenchido; a próxima abertura tenta de novo.
    }
  }));
  if (gravados.length) {
    void audit({
      action: "locacao.documento_classificado",
      organizationId: c.orgId,
      actorUserId: c.auth.user.id,
      resourceType: "conversation",
      resourceId: id,
      requestId,
      metadata: {
        origem: "automatico",
        processo_id: processoId,
        quantidade: gravados.length,
        documento_ids: gravados,
      },
    });
  }
  const recebidos = trabalho.map((item) => ({
    id: item.mensagem.id, origem: "mensagem", origem_arquivo: "anexo_conversa",
    nome: item.nome,
    categoria: item.classificacao.categoria,
    participante_id: item.classificacao.participante_id,
    categoria_automatica: item.classificacao.categoria_origem === "automatico" && item.classificacao.categoria !== "outro",
    participante_automatico: item.classificacao.participante_origem === "automatico" && item.classificacao.participante_id != null,
    mime: item.mensagem.media_mime, data: item.mensagem.sent_at, mensagem_id: item.mensagem.id,
    situacao: item.situacao,
  }));
  const documentos = (docs.data ?? []).map((documento) => {
    const d = objeto(documento);
    return {
      id: d.id, origem: "processo",
      origem_arquivo: typeof d.origem === "string" ? d.origem : null,
      nome: String(d.categoria).replaceAll("_", " "),
      categoria: typeof d.categoria === "string" ? d.categoria : "outro",
      participante_id: typeof d.participante_id === "string" ? d.participante_id : null,
      mime: typeof d.mime === "string" ? d.mime : null,
      data: d.created_at, mensagem_id: typeof d.mensagem_id === "string" ? d.mensagem_id : null,
      situacao: "Arquivo disponível",
    };
  });
  return ok({
    processo_id: processoId, recebidos, documentos, participantes: publicos,
    pendencias: ficha?.ficha.documentos.faltantes ?? [],
    relatorios: [
      ...(ficha?.relatorio ? [{id: "renda", nome: "Análise cadastral", texto: ficha.relatorio}] : []),
      ...(typeof c.processo?.relatorio_rascunho === "string" ? [{id: "consolidado", nome: "Relatório consolidado", texto: c.processo.relatorio_rascunho}] : []),
    ],
    ha_mais: (mensagens ?? []).length > 100, pagina,
  }, {requestId, headers: {"Cache-Control": "private, no-store"}});
}

const edicao = z.object({
  id: z.string().uuid(), origem: z.enum(["mensagem", "processo"]),
  categoria: z.enum(CATEGORIAS_DE_DOCUMENTO), participante_id: z.string().uuid().nullable(),
}).strict();

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const requestId = randomUUID();
  const suporte = await requireSupportWrite();
  if (suporte) return suporte;
  const {id} = await ctx.params;
  const c = await contexto(id, requestId);
  if (!c.ok) return c.response;
  const p = edicao.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail("validation_failed", "Classificação inválida.", 422, {requestId});
  const processoId = c.processo ? String(c.processo.id) : null;
  if (p.data.participante_id) {
    if (!processoId) return fail("validation_failed", "Salve o cadastro antes de vincular o participante.", 422, {requestId});
    const {data} = await tabelaLocacao(c.admin, "locacao_processo_participantes").select("id")
      .eq("organization_id", c.orgId).eq("processo_id", processoId).eq("id", p.data.participante_id).is("removido_em", null).maybeSingle();
    if (!data) return fail("not_found", "Participante não encontrado.", 404, {requestId});
  }
  if (p.data.origem === "mensagem") {
    const {data: mensagem, error} = await c.db.from("messages").select("id,metadata")
      .eq("organization_id", c.orgId).eq("conversation_id", id).eq("id", p.data.id).is("revoked_at", null).maybeSingle();
    if (error || !mensagem) return fail("not_found", "Documento não encontrado.", 404, {requestId});
    const meta = objeto(mensagem.metadata);
    const manual = aplicarEdicaoManual(classificacaoDoMeta(meta, processoId), {
      categoria: p.data.categoria, participante_id: p.data.participante_id,
    });
    const novo = {...meta, locacao_documentos: {...objeto(meta.locacao_documentos), [processoId ?? "conversa"]: classificacaoParaMetadata(manual)}};
    let update = c.admin.from("messages").update({metadata: novo as Json})
      .eq("organization_id", c.orgId).eq("conversation_id", id).eq("id", p.data.id);
    update = mensagem.metadata == null ? update.is("metadata", null) : update.filter("metadata", "eq", JSON.stringify(mensagem.metadata));
    const {data: salvo, error: erro} = await update.select("id").maybeSingle();
    if (erro || !salvo) return fail("internal_error", "Não foi possível classificar o documento.", 500, {requestId});
  } else {
    if (!processoId) return fail("not_found", "Processo não encontrado.", 404, {requestId});
    const {data: salvo, error} = await tabelaLocacao(c.admin, "locacao_processo_documentos")
      .update({categoria: p.data.categoria, participante_id: p.data.participante_id})
      .eq("organization_id", c.orgId).eq("processo_id", processoId).eq("id", p.data.id).is("removido_em", null).select("id").maybeSingle();
    if (error || !salvo) return fail("not_found", "Documento não encontrado.", 404, {requestId});
  }
  void audit({action: "locacao.documento_classificado", organizationId: c.orgId, actorUserId: c.auth.user.id,
    resourceType: "conversation", resourceId: id, requestId, metadata: {documento_id: p.data.id, processo_id: processoId, categoria: p.data.categoria}});
  return ok({salvo: true}, {requestId});
}
