/**
 * Simulação e rodada valendo do casamento Superlógica (Fase 3.5).
 * Só conta; não manda mensagem; não escreve na Superlógica.
 * Padrão sujeito à revisão do Felipe: pergunta 1 = (a) só únicos exatos ligam.
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { tabelaLocacao } from "@/lib/locacao/admin";
import { lerSuperlogicaVinculoSettings } from "@/lib/locacao/chaves";
import { classificarCasamento, type CandidatoDaSuperlogica } from "@/lib/superlogica/classificacao";
import type { FonteDeVinculo } from "@/lib/superlogica/fonte";
import { chaveTelefone, qualidadeDoCasamento } from "@/lib/superlogica/telefone";

function hashChave(chave: string): string {
  return createHash("sha256").update(chave).digest("hex");
}

export interface ResumoDaExecucao {
  contatos_lidos: number;
  fora: number;
  sem_casamento: number;
  unico_exato: number;
  unico_parcial: number;
  varias_pessoas_um_numero: number;
  ja_vinculado_igual: number;
  ja_vinculado_diferente: number;
  numero_mudou: number;
  ligaria_sozinho: number;
  iria_revisao: number;
}

const ZERO: ResumoDaExecucao = {
  contatos_lidos: 0, fora: 0, sem_casamento: 0, unico_exato: 0, unico_parcial: 0,
  varias_pessoas_um_numero: 0, ja_vinculado_igual: 0, ja_vinculado_diferente: 0,
  numero_mudou: 0, ligaria_sozinho: 0, iria_revisao: 0,
};

export async function rodarVinculo(
  admin: SupabaseClient,
  input: {
    orgId: string;
    userId: string;
    modo: "simulacao" | "valendo";
    settings: unknown;
    fonte: FonteDeVinculo;
  },
): Promise<{ execucaoId: string; resumo: ResumoDaExecucao }> {
  const cfg = lerSuperlogicaVinculoSettings(input.settings);
  const { data: rodando } = await tabelaLocacao(admin, "superlogica_vinculo_execucoes")
    .select("id").eq("organization_id", input.orgId).eq("estado", "rodando").maybeSingle();
  if (rodando) throw new Error("execucao_em_andamento");

  const { data: exec, error } = await tabelaLocacao(admin, "superlogica_vinculo_execucoes").insert({
    organization_id: input.orgId, modo: input.modo, estado: "rodando", iniciado_por: input.userId,
  }).select("id").single();
  if (error || !exec) throw new Error("execucao_gravacao");
  const execucaoId = String((exec as { id: string }).id);
  const resumo = { ...ZERO };

  try {
    const { data: contatos } = await admin.from("contacts")
      .select("id,phone_number,is_anonymized,is_merged_into,kind")
      .eq("organization_id", input.orgId)
      .limit(5000);
    const lote: Array<{ contact_id: string; chave: string; vinculo: string | null }> = [];
    for (const c of contatos ?? []) {
      resumo.contatos_lidos += 1;
      const row = c as {
        id: string; phone_number: string | null;
        is_anonymized: boolean | null; is_merged_into: string | null; kind: string | null;
      };
      if (row.is_anonymized || row.is_merged_into || row.kind === "whatsapp_group") {
        resumo.fora += 1;
        continue;
      }
      const chave = chaveTelefone(row.phone_number || "");
      if (!chave) {
        resumo.fora += 1;
        continue;
      }
      const { data: vinculo } = await tabelaLocacao(admin, "contato_superlogica_vinculos")
        .select("superlogica_pessoa_id").eq("organization_id", input.orgId)
        .eq("contact_id", row.id).eq("ativo", true).maybeSingle();
      lote.push({
        contact_id: row.id, chave: chave.chave,
        vinculo: vinculo ? String((vinculo as { superlogica_pessoa_id: string }).superlogica_pessoa_id) : null,
      });
    }

    for (let i = 0; i < lote.length; i += 200) {
      const fatia = lote.slice(i, i + 200);
      const respostas = await input.fonte.casar(fatia.map((f) => ({ contact_id: f.contact_id, chave: f.chave })));
      const porId = new Map(respostas.map((r) => [r.contact_id, r.pessoas]));
      for (const item of fatia) {
        const pessoasBrutas = porId.get(item.contact_id) ?? [];
        const crm = chaveTelefone(item.chave);
        const pessoas: CandidatoDaSuperlogica[] = pessoasBrutas.flatMap((p) => {
          const q = crm ? qualidadeDoCasamento(crm, {
            chave: item.chave, ddd: item.chave.slice(0, 2), oito: item.chave.slice(2),
            nove: null, dddPresumido: false,
          }) : "exato";
          return [{
            superlogica_pessoa_id: p.superlogica_pessoa_id,
            tipo: p.tipo, ativo: p.ativo, qualidade: q ?? "exato",
          }];
        });
        const cls = classificarCasamento(
          { contact_id: item.contact_id, chave: item.chave, vinculoAtivoPessoaId: item.vinculo },
          pessoas,
          { ligarUnicoExato: cfg.ligar_unico_exato },
        );
        const cat = cls.categoria;
        if (cat in resumo) {
          const contagem = resumo as Record<string, number>;
          contagem[cat] = (contagem[cat] ?? 0) + 1;
        }
        if (cls.ligaSozinho) resumo.ligaria_sozinho += 1;
        const vaiRevisao = !cls.ligaSozinho
          && cat !== "ja_vinculado_igual"
          && cat !== "sem_casamento"
          && cat !== "fora";
        if (vaiRevisao) resumo.iria_revisao += 1;
        if (input.modo !== "valendo") continue;
        if (cls.ligaSozinho && pessoas[0]) {
          await tabelaLocacao(admin, "contato_superlogica_vinculos").insert({
            organization_id: input.orgId, contact_id: item.contact_id,
            superlogica_pessoa_id: pessoas[0].superlogica_pessoa_id,
            tipos: ["locatario", "fiador"].includes(pessoas[0].tipo) ? [pessoas[0].tipo] : [],
            origem: "casamento_telefone", qualidade: pessoas[0].qualidade,
            execucao_id: execucaoId, vinculado_por: input.userId,
          });
        } else if (vaiRevisao) {
          await tabelaLocacao(admin, "superlogica_vinculo_revisoes").insert({
            organization_id: input.orgId, execucao_id: execucaoId,
            contact_id: item.contact_id,
            candidatos: cls.candidatos,
            categoria: cat,
            chave_hash: hashChave(item.chave),
            estado: "pendente",
            expira_em: new Date(Date.now() + 30 * 86400000).toISOString(),
          });
        }
      }
    }

    await tabelaLocacao(admin, "superlogica_vinculo_execucoes").update({
      estado: "concluida", terminado_em: new Date().toISOString(), resumo,
    }).eq("organization_id", input.orgId).eq("id", execucaoId);
    return { execucaoId, resumo };
  } catch (err) {
    await tabelaLocacao(admin, "superlogica_vinculo_execucoes").update({
      estado: "erro", terminado_em: new Date().toISOString(),
      erro_codigo: err instanceof Error ? err.message.slice(0, 80) : "erro",
    }).eq("organization_id", input.orgId).eq("id", execucaoId);
    throw err;
  }
}
