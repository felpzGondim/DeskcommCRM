import { createHash, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { gateLocacao, podeAprovarProcesso } from "@/lib/locacao/api-gate";
import { arquivosLigados } from "@/lib/locacao/chaves";
import { tabelaLocacao } from "@/lib/locacao/admin";
import { lerProcesso } from "@/lib/locacao/repositorio";
import { CATEGORIAS_DE_DOCUMENTO, ORIGENS_DO_DOCUMENTO } from "@/lib/locacao/vocabulario";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const MIME = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;
const corpo = z.object({
  categoria: z.enum(CATEGORIAS_DE_DOCUMENTO),
  origem: z.enum(ORIGENS_DO_DOCUMENTO).default("upload_manual"),
  participante_id: z.string().uuid().nullable().optional(),
  mime: z.enum(MIME),
  bytes_b64: z.string().min(1).max(28_000_000),
  ext: z.enum(["pdf", "jpg", "jpeg", "png", "webp", "heic", "heif"]),
}).strict();

export async function GET(_req: NextRequest, ctx: Ctx) {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const g = await gateLocacao(requestId);
  if (!g.ok) return g.response;
  const processo = await lerProcesso(g.gate.admin, g.gate.orgId, id);
  if (!processo) return fail("not_found", g.gate.t("Processo não encontrado."), 404, { requestId });
  const { data } = await tabelaLocacao(g.gate.admin, "locacao_processo_documentos")
    .select("id,categoria,origem,mime,tamanho_bytes,sha256,drive_status,vps_status,participante_id,created_at,removido_em")
    .eq("organization_id", g.gate.orgId).eq("processo_id", id)
    .is("removido_em", null)
    .order("created_at", { ascending: false });
  return ok({ habilitado: arquivosLigados(g.gate.settings), documentos: data ?? [] }, { requestId });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const requestId = randomUUID();
  const suporte = await requireSupportWrite();
  if (suporte) return suporte;
  const { id } = await ctx.params;
  const g = await gateLocacao(requestId, { exigirArquivos: true });
  if (!g.ok) return g.response;
  const parsed = corpo.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", g.gate.t("Pedido inválido."), 422, { requestId });
  const processo = await lerProcesso(g.gate.admin, g.gate.orgId, id);
  if (!processo) return fail("not_found", g.gate.t("Processo não encontrado."), 404, { requestId });
  let buf: Buffer;
  try {
    buf = Buffer.from(parsed.data.bytes_b64, "base64");
  } catch {
    return fail("validation_failed", g.gate.t("Arquivo inválido."), 422, { requestId });
  }
  if (buf.length === 0 || buf.length > 20 * 1024 * 1024) {
    return fail("validation_failed", g.gate.t("Arquivo maior que 20 MB."), 422, { requestId });
  }
  const docId = randomUUID();
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const md5 = createHash("md5").update(buf).digest("hex");
  const path = `${g.gate.orgId}/processos/${id}/${parsed.data.categoria}/${docId}.${parsed.data.ext}`;
  const { error: upErr } = await g.gate.admin.storage.from("locacao-processos").upload(path, buf, {
    contentType: parsed.data.mime, upsert: false,
  });
  if (upErr) return fail("internal_error", g.gate.t("Não foi possível guardar o arquivo."), 500, { requestId });
  const { error } = await tabelaLocacao(g.gate.admin, "locacao_processo_documentos").insert({
    id: docId, organization_id: g.gate.orgId, processo_id: id,
    participante_id: parsed.data.participante_id ?? null,
    categoria: parsed.data.categoria, origem: parsed.data.origem,
    storage_path: path, mime: parsed.data.mime, tamanho_bytes: buf.length,
    sha256, md5, created_by: g.gate.user.id,
  });
  if (error) return fail("internal_error", g.gate.t("Não foi possível registrar o documento."), 500, { requestId });
  void audit({
    action: "locacao.documento_anexado",
    organizationId: g.gate.orgId, actorUserId: g.gate.user.id, requestId,
    metadata: { processo_id: id, documento_id: docId, categoria: parsed.data.categoria },
  });
  return ok({ id: docId, sha256 }, { requestId });
}

const remover = z.object({
  documento_id: z.string().uuid(),
  motivo: z.string().trim().min(1).max(180),
}).strict();

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const requestId = randomUUID();
  const suporte = await requireSupportWrite();
  if (suporte) return suporte;
  const { id } = await ctx.params;
  const g = await gateLocacao(requestId, { exigirArquivos: true });
  if (!g.ok) return g.response;
  if (!podeAprovarProcesso(g.gate)) {
    return fail("forbidden_role", g.gate.t("Só quem aprova remove documento."), 403, { requestId });
  }
  const parsed = remover.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", g.gate.t("Pedido inválido."), 422, { requestId });
  await tabelaLocacao(g.gate.admin, "locacao_processo_documentos").update({
    removido_em: new Date().toISOString(),
    removido_por: g.gate.user.id,
    motivo_remocao: parsed.data.motivo,
  }).eq("organization_id", g.gate.orgId).eq("processo_id", id).eq("id", parsed.data.documento_id);
  void audit({
    action: "locacao.documento_removido",
    organizationId: g.gate.orgId, actorUserId: g.gate.user.id, requestId,
    metadata: { processo_id: id, documento_id: parsed.data.documento_id },
  });
  return ok({ ok: true }, { requestId });
}
