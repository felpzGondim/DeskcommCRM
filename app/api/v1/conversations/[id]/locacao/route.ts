import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { analiseLigada, processosLigados } from "@/lib/locacao/chaves";
import { completarFicha } from "@/lib/locacao/ficha-schema";
import { sanitizarResultadoFc } from "@/lib/locacao/analise/fc";
import { sanitizarCards } from "@/lib/locacao/analise/seguro";
import {
  lerAnaliseFcMaisRecenteDoProcesso,
  lerAnaliseSeguroMaisRecente,
  lerFichaAtualDoProcesso,
  listarParticipantes,
  listarProcessosDaConversa,
  vinculoDoContato,
} from "@/lib/locacao/repositorio";
import { vinculoDaLinha } from "@/lib/locacao/superlogica-id";
import { tabelaLocacao } from "@/lib/locacao/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const auth = await requireRole("agent", { requestId, resource: "locacao", allowPlatformAdmin: "leitura" });
  if (!auth.ok) return auth.response;
  const db = await createClient();
  const { data: conv } = await db.from("conversations").select("id,contact_id")
    .eq("organization_id", auth.org.orgId).eq("id", id).maybeSingle();
  if (!conv) return fail("not_found", "not_found", 404, { requestId });
  const { data: org } = await db.from("organizations").select("settings")
    .eq("id", auth.org.orgId).maybeSingle();
  const habilitado = processosLigados(org?.settings);
  const rendaLigada = analiseLigada(org?.settings, "renda");
  const seguroLigada = analiseLigada(org?.settings, "seguro");
  const fcLigada = analiseLigada(org?.settings, "fc");
  const manualLigada = analiseLigada(org?.settings, "manual");
  const relatorioLigada = analiseLigada(org?.settings, "relatorio");
  const analise = {
    renda: rendaLigada,
    seguro: seguroLigada,
    fc: fcLigada,
    manual: manualLigada,
    relatorio: relatorioLigada,
  };
  const contactId = typeof conv.contact_id === "string" ? conv.contact_id : null;
  const admin = createAdminClient();
  const { data: contatoLinha } = contactId
    ? await db.from("contacts").select("id")
      .eq("organization_id", auth.org.orgId).eq("id", contactId).maybeSingle()
    : { data: null };
  const vinculo = vinculoDaLinha(
    contactId ? await vinculoDoContato(admin, auth.org.orgId, contactId) : null,
  );
  const contato = {
    id: typeof (contatoLinha as { id?: unknown } | null)?.id === "string"
      ? (contatoLinha as { id: string }).id
      : contactId,
    superlogica_id_pessoa: vinculo.superlogica_id_pessoa,
    superlogica_tipo: vinculo.superlogica_tipo,
  };
  if (!habilitado) return ok({ habilitado: false, analise, processos: [], contato }, { requestId });
  const processos = await listarProcessosDaConversa(admin, auth.org.orgId, id);
  const imoveisIds = [...new Set(processos.map((p) => String(p.imovel_id ?? "")))].filter(Boolean);
  const rotulos = new Map<string, string>();
  if (imoveisIds.length > 0) {
    const { data } = await tabelaLocacao(admin, "locacao_imoveis")
      .select("id,logradouro,numero,complemento").eq("organization_id", auth.org.orgId).in("id", imoveisIds);
    for (const row of data ?? []) {
      const r = row as { id: string; logradouro: string; numero: string | null; complemento: string | null };
      rotulos.set(r.id, [r.logradouro, r.numero, r.complemento].filter(Boolean).join(", "));
    }
  }
  const fichas = await Promise.all(processos.slice(0, 5).map(async (p) => {
    const idProc = String(p.id ?? "");
    const linha = idProc ? await lerFichaAtualDoProcesso(admin, auth.org.orgId, idProc) : null;
    const ficha = linha?.ficha ? completarFicha(linha.ficha) : null;
    return {
      id: idProc,
      ficha_versao: linha?.versao ?? 0,
      renda_mensal: ficha?.renda.mensal.valor ?? null,
      renda_proposta_fc: ficha?.renda.proposta_fc.valor ?? null,
      alertas: ficha?.renda.alertas ?? [],
    };
  }));
  const rendaPorId = new Map(fichas.map((f) => [f.id, f]));
  const seguros = await Promise.all(processos.slice(0, 5).map(async (p) => {
    const idProc = String(p.id ?? "");
    const linha = idProc && (seguroLigada || manualLigada)
      ? await lerAnaliseSeguroMaisRecente(admin, auth.org.orgId, idProc)
      : null;
    const resultado = linha?.resultado && typeof linha.resultado === "object"
      ? (linha.resultado as Record<string, unknown>)
      : {};
    return {
      id: idProc,
      pedido_id: typeof linha?.pedido_id === "string" ? linha.pedido_id : null,
      estado: typeof linha?.estado === "string" ? linha.estado : null,
      cards: sanitizarCards(resultado.cards),
      ficha_versao: Number(linha?.ficha_versao ?? 0),
      documento_id: typeof linha?.documento_id === "string" ? linha.documento_id : null,
    };
  }));
  const seguroPorId = new Map(seguros.map((s) => [s.id, s]));
  const fcs = await Promise.all(processos.slice(0, 5).map(async (p) => {
    const idProc = String(p.id ?? "");
    const linha = idProc && (fcLigada || manualLigada)
      ? await lerAnaliseFcMaisRecenteDoProcesso(admin, auth.org.orgId, idProc)
      : null;
    const resultado = sanitizarResultadoFc(linha?.resultado);
    const participantes = idProc && (fcLigada || manualLigada)
      ? await listarParticipantes(admin, auth.org.orgId, idProc)
      : [];
    const fiadores = participantes
      .filter((x) => x.papel === "fiador" || x.papel === "solidario")
      .map((x) => ({
        id: x.id,
        papel: x.papel,
        cpf_mascarado: x.cpf_mascarado ?? null,
      }));
    return {
      id: idProc,
      pedido_id: typeof linha?.pedido_id === "string" ? linha.pedido_id : null,
      estado: typeof linha?.estado === "string" ? linha.estado : null,
      score: resultado.score,
      ficha_versao: Number(linha?.ficha_versao ?? 0),
      risco: resultado.risco,
      id_fc: resultado.id_fc,
      documento_id: typeof linha?.documento_id === "string" ? linha.documento_id : null,
      reaproveitada: linha?.estado === "reaproveitada" || !!linha?.reaproveitou_de,
      cobranca: resultado.cobranca,
      fiadores,
    };
  }));
  const fcPorId = new Map(fcs.map((f) => [f.id, f]));
  return ok({
    habilitado: true,
    analise,
    contato,
    processos: processos.map((p) => {
      const idProc = String(p.id ?? "");
      const extra = rendaPorId.get(idProc);
      const seguro = seguroPorId.get(idProc);
      const fc = fcPorId.get(idProc);
      return {
        id: p.id,
        status: p.status,
        ficha_versao: extra?.ficha_versao ?? 0,
        relatorio_desatualizado: !!p.relatorio_rascunho && !p.relatorio_rascunho_em,
        imovel: rotulos.get(String(p.imovel_id ?? "")) ?? "",
        encerrado_em: p.encerrado_em ?? null,
        renda_confirmada_em: p.renda_confirmada_em ?? null,
        renda_mensal: extra?.renda_mensal ?? null,
        renda_proposta_fc: extra?.renda_proposta_fc ?? null,
        alertas: extra?.alertas ?? [],
        seguro_desatualizado: !!seguro?.pedido_id && seguro.ficha_versao < (extra?.ficha_versao ?? 0),
        seguro_pedido_id: seguro?.pedido_id ?? null,
        seguro_estado: seguro?.estado ?? null,
        seguro_cards: seguro?.cards ?? [],
        seguro_documento_id: seguro?.documento_id ?? null,
        fc_desatualizado: !!fc?.pedido_id && fc.ficha_versao < (extra?.ficha_versao ?? 0),
        fc_pedido_id: fc?.pedido_id ?? null,
        fc_estado: fc?.estado ?? null,
        fc_score: fc?.score ?? null,
        fc_risco: fc?.risco ?? null,
        fc_id: fc?.id_fc ?? null,
        fc_documento_id: fc?.documento_id ?? null,
        fc_reaproveitada: fc?.reaproveitada === true,
        fc_cobranca: fc?.cobranca ?? null,
        fc_fiadores: fc?.fiadores ?? [],
        relatorio_rascunho: typeof p.relatorio_rascunho === "string" ? p.relatorio_rascunho : null,
        relatorio_rascunho_em: p.relatorio_rascunho_em ?? null,
        relatorio_aprovado_em: p.relatorio_aprovado_em ?? null,
        relatorio_documento_id: p.relatorio_documento_id ?? null,
      };
    }),
  }, { requestId });
}
