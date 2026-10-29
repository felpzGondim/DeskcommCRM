/**
 * Cotação de seguro-fiança no Painel (PR 4.2). Mesmo caminho do botão e do /pergunta.
 * Dispara Hub com acao "seguro" e pedido_id próprio (nunca o da FC).
 * Nada vai ao cliente. Nunca Contratar. Nunca fc_salvar.
 */
import {
  decodificarPrint,
  lerStatusDoHub,
  mapearEstadoHub,
  montarArgumentosSeguro,
  pendenciaDoPayloadSeguro,
  resultadoDaCotacao,
  sanitizarCards,
} from "@/lib/locacao/analise/seguro";
import { exigirRendaConfirmada } from "@/lib/locacao/analise/trava";
import { analiseLigada, arquivosLigados } from "@/lib/locacao/chaves";
import { completarFicha } from "@/lib/locacao/ficha-schema";
import { telefoneDoInquilinoPrincipal } from "@/lib/locacao/ficha-telefone";
import {
  abrirAnaliseSeguro,
  guardarPrintMigra,
  lerAnaliseSeguro,
  lerAnaliseSeguroEmAndamento,
  lerAnaliseSeguroMaisRecente,
  lerFichaAtualDoProcesso,
  lerProcesso,
  listarProcessosDaConversa,
  LocacaoErro,
  marcarEstadoAnaliseSeguro,
} from "@/lib/locacao/repositorio";
import { garantirValoresDoProcesso } from "@/lib/locacao/valores-imovel-persistencia";
import { TEXTO_ANALISE_DESLIGADA } from "@/lib/painel/acoes/analise";
import {
  chamarBaixarResultadoAnalise,
  chamarIniciarAnaliseInquilino,
  chamarStatusAnaliseInquilino,
  ehFalhaDoHub,
  exigirFerramentasDeSeguro,
} from "@/lib/painel/acoes/hub";
import { mascararPessoaNoTexto } from "@/lib/painel/mascarar";
import type { ContextoDaFerramenta, ResultadoDaFerramenta } from "@/lib/painel/ferramentas/tipos";

export const TEXTO_SEM_PROCESSO_SEGURO = "Abra um processo de locação antes de cotar o seguro-fiança.";
export const TEXTO_SEGURO_INICIADO = "Cotação de seguro-fiança iniciada. Acompanhe o status neste painel.";
export const TEXTO_SEGURO_EM_ANDAMENTO = "Já há uma cotação em andamento neste processo. Acompanhe o status.";
export const TEXTO_SEGURO_CONCLUIDA = "Cotação de seguro-fiança concluída.";
export const TEXTO_SEGURO_LOGIN =
  "O Brisa Hub pediu login para cotar o seguro-fiança. Tente de novo depois que a sessão for refeita.";
export const TEXTO_SEGURO_ERRO = "Não foi possível cotar o seguro-fiança. Tente de novo.";
export const TEXTO_PRINT_SEM_ARQUIVOS =
  "A cotação foi salva. Os arquivos do processo estão desligados, então o print não foi guardado.";
export const TEXTO_SEM_COTACAO = "Não há cotação de seguro-fiança neste processo. Dispare a cotação primeiro.";

function recusaDesligada(): ResultadoDaFerramenta {
  return { ok: false, texto: TEXTO_ANALISE_DESLIGADA, codigo: "tool_unavailable" };
}

function recusaHub(err: unknown): ResultadoDaFerramenta {
  if (ehFalhaDoHub(err)) return { ok: false, texto: mascararPessoaNoTexto(err.message), codigo: err.codigo };
  return { ok: false, texto: TEXTO_SEGURO_ERRO, codigo: "hub_unavailable" };
}

async function processoDaConversa(
  ctx: ContextoDaFerramenta,
  processoId?: string,
): Promise<{ id: string } | ResultadoDaFerramenta> {
  if (processoId) {
    const linha = await lerProcesso(ctx.admin, ctx.orgId, processoId);
    if (!linha) return { ok: false, texto: TEXTO_SEM_PROCESSO_SEGURO, codigo: "validation_error" };
    return { id: processoId };
  }
  const lista = await listarProcessosDaConversa(ctx.admin, ctx.orgId, ctx.conversationId);
  const primeiro = lista[0];
  const id = typeof primeiro?.id === "string" ? primeiro.id : "";
  if (!id) return { ok: false, texto: TEXTO_SEM_PROCESSO_SEGURO, codigo: "validation_error" };
  return { id };
}

function extraDoSeguro(linha: Record<string, unknown>, avisos: string[] = []) {
  const resultado = linha.resultado && typeof linha.resultado === "object"
    ? (linha.resultado as Record<string, unknown>)
    : {};
  return {
    pedido_id: linha.pedido_id,
    estado: linha.estado,
    cards: sanitizarCards(resultado.cards),
    print_disponivel: resultado.print_disponivel === true,
    documento_id: linha.documento_id ?? null,
    avisos,
  };
}

function textoDoEstado(estado: string, avisos: string[]): string {
  if (estado === "login_necessario") return TEXTO_SEGURO_LOGIN;
  if (estado === "erro") return TEXTO_SEGURO_ERRO;
  if (estado === "concluida") {
    return avisos.includes("print_sem_arquivos")
      ? `${TEXTO_SEGURO_CONCLUIDA} ${TEXTO_PRINT_SEM_ARQUIVOS}`
      : TEXTO_SEGURO_CONCLUIDA;
  }
  if (estado === "solicitada" || estado === "cotando") return TEXTO_SEGURO_EM_ANDAMENTO;
  return TEXTO_SEGURO_INICIADO;
}

async function baixarPrintSePuder(
  ctx: ContextoDaFerramenta,
  linha: Record<string, unknown>,
  printDisponivel: boolean,
): Promise<{ documentoId: string | null; aviso: string | null }> {
  if (!printDisponivel) return { documentoId: typeof linha.documento_id === "string" ? linha.documento_id : null, aviso: null };
  if (typeof linha.documento_id === "string" && linha.documento_id) {
    return { documentoId: linha.documento_id, aviso: null };
  }
  if (!arquivosLigados(ctx.settings)) {
    return { documentoId: null, aviso: "print_sem_arquivos" };
  }
  const pedidoId = String(linha.pedido_id ?? "");
  const processoId = String(linha.processo_id ?? "");
  if (!pedidoId || !processoId) return { documentoId: null, aviso: null };
  try {
    const bruto = await chamarBaixarResultadoAnalise(ctx, pedidoId, "print_migra");
    const print = decodificarPrint(bruto);
    if (!print) return { documentoId: null, aviso: null };
    const documentoId = await guardarPrintMigra(ctx.admin, {
      orgId: ctx.orgId,
      processoId,
      userId: ctx.userId,
      participanteId: typeof linha.participante_id === "string" ? linha.participante_id : null,
      bytes: print.bytes,
      mime: print.mime,
      ext: print.ext,
    });
    return { documentoId, aviso: null };
  } catch {
    return { documentoId: null, aviso: null };
  }
}

async function acompanharPedido(
  ctx: ContextoDaFerramenta,
  pedidoId: string,
): Promise<ResultadoDaFerramenta> {
  const linha = await lerAnaliseSeguro(ctx.admin, ctx.orgId, pedidoId);
  if (!linha) return { ok: false, texto: TEXTO_SEM_COTACAO, codigo: "validation_error" };
  try {
    const bruto = await chamarStatusAnaliseInquilino(ctx, pedidoId);
    const status = lerStatusDoHub(bruto);
    const estado = mapearEstadoHub(status.estado);
    const avisos: string[] = [];
    const print = await baixarPrintSePuder(ctx, linha, status.print_disponivel);
    if (print.aviso) avisos.push(print.aviso);
    await marcarEstadoAnaliseSeguro(ctx.admin, {
      orgId: ctx.orgId,
      pedidoId,
      estado,
      hubJobId: status.job_id,
      hubEstado: status.estado,
      resultado: resultadoDaCotacao(status),
      documentoId: print.documentoId,
      erroCodigo: estado === "erro" || estado === "login_necessario"
        ? (status.erro ?? estado)
        : null,
    });
    const atual = await lerAnaliseSeguro(ctx.admin, ctx.orgId, pedidoId);
    const extra = extraDoSeguro(atual ?? linha, avisos);
    return {
      ok: true,
      texto: mascararPessoaNoTexto(textoDoEstado(estado, avisos)),
      extra,
    };
  } catch (err) {
    return recusaHub(err);
  }
}

export async function analisarSeguroDoPainel(
  ctx: ContextoDaFerramenta,
  args: { processo_id?: string } = {},
): Promise<ResultadoDaFerramenta> {
  if (!analiseLigada(ctx.settings, "seguro")) return recusaDesligada();
  const alvo = await processoDaConversa(ctx, args.processo_id);
  if ("ok" in alvo) return alvo;
  const processo = await lerProcesso(ctx.admin, ctx.orgId, alvo.id);
  const trava = exigirRendaConfirmada(processo);
  if (trava) return trava;

  try {
    await exigirFerramentasDeSeguro(ctx);
  } catch (err) {
    return recusaHub(err);
  }

  const andamento = await lerAnaliseSeguroEmAndamento(ctx.admin, ctx.orgId, alvo.id);
  if (andamento && typeof andamento.pedido_id === "string") {
    try {
      await chamarIniciarAnaliseInquilino(ctx, {
        pedido_id: andamento.pedido_id,
        conversa_id: ctx.conversationId,
        organization_id: ctx.orgId,
        acao: "seguro",
      });
    } catch (err) {
      if (ehFalhaDoHub(err) && err.codigo === "tool_unavailable") return recusaHub(err);
    }
    return acompanharPedido(ctx, andamento.pedido_id);
  }

  const atual = await lerFichaAtualDoProcesso(ctx.admin, ctx.orgId, alvo.id);
  if (!atual) {
    return { ok: false, texto: TEXTO_SEM_PROCESSO_SEGURO, codigo: "validation_error" };
  }
  const ficha = completarFicha(atual.ficha);
  const telefone = telefoneDoInquilinoPrincipal(ficha);
  const valores = await garantirValoresDoProcesso(ctx.admin, {
    orgId: ctx.orgId,
    processoId: alvo.id,
    settings: ctx.settings,
  });
  const pendencia = pendenciaDoPayloadSeguro(ficha, telefone, valores);
  if (pendencia || !telefone) {
    return { ok: false, texto: pendencia ?? "Informe o celular do inquilino principal na ficha antes de cotar o seguro.", codigo: "validation_error" };
  }

  let aberto: { pedidoId: string; reusou: boolean };
  try {
    aberto = await abrirAnaliseSeguro(ctx.admin, {
      orgId: ctx.orgId,
      processoId: alvo.id,
      userId: ctx.userId,
      fichaVersao: atual.versao,
    });
  } catch (err) {
    if (err instanceof LocacaoErro) {
      return { ok: false, texto: TEXTO_SEGURO_ERRO, codigo: "internal_error" };
    }
    throw err;
  }

  const payload = montarArgumentosSeguro({
    ficha,
    pedidoId: aberto.pedidoId,
    conversaId: ctx.conversationId,
    orgId: ctx.orgId,
    telefone,
    valores,
  });
  if (!payload.ok) {
    if (!aberto.reusou) {
      await marcarEstadoAnaliseSeguro(ctx.admin, {
        orgId: ctx.orgId,
        pedidoId: aberto.pedidoId,
        estado: "erro",
        erroCodigo: "validation_error",
      });
    }
    return { ok: false, texto: payload.motivo, codigo: "validation_error" };
  }

  try {
    const hub = await chamarIniciarAnaliseInquilino(ctx, { ...payload.argumentos, acao: "seguro" });
    const jobId = typeof hub.job_id === "string" ? hub.job_id : (typeof hub.hub_job_id === "string" ? hub.hub_job_id : null);
    await marcarEstadoAnaliseSeguro(ctx.admin, {
      orgId: ctx.orgId,
      pedidoId: aberto.pedidoId,
      estado: "cotando",
      hubJobId: jobId,
      hubEstado: typeof hub.estado === "string" ? hub.estado : "cotando",
    });
  } catch (err) {
    if (!aberto.reusou) {
      await marcarEstadoAnaliseSeguro(ctx.admin, {
        orgId: ctx.orgId,
        pedidoId: aberto.pedidoId,
        estado: "erro",
        erroCodigo: ehFalhaDoHub(err) ? err.codigo : "hub_unavailable",
      });
    }
    return recusaHub(err);
  }

  const acompanhado = await acompanharPedido(ctx, aberto.pedidoId);
  if (acompanhado.ok && !aberto.reusou && acompanhado.texto === TEXTO_SEGURO_EM_ANDAMENTO) {
    return { ...acompanhado, texto: TEXTO_SEGURO_INICIADO };
  }
  return acompanhado;
}

export async function statusSeguroDoPainel(
  ctx: ContextoDaFerramenta,
  args: { processo_id?: string; pedido_id?: string } = {},
): Promise<ResultadoDaFerramenta> {
  if (!analiseLigada(ctx.settings, "seguro")) return recusaDesligada();
  const alvo = await processoDaConversa(ctx, args.processo_id);
  if ("ok" in alvo) return alvo;
  const trava = exigirRendaConfirmada(await lerProcesso(ctx.admin, ctx.orgId, alvo.id));
  if (trava) return trava;
  let pedidoId = args.pedido_id;
  if (!pedidoId) {
    const linha = await lerAnaliseSeguroEmAndamento(ctx.admin, ctx.orgId, alvo.id)
      ?? await lerAnaliseSeguroMaisRecente(ctx.admin, ctx.orgId, alvo.id);
    pedidoId = typeof linha?.pedido_id === "string" ? linha.pedido_id : undefined;
  }
  if (!pedidoId) return { ok: false, texto: TEXTO_SEM_COTACAO, codigo: "validation_error" };
  return acompanharPedido(ctx, pedidoId);
}
