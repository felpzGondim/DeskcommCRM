import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { requestTurnDeps } from "@/lib/agent-engine/agent/request-deps";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { limitesDaAnalise } from "@/lib/agent-engine/agent/painel-anexos-limites";
import { enriquecerAnexosDaAnalise, frasesDosAvisos } from "@/lib/agent-engine/agent/painel-leitura-anexos";
import {
  blocoDasFontesDaFicha,
  fontesDaFicha,
  gerarRelatorioPreliminarNoPainel,
} from "@/lib/agent-engine/agent/painel-relatorio-preliminar";
import { lerDocumentoPorVisao } from "@/lib/ai/visao/ler-documento";
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

async function autenticar(requestId: string, id: string, escrita = false) {
  if (escrita) {
    const denied = await requireSupportWrite();
    if (denied) return { erro: denied };
  }
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
  const gate = await autenticar(requestId, id, false);
  if ("erro" in gate && gate.erro) return gate.erro;
  const { auth, orgId } = gate;
  const t = (s: string) => traduzir(s, auth!.user.idioma);
  const versaoQ = Number(new URL(req.url).searchParams.get("versao") ?? "");
  const admin = createAdminClient();
  try {
    const [atual, historico] = await Promise.all([
      Number.isInteger(versaoQ) && versaoQ > 0
        ? lerVersaoDaFicha(admin, orgId!, id, versaoQ)
        : lerFichaAtual(admin, orgId!, id),
      listarHistoricoDaFicha(admin, orgId!, id),
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
    }, { requestId });
  } catch {
    return fail("internal_error", t("Não foi possível ler a ficha preliminar."), 500, { requestId });
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const gate = await autenticar(requestId, id, true);
  if ("erro" in gate && gate.erro) return gate.erro;
  const { auth, orgId, db, contato } = gate;
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

  const { data: orgLinha } = await db!.from("organizations").select("settings")
    .eq("id", orgId!).maybeSingle();
  const limites = limitesDaAnalise(orgLinha?.settings);
  const senhasPdf = Object.fromEntries((pedido.senhasPdf ?? []).map((s) => [s.nome, s.senha]));
  try {
    const { data: linhas, error: erroFontes } = await db!.from("messages")
      .select("id,direction,type,body,media_derived_text,media_derived_status,media_mime,media_storage_path,media_size_bytes,metadata,revoked_at")
      .eq("organization_id", orgId!).eq("conversation_id", id)
      .order("sent_at", { ascending: false }).limit(limites.mensagens_brutas);
    if (erroFontes) {
      registrar(false);
      return fail("internal_error", t("Não foi possível ler a conversa para o relatório preliminar."), 500, { requestId });
    }
    const janela = (linhas ?? []).slice(0, 200) as Record<string, unknown>[];
    const deps = requestTurnDeps();
    const enriquecido = await enriquecerAnexosDaAnalise(janela, orgId!, id, {
      limites, senhas: senhasPdf,
      lerDocumento: (e) => lerDocumentoPorVisao({ ...e, llmCfg: deps.llmCfg }),
    });
    const fontes = fontesDaFicha(enriquecido.linhas);
    const bloco = blocoDasFontesDaFicha(fontes);
    if (bloco.length > limites.chars_conjunto) {
      registrar(false);
      return fail("validation_error", t("Há documentos demais para conferir de uma vez. Revise os anexos desta conversa."), 422, { requestId });
    }
    const { saida } = await gerarRelatorioPreliminarNoPainel(getRequestPool(), deps.llmCfg, {
      tenantId: orgId!, contactId: contato!.id, fontes: bloco,
    }, { registry: deps.registry, log: deps.log });
    const avisos = frasesDosAvisos(enriquecido.avisos, limites.tentativas_senha);
    const ficha = {
      ...saida.ficha,
      pendencias: [...new Set([...saida.ficha.pendencias, ...avisos])].slice(0, 20),
    };
    const atual = await lerFichaAtual(admin, orgId!, id);
    const linha = await gravarVersaoDaFicha(admin, {
      organizationId: orgId!,
      conversationId: id,
      ficha,
      relatorio: saida.relatorio,
      origem: "preliminar_ia",
      baseVersao: atual?.versao ?? 0,
      alteradoPor: auth!.user.id,
    });
    registrar(true, { versao: linha.versao, campos: ["*"] });
    const historico = await listarHistoricoDaFicha(admin, orgId!, id);
    return ok({
      versao: linha.versao,
      origem: linha.origem,
      ficha: linha.ficha,
      relatorio: linha.relatorio,
      campos_alterados: linha.campos_alterados,
      avisos: enriquecido.avisos,
      historico,
    }, { requestId });
  } catch (err) {
    if (err instanceof FichaConflitoDeVersao) {
      return fail("idempotency_conflict", t("Outra pessoa alterou a ficha. Recarregue e gere de novo."), 409, { requestId });
    }
    registrar(false);
    return fail("hub_contract_error", t("Não foi possível gerar o relatório preliminar. Confira os documentos e tente novamente."), 422, { requestId });
  }
}
