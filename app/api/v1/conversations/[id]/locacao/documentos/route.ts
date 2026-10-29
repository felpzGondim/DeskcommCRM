import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
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
import { CATEGORIAS_DE_DOCUMENTO } from "@/lib/locacao/vocabulario";
import type { Json } from "@/lib/database.types";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
const objeto = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};

async function contexto(id: string, requestId: string) {
  const auth = await requireRole("agent", {requestId, resource: "locacao"});
  if (!auth.ok) return {erro: auth.response};
  const db = await createClient();
  const {data: conv, error} = await db.from("conversations").select("id")
    .eq("organization_id", auth.org.orgId).eq("id", id).maybeSingle();
  if (error || !conv) return {erro: fail("not_found", "Conversa não encontrada.", 404, {requestId})};
  const admin = createAdminClient();
  const processo = await processoAtivoDaConversa(admin, auth.org.orgId, id);
  return {auth, db, admin, processo, orgId: auth.org.orgId};
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const requestId = randomUUID();
  const {id} = await ctx.params;
  const c = await contexto(id, requestId);
  if ("erro" in c) return c.erro;
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
      storagePath = typeof data?.storage_path === "string" ? data.storage_path : null;
    }
    if (!storagePath || !storagePath.startsWith(c.orgId + "/")) return fail("not_found", "Arquivo indisponível.", 404, {requestId});
    const {data, error} = await c.admin.storage.from(bucket).createSignedUrl(storagePath, 300, {download: url.searchParams.get("download") === "1"});
    if (error || !data?.signedUrl) return fail("internal_error", "Não foi possível abrir o arquivo.", 500, {requestId});
    return ok({url: data.signedUrl}, {requestId, headers: {"Cache-Control": "private, no-store"}});
  }
  const pagina = Math.max(0, Math.min(1000, Math.trunc(Number(url.searchParams.get("pagina")) || 0)));
  const {data: mensagens, error: erroMensagens} = await c.db.from("messages")
    .select("id,type,media_mime,media_storage_path,media_derived_status,metadata,sent_at")
    .eq("organization_id", c.orgId).eq("conversation_id", id).is("revoked_at", null)
    .in("type", ["document", "image"]).order("sent_at", {ascending: false}).order("id")
    .range(pagina * 100, pagina * 100 + 100);
  if (erroMensagens) return fail("internal_error", "Não foi possível listar os documentos.", 500, {requestId});
  const [docs, partes, ficha] = await Promise.all([
    processoId ? tabelaLocacao(c.admin, "locacao_processo_documentos")
      .select("id,categoria,origem,mime,tamanho_bytes,participante_id,mensagem_id,created_at")
      .eq("organization_id", c.orgId).eq("processo_id", processoId).is("removido_em", null)
      .order("created_at", {ascending: false}) : Promise.resolve({data: [], error: null}),
    processoId ? tabelaLocacao(c.admin, "locacao_processo_participantes")
      .select("id,papel,nome_exibicao,cpf_mascarado").eq("organization_id", c.orgId).eq("processo_id", processoId)
      .is("removido_em", null) : Promise.resolve({data: [], error: null}),
    lerFichaAtual(c.admin, c.orgId, id),
  ]);
  if (docs.error || partes.error) return fail("internal_error", "Não foi possível listar o processo.", 500, {requestId});
  const recebidos = (mensagens ?? []).slice(0, 100).map((m) => {
    const meta = objeto(m.metadata);
    const porProcesso = objeto(objeto(meta.locacao_documentos)[processoId ?? "conversa"]);
    return {id: m.id, origem: "mensagem", nome: typeof meta.media_filename === "string" ? meta.media_filename : m.type === "image" ? "Imagem recebida" : "Documento recebido",
      categoria: typeof porProcesso.categoria === "string" ? porProcesso.categoria : "outro",
      participante_id: typeof porProcesso.participante_id === "string" ? porProcesso.participante_id : null,
      mime: m.media_mime, data: m.sent_at,
      situacao: !m.media_storage_path ? "Aguardando armazenamento" : m.media_derived_status === "ready" ? "Texto disponível" : "Leitura a conferir"};
  });
  const documentos = (docs.data ?? []).map((d) => ({
    ...d, origem: "processo", nome: String(d.categoria).replaceAll("_", " "), data: d.created_at,
    situacao: "Arquivo disponível",
  }));
  return ok({
    processo_id: processoId, recebidos, documentos, participantes: partes.data ?? [],
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
  if ("erro" in c) return c.erro;
  const p = edicao.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail("validation_failed", "Classificação inválida.", 422, {requestId});
  const processoId = c.processo ? String(c.processo.id) : null;
  if (p.data.participante_id) {
    if (!processoId) return fail("validation_failed", "Salve o cadastro antes de vincular o participante.", 422, {requestId});
    const {data} = await tabelaLocacao(c.admin, "locacao_processo_participantes").select("id")
      .eq("organization_id", c.orgId).eq("processo_id", processoId).eq("id", p.data.participante_id).is("removido_em", null).maybeSingle();
    if (!data) return fail("not_found", "Participante não encontrado.", 404, {requestId});
  }
  const patch = {categoria: p.data.categoria, participante_id: p.data.participante_id};
  if (p.data.origem === "mensagem") {
    const {data: mensagem, error} = await c.db.from("messages").select("id,metadata")
      .eq("organization_id", c.orgId).eq("conversation_id", id).eq("id", p.data.id).is("revoked_at", null).maybeSingle();
    if (error || !mensagem) return fail("not_found", "Documento não encontrado.", 404, {requestId});
    const meta = objeto(mensagem.metadata);
    const novo = {...meta, locacao_documentos: {...objeto(meta.locacao_documentos), [processoId ?? "conversa"]: patch}};
    let update = c.admin.from("messages").update({metadata: novo as Json})
      .eq("organization_id", c.orgId).eq("conversation_id", id).eq("id", p.data.id);
    update = mensagem.metadata == null ? update.is("metadata", null) : update.filter("metadata", "eq", JSON.stringify(mensagem.metadata));
    const {data: salvo, error: erro} = await update.select("id").maybeSingle();
    if (erro || !salvo) return fail("internal_error", "Não foi possível classificar o documento.", 500, {requestId});
  } else {
    if (!processoId) return fail("not_found", "Processo não encontrado.", 404, {requestId});
    const {data: salvo, error} = await tabelaLocacao(c.admin, "locacao_processo_documentos").update(patch)
      .eq("organization_id", c.orgId).eq("processo_id", processoId).eq("id", p.data.id).is("removido_em", null).select("id").maybeSingle();
    if (error || !salvo) return fail("not_found", "Documento não encontrado.", 404, {requestId});
  }
  void audit({action: "locacao.documento_classificado", organizationId: c.orgId, actorUserId: c.auth.user.id,
    resourceType: "conversation", resourceId: id, requestId, metadata: {documento_id: p.data.id, processo_id: processoId, categoria: p.data.categoria}});
  return ok({salvo: true}, {requestId});
}
