import type { SupabaseClient } from "@supabase/supabase-js";
import { tabelaLocacao } from "@/lib/locacao/admin";
import { caminhosAlterados } from "@/lib/locacao/ficha-diff";
import { completarFicha, type FichaPreliminar } from "@/lib/locacao/ficha-schema";
import { camposCpfDoParticipante, hashCpfDoParticipante } from "@/lib/locacao/cpf";
import {
  adicionarParticipante, confirmarRendaDoProcesso, criarOuReusarImovel, criarProcesso,
  gravarFichaDoProcesso, lerFichaAtualDoProcesso, listarParticipantesParaFc, listarProcessosDaConversa, LocacaoErro,
} from "@/lib/locacao/repositorio";
import { ehStatusFinal, type StatusDoProcesso } from "@/lib/locacao/status";
import { aplicarEdicaoManual, extrairValoresDaConversa, lerValoresDaLinha, patchSqlDosValores } from "@/lib/locacao/valores-imovel";

export async function processoAtivoDaConversa(admin: SupabaseClient, orgId: string, conversaId: string) {
  const lista = await listarProcessosDaConversa(admin, orgId, conversaId);
  const ativos = lista.filter((p) => !p.encerrado_em && !ehStatusFinal(p.status as StatusDoProcesso));
  if (ativos.length > 1) throw new LocacaoErro("processo_ambiguo", "Selecione o processo da conversa.");
  return ativos[0] ?? null;
}

/** Reaproveita a ficha versionada existente; não mantém um cadastro independente. */
export async function sincronizarFichaCompartilhada(admin: SupabaseClient, input: {
  orgId: string; conversaId: string; userId: string; ficha: FichaPreliminar;
  origem: "atendente" | "preliminar_ia"; criar?: boolean;
}) {
  let processo = await processoAtivoDaConversa(admin, input.orgId, input.conversaId);
  if (!processo && !input.criar) return;
  if (!processo) {
    const { data: conversa, error } = await admin.from("conversations").select("id,contact_id")
      .eq("organization_id", input.orgId).eq("id", input.conversaId).maybeSingle();
    if (error || !conversa) throw new LocacaoErro("conversa_ausente", "conversa");
    const im = input.ficha.imovel;
    const imovelId = await criarOuReusarImovel(admin, input.orgId, {
      logradouro: im.logradouro.valor || "a definir",
      numero: im.numero.valor, complemento: im.complemento.valor, cep: im.cep.valor,
      bairro: im.bairro.valor || undefined, cidade: im.cidade.valor || undefined, uf: im.uf.valor || undefined, tipo: im.tipo,
    });
    const id = await criarProcesso(admin, {orgId: input.orgId, userId: input.userId,
      imovelId, conversationId: input.conversaId, contactId: conversa.contact_id, papelInicial: "contato"});
    processo = {id};
  }
  const id = String(processo.id);
  const atual = await lerFichaAtualDoProcesso(admin, input.orgId, id);
  const campos = atual ? caminhosAlterados(completarFicha(atual.ficha), input.ficha) : ["*"];
  const versao = campos.length ? await gravarFichaDoProcesso(admin, {
    orgId: input.orgId, processoId: id, userId: input.userId, ficha: input.ficha,
    origem: input.origem, baseVersao: atual?.versao ?? 0, camposAlterados: campos,
  }) : atual!.versao;
  if (input.origem !== "atendente") return;

  // Mantém a pessoa que só conversa separada dos candidatos identificados.
  const participantes = await listarParticipantesParaFc(admin, input.orgId, id);
  const pessoas = input.ficha.pessoas.filter((p) => p.papel !== "contato");
  const obsoletos = participantes.filter((p) => p.papel !== "contato" && !pessoas.some((n) =>
    hashCpfDoParticipante(n.cpf.valor ?? "") === p.cpf_hash && (n.papel === "inquilino" ? "locatario" : n.papel) === p.papel));
  if (obsoletos.length) {
    const {error} = await tabelaLocacao(admin, "locacao_processo_participantes")
      .update({removido_em: new Date().toISOString()}).eq("organization_id", input.orgId)
      .eq("processo_id", id).in("id", obsoletos.map((p) => String(p.id)));
    if (error) throw new LocacaoErro("participante_gravacao", "participante");
  }
  for (const pessoa of pessoas) {
    const hash = hashCpfDoParticipante(pessoa.cpf.valor ?? "");
    if (!hash) continue;
    const papel = pessoa.papel === "inquilino" ? "locatario" : pessoa.papel;
    const existente = participantes.find((p) => p.cpf_hash === hash && p.papel === papel);
    if (existente && existente.principal !== pessoa.principal) {
      const {error} = await tabelaLocacao(admin, "locacao_processo_participantes").update({principal: pessoa.principal})
        .eq("organization_id", input.orgId).eq("processo_id", id).eq("id", String(existente.id));
      if (error) throw new LocacaoErro("participante_gravacao", "participante");
    }
    if (!existente) {
      const cpf = await camposCpfDoParticipante(admin, pessoa.cpf.valor ?? "");
      if (!cpf.cpf_hash || !cpf.cpf_encrypted) throw new LocacaoErro("cpf_indisponivel", "Não foi possível proteger o CPF do participante.");
      await adicionarParticipante(admin, {
      orgId: input.orgId, processoId: id, userId: input.userId, papel,
      principal: pessoa.principal, cpfHash: cpf.cpf_hash, cpfMascarado: cpf.cpf_mascarado, cpfEncrypted: cpf.cpf_encrypted, nomeExibicao: pessoa.nome.valor,
    });
    }
  }
  const fonte = extrairValoresDaConversa({ficha: input.ficha});
  const patch = Object.fromEntries(Object.entries(fonte).filter(([, v]) => typeof v === "number"));
  const { data: linha, error: erroLinha } = await tabelaLocacao(admin, "locacao_processos").select("*")
    .eq("organization_id", input.orgId).eq("id", id).single();
  if (erroLinha || !linha) throw new LocacaoErro("processo_leitura", "processo");
  const valores = aplicarEdicaoManual(lerValoresDaLinha(linha as Record<string, unknown>), patch, input.userId);
  const { error: erroValores } = await tabelaLocacao(admin, "locacao_processos").update(patchSqlDosValores(valores.valores, valores.campos))
    .eq("organization_id", input.orgId).eq("id", id);
  if (erroValores) throw new LocacaoErro("valores_imovel_gravacao", "valores");
  if (input.ficha.renda.mensal.valor != null && input.ficha.renda.mensal.valor > 0) {
    await confirmarRendaDoProcesso(admin, {orgId: input.orgId, processoId: id, userId: input.userId, fichaVersao: versao});
  } else {
    const {error} = await tabelaLocacao(admin, "locacao_processos").update({
      renda_confirmada_em: null, renda_confirmada_por: null, renda_confirmada_ficha_versao: null,
    }).eq("organization_id", input.orgId).eq("id", id);
    if (error) throw new LocacaoErro("renda_confirmacao", "renda");
  }
}
