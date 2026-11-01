/**
 * Worker da análise de renda. Lê o extrato em blocos, sem teto de páginas,
 * grava progresso e motivo. Não roda dentro do POST.
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
import { montarRelatorioDeRenda } from "@/lib/locacao/analise/relatorio-renda";
import { aplicarRendaNaFicha, textoDoResumo } from "@/lib/locacao/analise/renda";
import { avaliarRegra3x, textoDasExclusoes3x } from "@/lib/locacao/analise/regra-3x";
import { MOTIVOS_RENDA, fraseDoMotivoDeLeitura } from "@/lib/locacao/analise/motivos-renda";
import { analiseLigada, pacoteSuperlogicaLigado } from "@/lib/locacao/chaves";
import {
  atualizarExecucao,
  conversaDoProcesso,
  reivindicarExecucao,
} from "@/lib/locacao/execucoes";
import {
  criarExtratorComModelo,
  criarLeitorPacoteViaHub,
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
  gravarEvento,
  gravarFichaDoProcesso,
  lerFichaAtualDoProcesso,
  LocacaoErro,
} from "@/lib/locacao/repositorio";
import type { LocacaoExecucaoRow } from "@/lib/locacao/tipos-banco";
import { mascararPessoaNoTexto } from "@/lib/painel/mascarar";
import { logger } from "@/lib/logger";
import type { SupabaseClient } from "@supabase/supabase-js";

const TIMEOUT_ETAPA_MS = 90_000;

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

function entradaDaExecucao(row: LocacaoExecucaoRow): {
  conversationId: string | null;
  contactId: string | null;
  senhas: Record<string, string>;
} {
  const bruto = row.resultado && typeof row.resultado === "object"
    ? (row.resultado as Record<string, unknown>)
    : {};
  const senhas = bruto.senhas && typeof bruto.senhas === "object"
    ? (bruto.senhas as Record<string, string>)
    : {};
  return {
    conversationId: typeof bruto.conversation_id === "string" ? bruto.conversation_id : null,
    contactId: typeof bruto.contact_id === "string" ? bruto.contact_id : null,
    senhas,
  };
}

async function comTimeout<T>(p: Promise<T>, ms: number, motivo: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, recusa) => {
        timer = setTimeout(() => recusa(new Error(motivo)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function marcarErro(
  admin: SupabaseClient,
  orgId: string,
  execucaoId: string,
  motivo: string,
  codigo: string,
  checklist: string[] = [],
  avisos: unknown[] = [],
): Promise<void> {
  await atualizarExecucao(admin, {
    orgId,
    execucaoId,
    estado: "erro",
    erroCodigo: codigo,
    erroMotivo: motivo,
    etapaTexto: motivo,
    resultado: { checklist, avisos, senhas: {} },
  });
}

export async function processarAnaliseDeRenda(
  admin: SupabaseClient,
  row: LocacaoExecucaoRow,
  settings: unknown,
): Promise<{ ok: boolean; motivo?: string }> {
  if (!analiseLigada(settings, "renda")) {
    await marcarErro(admin, row.organization_id, row.id, MOTIVOS_RENDA.desligada, "tool_unavailable");
    return { ok: false, motivo: MOTIVOS_RENDA.desligada };
  }

  const reivindicada = row.estado === "processando"
    ? row
    : await reivindicarExecucao(admin, {
        orgId: row.organization_id,
        execucaoId: row.id,
        etapaTexto: "lendo extrato",
      });
  if (!reivindicada && row.estado !== "processando") {
    return { ok: false, motivo: "já em andamento" };
  }

  const entrada = entradaDaExecucao(row);
  const conversationId = entrada.conversationId
    ?? await conversaDoProcesso(admin, row.organization_id, row.processo_id);
  if (!conversationId) {
    await marcarErro(admin, row.organization_id, row.id, MOTIVOS_RENDA.sem_processo, "validation_error");
    return { ok: false, motivo: MOTIVOS_RENDA.sem_processo };
  }

  const limites = limitesDaAnalise(settings);
  const { data: linhas, error: erroFontes } = await admin
    .from("messages")
    .select(
      "id,direction,type,body,media_derived_text,media_derived_status,media_mime,media_storage_path,media_size_bytes,metadata,revoked_at",
    )
    .eq("organization_id", row.organization_id)
    .eq("conversation_id", conversationId)
    .order("sent_at", { ascending: false })
    .limit(limites.mensagens_brutas);
  if (erroFontes) {
    await marcarErro(admin, row.organization_id, row.id, MOTIVOS_RENDA.conversa, "internal_error");
    return { ok: false, motivo: MOTIVOS_RENDA.conversa };
  }

  const deps = requestTurnDeps();
  const checklist: string[] = [];
  let avisosDaLeitura: unknown[] = [];
  try {
    const enriquecido = await comTimeout(
      enriquecerAnexosDaAnalise((linhas ?? []) as Record<string, unknown>[], row.organization_id, conversationId, {
        admin,
        limites,
        senhas: entrada.senhas,
        semTetoPaginas: true,
        semTetoTexto: true,
        lerDocumento: (e) => lerDocumentoPorVisao({ ...e, llmCfg: deps.llmCfg }),
        onProgresso: async (p) => {
          await atualizarExecucao(admin, {
            orgId: row.organization_id,
            execucaoId: row.id,
            estado: "processando",
            etapaTexto: p.etapa,
            progressoAtual: p.atual,
            progressoTotal: p.total,
          });
        },
      }),
      TIMEOUT_ETAPA_MS * 8,
      MOTIVOS_RENDA.timeout,
    );
    avisosDaLeitura = enriquecido.avisos;

    for (const aviso of enriquecido.avisos) {
      if (aviso.tipo === "imagem_sem_leitura") {
        checklist.push(aviso.motivo ?? fraseDoMotivoDeLeitura("falha"));
      }
      if (aviso.tipo === "pdf_escaneado" && aviso.motivo) checklist.push(aviso.motivo);
      if (aviso.tipo === "pdf_protegido") checklist.push(fraseDoMotivoDeLeitura("senha"));
    }

    await atualizarExecucao(admin, {
      orgId: row.organization_id,
      execucaoId: row.id,
      estado: "processando",
      etapaTexto: "classificando lançamentos",
    });

    const fontes = fontesDaFicha(enriquecido.linhas, {
      charsPorAnexo: limites.chars_por_arquivo,
    });
    const [doProcesso, daConversa] = await Promise.all([
      lerFichaAtualDoProcesso(admin, row.organization_id, row.processo_id),
      lerFichaAtual(admin, row.organization_id, conversationId),
    ]);
    const fichaBase = doProcesso?.ficha
      ? completarFicha(doProcesso.ficha)
      : (daConversa?.ficha ?? fichaVazia());
    const familiares = familiaresDaFicha(fichaBase);
    const pool = getRequestPool();
    const preparado = await comTimeout(
      prepararFontesDoRelatorio(fontes, {
        familiares,
        extrator: criarExtratorComModelo(
          pool,
          deps.llmCfg,
          { tenantId: row.organization_id, contactId: entrada.contactId ?? conversationId },
          { registry: deps.registry, log: deps.log },
          { purpose: "painel_analise" },
        ),
      }),
      TIMEOUT_ETAPA_MS * 4,
      MOTIVOS_RENDA.timeout,
    );

    const bloco = blocoDasFontesDaFicha(preparado.fontes);
    if (bloco.length === 0 && checklist.length > 0) {
      const motivo = checklist[0] ?? MOTIVOS_RENDA.extrato_ilegivel;
      await marcarErro(admin, row.organization_id, row.id, motivo, "validation_error", checklist, enriquecido.avisos);
      return { ok: false, motivo };
    }

    const avisos = frasesDosAvisos(enriquecido.avisos, limites.tentativas_senha);
    const incendio =
      fontes.map((f) => lerSeguroIncendioNoTexto(f.texto)).find((v) => v != null) ?? null;
    const sl = pacoteSuperlogicaLigado(settings)
      ? await criarLeitorPacoteViaHub({
          admin,
          conversationId,
        }).ler({
          orgId: row.organization_id,
          contactId: entrada.contactId ?? conversationId,
          conversationId,
        })
      : null;
    const reaisParaCentavos = (v: number | null) => (v == null ? null : Math.round(v * 100));
    const pacote = montarPacote({
      superlogica: sl,
      conversa: {
        aluguelCentavos: reaisParaCentavos(fichaBase.imovel.aluguel.valor),
        condominioCentavos: reaisParaCentavos(fichaBase.imovel.condominio.valor),
        iptuCentavos: reaisParaCentavos(fichaBase.imovel.iptu.valor),
        seguroIncendioCentavos: reaisParaCentavos(fichaBase.imovel.seguro_incendio.valor) ?? incendio,
      },
    });
    const declaradaCentavos = rendaDeclaradaNasFontes(fontes);
    const ficha = aplicarRendaNaFicha(fichaBase, {
      analises: preparado.analises,
      holeriteCentavos: preparado.holeriteCentavos,
      declarada: declaradaCentavos == null ? null : declaradaCentavos / 100,
      pacote,
      pendencias: [
        ...preparado.pendencias,
        ...avisos,
        ...checklist,
        ...(sl?.aviso ? [sl.aviso] : []),
      ],
    });
    const regra = avaliarRegra3x({
      aluguel: ficha.imovel.aluguel.valor,
      condominio: ficha.imovel.condominio.valor,
      iptu: ficha.imovel.iptu.valor,
      seguro_incendio: ficha.imovel.seguro_incendio.valor,
      seguro_fianca: ficha.contrato.seguro_fianca_mensal.valor,
      comprovada: ficha.renda.mensal.valor,
      exclusoes: {
        propria: ficha.renda.excluida.autotransferencias,
        familiar: ficha.renda.excluida.familiares,
        familiar_provavel: ficha.renda.excluida.familiares_provaveis,
        poupanca: [...ficha.renda.excluida.poupanca, ...ficha.renda.excluida.rende_facil],
        estorno: ficha.renda.excluida.estornos,
        emprestimo: ficha.renda.excluida.emprestimos,
      },
    });
    const exclusoesTexto = textoDasExclusoes3x(regra.exclusoes);
    if (exclusoesTexto && !ficha.renda.alertas.some((a) => a.includes(exclusoesTexto))) {
      ficha.renda.alertas = [...ficha.renda.alertas, `Exclusões à parte: ${exclusoesTexto}`].slice(0, 20);
    }

    const ator = row.ator_user_id ?? "00000000-0000-4000-8000-000000000000";
    const versao = await gravarFichaDoProcesso(admin, {
      orgId: row.organization_id,
      processoId: row.processo_id,
      userId: ator,
      ficha,
      origem: "preliminar_ia",
      baseVersao: doProcesso?.versao ?? 0,
      camposAlterados: ["renda"],
    });
    await gravarEvento(admin, {
      orgId: row.organization_id,
      processoId: row.processo_id,
      tipo: "renda",
      atorTipo: "usuario",
      atorId: ator,
      detalhe: {
        ficha_versao: versao,
        confirmada: false,
        participante_id: row.participante_id,
        call_id: row.call_id,
        execucao_id: row.id,
      },
    });
    const resumo = textoDoResumo(ficha);
    try {
      await gravarVersaoDaFicha(admin, {
        organizationId: row.organization_id,
        conversationId,
        ficha,
        relatorio: montarRelatorioDeRenda(ficha, preparado.analises, [
          ...preparado.pendencias,
          ...avisos,
          ...checklist,
        ]),
        origem: "preliminar_ia",
        baseVersao: daConversa?.versao ?? 0,
        alteradoPor: ator,
        processoId: row.processo_id,
      });
    } catch (err) {
      if (!(err instanceof FichaConflitoDeVersao)) throw err;
    }

    await atualizarExecucao(admin, {
      orgId: row.organization_id,
      execucaoId: row.id,
      estado: "concluido",
      etapaTexto: "concluído",
      progressoAtual: row.progresso_total || 1,
      progressoTotal: row.progresso_total || 1,
      resultado: {
        ...extraDaRenda(ficha, versao, "preliminar_ia"),
        resumo: mascararPessoaNoTexto(resumo),
        regra_3x: regra,
        checklist,
        avisos: enriquecido.avisos,
        senhas: {},
      },
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof LocacaoErro && err.codigo === "ficha_conflito_de_versao") {
      await marcarErro(admin, row.organization_id, row.id, MOTIVOS_RENDA.conflito, "idempotency_conflict", checklist, avisosDaLeitura);
      return { ok: false, motivo: MOTIVOS_RENDA.conflito };
    }
    const motivo = err instanceof Error && /timeout/i.test(err.message)
      ? MOTIVOS_RENDA.timeout
      : err instanceof LocacaoErro
        ? MOTIVOS_RENDA.gravacao
        : MOTIVOS_RENDA.documentos;
    logger.warn("[locacao-renda] execução falhou", {
      organization_id: row.organization_id,
      execucao_id: row.id,
      motivo,
    });
    await marcarErro(admin, row.organization_id, row.id, motivo, "internal_error", checklist, avisosDaLeitura);
    return { ok: false, motivo };
  }
}
