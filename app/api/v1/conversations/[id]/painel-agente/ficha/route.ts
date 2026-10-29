import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { fichaPreliminarSchema } from "@/lib/locacao/ficha-schema";
import {
  FichaConflitoDeVersao,
  gravarVersaoDaFicha,
  lerFichaAtual,
  lerVersaoDaFicha,
  listarHistoricoDaFicha,
} from "@/lib/locacao/ficha-repositorio";
import { textoDaFalhaDoRelatorio } from "@/lib/painel/relatorio-preliminar-motivo";
import { enfileirarRelatorioPreliminar, lerGeracaoDaFicha } from "@/lib/painel/relatorio-preliminar-fila";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const corpo = z.discriminatedUnion("etapa", [
  z.object({
    etapa: z.literal("gerar"),
    senhasPdf: z.array(z.object({
      nome: z.string().trim().min(1).max(120),
      senha: z.string().min(1).max(200),
    })).max(12).optional(),
  }).strict(),
  z.object({
    etapa: z.literal("salvar"),
    ficha: fichaPreliminarSchema,
    relatorio: z.string().trim().min(1).max(4000),
    base_versao: z.number().int().nonnegative(),
  }).strict(),
]);

async function autenticar(requestId: string, id: string) {
  const auth = await requireRole("agent", { requestId, resource: "conversations" });
  if (!auth.ok) return { erro: auth.response };
  const orgId = auth.org.orgId;
  const db = await createClient();
  const { data: conversa } = await db.from("conversations").select("id,contact_id")
    .eq("organization_id", orgId).eq("id", id).maybeSingle();
  if (!conversa) {
    return { erro: fail("not_found", traduzir("Conversa não encontrada.", auth.user.idioma), 404, { requestId }) };
  }
  const { data: contato } = await db.from("contacts").select("id,is_anonymized")
    .eq("organization_id", orgId).eq("id", conversa.contact_id).maybeSingle();
  if (!contato || contato.is_anonymized) {
    return { erro: fail("reply_context_unavailable", traduzir("O contato desta conversa não está disponível.", auth.user.idioma), 422, { requestId }) };
  }
  return { auth, orgId, db, contato };
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const gate = await autenticar(requestId, id);
  if ("erro" in gate && gate.erro) return gate.erro;
  const { auth, orgId } = gate;
  const t = (s: string) => traduzir(s, auth!.user.idioma);
  const versaoQ = Number(new URL(req.url).searchParams.get("versao") ?? "");
  const admin = createAdminClient();
  try {
    const [atual, historico, geracao] = await Promise.all([
      Number.isInteger(versaoQ) && versaoQ > 0
        ? lerVersaoDaFicha(admin, orgId!, id, versaoQ)
        : lerFichaAtual(admin, orgId!, id),
      listarHistoricoDaFicha(admin, orgId!, id),
      lerGeracaoDaFicha(admin, orgId!, id),
    ]);
    return ok({
      atual: atual ? {
        versao: atual.versao,
        origem: atual.origem,
        ficha: atual.ficha,
        relatorio: atual.relatorio,
        campos_alterados: atual.campos_alterados,
        alterado_em: atual.alterado_em,
      } : null,
      historico,
      geracao: geracao
        ? {
            status: geracao.status,
            motivo: geracao.motivo,
            mensagem: geracao.motivo ? t(textoDaFalhaDoRelatorio(geracao.motivo)) : null,
            evento_id: geracao.eventoId,
          }
        : null,
    }, { requestId });
  } catch {
    return fail("internal_error", t("Não foi possível ler a ficha preliminar."), 500, { requestId });
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const requestId = randomUUID();
  const denied = await requireSupportWrite();
  if (denied) return denied;
  const { id } = await ctx.params;
  const gate = await autenticar(requestId, id);
  if ("erro" in gate && gate.erro) return gate.erro;
  const { auth, orgId, contato } = gate;
  const t = (s: string) => traduzir(s, auth!.user.idioma);
  const parsed = corpo.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_error", t("Pedido inválido."), 400, { requestId });
  const pedido = parsed.data;

  const [pessoa, org] = await Promise.all([
    checkRateLimit(`painel-agente:${auth!.user.id}`, 10, 60),
    checkRateLimit(`painel-agente-org:${orgId}`, 40, 60),
  ]);
  if (!pessoa.allowed || !org.allowed) {
    return fail("rate_limited", t("Muitos pedidos seguidos. Tente em um minuto."), 429, {
      requestId, headers: { "Retry-After": "60" },
    });
  }

  const registrar = (sucesso: boolean, extra: Record<string, unknown> = {}) => void audit({
    action: pedido.etapa === "gerar" ? "ai.painel_atendente.ficha_preliminar" : "ai.painel_atendente.ficha_salva",
    actorUserId: auth!.user.id, organizationId: orgId!, resourceType: "conversation",
    resourceId: id, requestId, metadata: { sucesso, ...extra },
  });

  const admin = createAdminClient();
  if (pedido.etapa === "salvar") {
    try {
      const linha = await gravarVersaoDaFicha(admin, {
        organizationId: orgId!,
        conversationId: id,
        ficha: pedido.ficha,
        relatorio: pedido.relatorio,
        origem: "atendente",
        baseVersao: pedido.base_versao,
        alteradoPor: auth!.user.id,
      });
      registrar(true, { versao: linha.versao, campos: linha.campos_alterados });
      const historico = await listarHistoricoDaFicha(admin, orgId!, id);
      return ok({
        versao: linha.versao,
        origem: linha.origem,
        ficha: linha.ficha,
        relatorio: linha.relatorio,
        campos_alterados: linha.campos_alterados,
        historico,
      }, { requestId });
    } catch (err) {
      if (err instanceof FichaConflitoDeVersao) {
        return fail("idempotency_conflict", t("Outra pessoa alterou a ficha. Recarregue e salve de novo."), 409, { requestId });
      }
      registrar(false);
      return fail("internal_error", t("Não foi possível salvar a ficha preliminar."), 500, { requestId });
    }
  }

  const senhas = Object.fromEntries((pedido.senhasPdf ?? []).map((s) => [s.nome, s.senha]));
  try {
    const fila = await enfileirarRelatorioPreliminar(admin, {
      orgId: orgId!,
      conversationId: id,
      contactId: contato!.id,
      userId: auth!.user.id,
      requestId,
      senhas,
    });
    registrar(true, { enfileirado: true, existente: fila.existente, evento_id: fila.eventoId });
    return ok(
      { status: "gerando", evento_id: fila.eventoId, existente: fila.existente },
      { status: 202, requestId },
    );
  } catch {
    registrar(false, { enfileirado: false });
    return fail("internal_error", t("Não foi possível gerar o relatório preliminar."), 500, { requestId });
  }
}
