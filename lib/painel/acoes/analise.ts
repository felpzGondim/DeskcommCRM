/**
 * Análise de renda no Painel (PR 4.1). Mesmo caminho do botão e do /pergunta.
 * Reabre os PDFs originais (o texto derivado corta em 8 mil caracteres).
 * Não chama Hub, FC, Migra nem Superlógica. Nada vai ao cliente.
 */
import { iniciarAnaliseDeRenda } from "@/lib/locacao/analise/iniciar-renda";
import { analiseLigada } from "@/lib/locacao/chaves";
import {
  FichaConflitoDeVersao,
  gravarVersaoDaFicha,
  lerFichaAtual,
} from "@/lib/locacao/ficha-repositorio";
import { completarFicha, type FichaPreliminar } from "@/lib/locacao/ficha-schema";
import {
  confirmarRendaDoProcesso,
  gravarFichaDoProcesso,
  lerFichaAtualDoProcesso,
  lerProcesso,
  listarProcessosDaConversa,
  LocacaoErro,
} from "@/lib/locacao/repositorio";
import type { ContextoDaFerramenta, ResultadoDaFerramenta } from "@/lib/painel/ferramentas/tipos";

export const TEXTO_ANALISE_DESLIGADA = "Esta análise não está ligada nesta organização.";
export const TEXTO_SEM_PROCESSO = "Abra um processo de locação antes de analisar a renda.";
export const TEXTO_SEM_RENDA_PARA_CONFIRMAR = "Analise a renda antes de confirmar.";
export const TEXTO_RENDA_CONFIRMADA = "Renda confirmada.";

function recusaDesligada(): ResultadoDaFerramenta {
  return { ok: false, texto: TEXTO_ANALISE_DESLIGADA, codigo: "tool_unavailable" };
}

async function processoDaConversa(
  ctx: ContextoDaFerramenta,
  processoId?: string,
): Promise<{ id: string } | ResultadoDaFerramenta> {
  if (processoId) {
    const linha = await lerProcesso(ctx.admin, ctx.orgId, processoId);
    if (!linha) return { ok: false, texto: TEXTO_SEM_PROCESSO, codigo: "validation_error" };
    return { id: processoId };
  }
  const lista = await listarProcessosDaConversa(ctx.admin, ctx.orgId, ctx.conversationId);
  const primeiro = lista[0];
  const id = typeof primeiro?.id === "string" ? primeiro.id : "";
  if (!id) return { ok: false, texto: TEXTO_SEM_PROCESSO, codigo: "validation_error" };
  return { id };
}

function extraDaRenda(ficha: FichaPreliminar, versao: number, origem: string) {
  return {
    versao,
    origem,
    renda_comprovada: ficha.renda.mensal.valor,
    renda_proposta_fc: ficha.renda.proposta_fc.valor,
    alertas: ficha.renda.alertas,
    excluida: ficha.renda.excluida,
    pix_terceiros: ficha.renda.pix_terceiros,
    vendas_cartao: ficha.renda.vendas_cartao,
    evidencias: ficha.renda.evidencias,
    bloco_calculado: ficha.renda.bloco_calculado,
  };
}

/** Mesma função do botão e do chat: só enfileira. O worker processa. */
export async function analisarRendaDoPainel(
  ctx: ContextoDaFerramenta,
  args: { processo_id?: string; participante_id?: string; senhas?: Record<string, string> } = {},
): Promise<ResultadoDaFerramenta> {
  return iniciarAnaliseDeRenda(ctx, args);
}

export async function confirmarRendaDoPainel(
  ctx: ContextoDaFerramenta,
  args: { processo_id?: string; renda_proposta_fc?: number } = {},
): Promise<ResultadoDaFerramenta> {
  if (!analiseLigada(ctx.settings, "renda")) return recusaDesligada();
  const alvo = await processoDaConversa(ctx, args.processo_id);
  if ("ok" in alvo) return alvo;
  const atual = await lerFichaAtualDoProcesso(ctx.admin, ctx.orgId, alvo.id);
  if (!atual) {
    return { ok: false, texto: TEXTO_SEM_RENDA_PARA_CONFIRMAR, codigo: "validation_error" };
  }
  const ficha = completarFicha(atual.ficha);
  if (ficha.renda.mensal.valor === null && ficha.renda.proposta_fc.valor === null) {
    return { ok: false, texto: TEXTO_SEM_RENDA_PARA_CONFIRMAR, codigo: "validation_error" };
  }
  if (typeof args.renda_proposta_fc === "number") {
    ficha.renda.proposta_fc = {
      ...ficha.renda.proposta_fc,
      valor: args.renda_proposta_fc,
      fonte: ficha.renda.proposta_fc.fonte ?? "atendente",
      trecho: ficha.renda.proposta_fc.trecho,
      confianca: 1,
      message_id: ficha.renda.proposta_fc.message_id,
    };
  }
  try {
    const versao = await gravarFichaDoProcesso(ctx.admin, {
      orgId: ctx.orgId,
      processoId: alvo.id,
      userId: ctx.userId,
      ficha,
      origem: "atendente",
      baseVersao: atual.versao,
      camposAlterados: ["renda"],
    });
    await confirmarRendaDoProcesso(ctx.admin, {
      orgId: ctx.orgId,
      processoId: alvo.id,
      userId: ctx.userId,
      fichaVersao: versao,
    });
    try {
      const daConversa = await lerFichaAtual(ctx.admin, ctx.orgId, ctx.conversationId);
      await gravarVersaoDaFicha(ctx.admin, {
        organizationId: ctx.orgId,
        conversationId: ctx.conversationId,
        ficha,
        relatorio: daConversa?.relatorio || TEXTO_RENDA_CONFIRMADA,
        origem: "atendente",
        baseVersao: daConversa?.versao ?? 0,
        alteradoPor: ctx.userId,
        processoId: alvo.id,
      });
    } catch (err) {
      if (!(err instanceof FichaConflitoDeVersao)) throw err;
    }
    return {
      ok: true,
      texto: TEXTO_RENDA_CONFIRMADA,
      extra: {
        ...extraDaRenda(ficha, versao, "atendente"),
        renda_confirmada: true,
      },
    };
  } catch (err) {
    if (err instanceof LocacaoErro && err.codigo === "ficha_conflito_de_versao") {
      return {
        ok: false,
        texto: "Outra pessoa alterou a ficha. Recarregue e confirme de novo.",
        codigo: "idempotency_conflict",
      };
    }
    return { ok: false, texto: "Não foi possível confirmar a renda.", codigo: "internal_error" };
  }
}
