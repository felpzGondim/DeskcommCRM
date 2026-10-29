/**
 * Análise de renda no Painel (PR 4.1). Mesmo caminho do botão e do /pergunta.
 * Reabre os PDFs originais (o texto derivado corta em 8 mil caracteres).
 * Não chama Hub, FC, Migra nem Superlógica. Nada vai ao cliente.
 */
import { limitesDaAnalise } from "@/lib/agent-engine/agent/painel-anexos-limites";
import {
  enriquecerAnexosDaAnalise,
  frasesDosAvisos,
} from "@/lib/agent-engine/agent/painel-leitura-anexos";
import {
  blocoDasFontesDaFicha,
  familiaresDaFicha,
  fontesDaFicha,
  prepararFontesDoRelatorio,
  rendaDeclaradaNasFontes,
} from "@/lib/agent-engine/agent/painel-relatorio-preliminar";
import { requestTurnDeps } from "@/lib/agent-engine/agent/request-deps";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { lerDocumentoPorVisao } from "@/lib/ai/visao/ler-documento";
import { aplicarRendaNaFicha, textoDoResumo } from "@/lib/locacao/analise/renda";
import { analiseLigada, pacoteSuperlogicaLigado } from "@/lib/locacao/chaves";
import {
  criarExtratorComModelo,
  leitorSuperlogicaDesligado,
  lerSeguroIncendioNoTexto,
  montarPacote,
} from "@/lib/locacao/extrato";
import {
  FichaConflitoDeVersao,
  gravarVersaoDaFicha,
  lerFichaAtual,
} from "@/lib/locacao/ficha-repositorio";
import { completarFicha, fichaVazia, type FichaPreliminar } from "@/lib/locacao/ficha-schema";
import {
  confirmarRendaDoProcesso,
  gravarEvento,
  gravarFichaDoProcesso,
  lerFichaAtualDoProcesso,
  lerProcesso,
  listarProcessosDaConversa,
  LocacaoErro,
} from "@/lib/locacao/repositorio";
import { mascararPessoaNoTexto } from "@/lib/painel/mascarar";
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

async function fichaBase(
  ctx: ContextoDaFerramenta,
  processoId: string,
): Promise<{
  processoVersao: number;
  conversaVersao: number;
  ficha: FichaPreliminar;
  relatorio: string;
}> {
  const [doProcesso, daConversa] = await Promise.all([
    lerFichaAtualDoProcesso(ctx.admin, ctx.orgId, processoId),
    lerFichaAtual(ctx.admin, ctx.orgId, ctx.conversationId),
  ]);
  const ficha = doProcesso?.ficha
    ? completarFicha(doProcesso.ficha)
    : (daConversa?.ficha ?? fichaVazia());
  return {
    processoVersao: doProcesso?.versao ?? 0,
    conversaVersao: daConversa?.versao ?? 0,
    ficha,
    relatorio: daConversa?.relatorio ?? "",
  };
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

export async function analisarRendaDoPainel(
  ctx: ContextoDaFerramenta,
  args: { processo_id?: string; participante_id?: string; senhas?: Record<string, string> } = {},
): Promise<ResultadoDaFerramenta> {
  if (!analiseLigada(ctx.settings, "renda")) return recusaDesligada();
  const alvo = await processoDaConversa(ctx, args.processo_id);
  if ("ok" in alvo) return alvo;
  const limites = limitesDaAnalise(ctx.settings);
  const { data: linhas, error: erroFontes } = await ctx.dbSessao
    .from("messages")
    .select(
      "id,direction,type,body,media_derived_text,media_derived_status,media_mime,media_storage_path,media_size_bytes,metadata,revoked_at",
    )
    .eq("organization_id", ctx.orgId)
    .eq("conversation_id", ctx.conversationId)
    .order("sent_at", { ascending: false })
    .limit(limites.mensagens_brutas);
  if (erroFontes) {
    return {
      ok: false,
      texto: "Não foi possível ler a conversa para analisar a renda.",
      codigo: "internal_error",
    };
  }
  const janela = (linhas ?? []).slice(0, 200) as Record<string, unknown>[];
  const deps = requestTurnDeps();
  try {
    const enriquecido = await enriquecerAnexosDaAnalise(janela, ctx.orgId, ctx.conversationId, {
      limites,
      senhas: args.senhas ?? {},
      lerDocumento: (e) => lerDocumentoPorVisao({ ...e, llmCfg: deps.llmCfg }),
    });
    const fontes = fontesDaFicha(enriquecido.linhas, {
      charsPorAnexo: limites.chars_ficha_por_anexo,
    });
    const base = await fichaBase(ctx, alvo.id);
    const familiares = familiaresDaFicha(base.ficha);
    const pool = getRequestPool();
    const preparado = await prepararFontesDoRelatorio(fontes, {
      familiares,
      extrator: criarExtratorComModelo(
        pool,
        deps.llmCfg,
        { tenantId: ctx.orgId, contactId: ctx.contactId },
        { registry: deps.registry, log: deps.log },
        {
          paginasPorLote: limites.paginas_por_lote_ocr,
          charsPorLote: limites.chars_ficha_por_anexo,
          purpose: "painel_analise",
        },
      ),
    });
    const bloco = blocoDasFontesDaFicha(preparado.fontes);
    if (bloco.length > limites.chars_conjunto) {
      return {
        ok: false,
        texto: "Há documentos demais para conferir de uma vez. Revise os anexos desta conversa.",
        codigo: "validation_error",
      };
    }
    const avisos = frasesDosAvisos(enriquecido.avisos, limites.tentativas_senha);
    const incendio =
      fontes.map((f) => lerSeguroIncendioNoTexto(f.texto)).find((v) => v != null) ?? null;
    const sl = pacoteSuperlogicaLigado(ctx.settings)
      ? await leitorSuperlogicaDesligado().ler({ orgId: ctx.orgId, contactId: ctx.contactId })
      : null;
    const reaisParaCentavos = (v: number | null) => (v == null ? null : Math.round(v * 100));
    const pacote = montarPacote({
      superlogica: sl,
      conversa: {
        aluguelCentavos: reaisParaCentavos(base.ficha.imovel.aluguel.valor),
        condominioCentavos: reaisParaCentavos(base.ficha.imovel.condominio.valor),
        iptuCentavos: reaisParaCentavos(base.ficha.imovel.iptu.valor),
        seguroIncendioCentavos: incendio,
      },
    });
    const ficha = aplicarRendaNaFicha(base.ficha, {
      analises: preparado.analises,
      holeriteCentavos: preparado.holeriteCentavos,
      declarada: rendaDeclaradaNasFontes(fontes),
      pacote,
      pendencias: [...preparado.pendencias, ...avisos],
    });
    const versao = await gravarFichaDoProcesso(ctx.admin, {
      orgId: ctx.orgId,
      processoId: alvo.id,
      userId: ctx.userId,
      ficha,
      origem: "preliminar_ia",
      baseVersao: base.processoVersao,
      camposAlterados: ["renda"],
    });
    await gravarEvento(ctx.admin, {
      orgId: ctx.orgId,
      processoId: alvo.id,
      tipo: "renda",
      atorTipo: "usuario",
      atorId: ctx.userId,
      detalhe: {
        ficha_versao: versao,
        confirmada: false,
        participante_id: args.participante_id ?? null,
        call_id: null,
      },
    });
    const resumo = textoDoResumo(ficha);
    try {
      await gravarVersaoDaFicha(ctx.admin, {
        organizationId: ctx.orgId,
        conversationId: ctx.conversationId,
        ficha,
        relatorio: resumo,
        origem: "preliminar_ia",
        baseVersao: base.conversaVersao,
        alteradoPor: ctx.userId,
        processoId: alvo.id,
      });
    } catch (err) {
      if (!(err instanceof FichaConflitoDeVersao)) throw err;
    }
    return {
      ok: true,
      texto: mascararPessoaNoTexto(resumo),
      avisos: enriquecido.avisos,
      extra: extraDaRenda(ficha, versao, "preliminar_ia"),
    };
  } catch (err) {
    if (err instanceof LocacaoErro && err.codigo === "ficha_conflito_de_versao") {
      return {
        ok: false,
        texto: "Outra pessoa alterou a ficha. Recarregue e analise de novo.",
        codigo: "idempotency_conflict",
      };
    }
    if (err instanceof LocacaoErro) {
      return {
        ok: false,
        texto: "Não foi possível gravar a análise de renda.",
        codigo: "internal_error",
      };
    }
    return {
      ok: false,
      texto: "Não foi possível analisar a renda. Confira os documentos e tente novamente.",
      codigo: "hub_contract_error",
    };
  }
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
