/**
 * Manual assistido no Painel (PR 4.4). Reserva quando o robô cai em
 * `erro` ou `login_necessario`. O atendente faz no site e grava o mesmo
 * registro que o Hub gravaria. Nada vai ao cliente. Nenhum passo pago.
 */
import {
  PASSOS_FC,
  PASSOS_MIGRA,
  cpfClaroDaFicha,
  decodificarAnexoManual,
  estadoAbreManual,
  formatarCpf,
  montarDadosParaCopiar,
  pessoaDaFichaParaManual,
  resultadoManualFc,
  resultadoManualSeguro,
  validarCardsManual,
  validarResultadoManualFc,
} from "@/lib/locacao/analise/manual";
import { exigirRendaConfirmada } from "@/lib/locacao/analise/trava";
import { analiseLigada, arquivosLigados } from "@/lib/locacao/chaves";
import { completarFicha } from "@/lib/locacao/ficha-schema";
import {
  gravarEvento,
  guardarLaudoFc,
  guardarPrintMigra,
  lerAnaliseFc,
  lerAnaliseFcMaisRecenteDoProcesso,
  lerAnaliseSeguro,
  lerAnaliseSeguroMaisRecente,
  lerFichaAtualDoProcesso,
  lerProcesso,
  listarProcessosDaConversa,
  LocacaoErro,
  marcarEstadoAnaliseFc,
  marcarEstadoAnaliseSeguro,
} from "@/lib/locacao/repositorio";
import { TEXTO_ANALISE_DESLIGADA } from "@/lib/painel/acoes/analise";
import { mascararPessoaNoTexto } from "@/lib/painel/mascarar";
import type { ContextoDaFerramenta, ResultadoDaFerramenta } from "@/lib/painel/ferramentas/tipos";

export const TEXTO_SEM_PROCESSO_MANUAL = "Abra um processo de locação antes do manual assistido.";
export const TEXTO_MANUAL_SEM_FALHA =
  "O manual assistido só abre quando o robô da FC ou da Migra cai em erro ou pede login.";
export const TEXTO_MANUAL_PREPARADO = "Passo a passo pronto. Copie os dados e faça no site. O CPF continua mascarado até você revelar.";
export const TEXTO_CPF_REVELADO = "CPF revelado só nesta tela. Não fica no histórico da conversa.";
export const TEXTO_SEM_CPF_FICHA = "Não há CPF na ficha deste processo para revelar.";
export const TEXTO_MANUAL_FC_OK = "Resultado da FC registrado pelo atendente.";
export const TEXTO_MANUAL_SEGURO_OK = "Cards da cotação registrados pelo atendente.";
export const TEXTO_LAUDO_SEM_ARQUIVOS =
  "O resultado foi salvo. Os arquivos do processo estão desligados, então o laudo não foi guardado.";
export const TEXTO_PRINT_SEM_ARQUIVOS =
  "A cotação foi salva. Os arquivos do processo estão desligados, então o print não foi guardado.";
export const TEXTO_ANEXO_INVALIDO = "O arquivo anexado não pôde ser lido (PDF, PNG, JPG ou WEBP até 2 MB).";
export const TEXTO_SEM_PEDIDO_FALHO = "Não há tentativa da FC ou da Migra em erro ou login necessário neste processo.";

function recusaDesligada(): ResultadoDaFerramenta {
  return { ok: false, texto: TEXTO_ANALISE_DESLIGADA, codigo: "tool_unavailable" };
}

async function processoDaConversa(
  ctx: ContextoDaFerramenta,
  processoId?: string,
): Promise<{ id: string } | ResultadoDaFerramenta> {
  if (processoId) {
    const linha = await lerProcesso(ctx.admin, ctx.orgId, processoId);
    if (!linha) return { ok: false, texto: TEXTO_SEM_PROCESSO_MANUAL, codigo: "validation_error" };
    return { id: processoId };
  }
  const lista = await listarProcessosDaConversa(ctx.admin, ctx.orgId, ctx.conversationId);
  const primeiro = lista[0];
  const id = typeof primeiro?.id === "string" ? primeiro.id : "";
  if (!id) return { ok: false, texto: TEXTO_SEM_PROCESSO_MANUAL, codigo: "validation_error" };
  return { id };
}

function extraDaCopia(
  dados: ReturnType<typeof montarDadosParaCopiar>,
  extra: Record<string, unknown> = {},
) {
  return {
    campos: dados.campos,
    solidarios: dados.solidarios,
    vigencia: dados.vigencia,
    links: dados.links,
    passos_fc: [...PASSOS_FC],
    passos_migra: [...PASSOS_MIGRA],
    ...extra,
  };
}

export async function prepararManualDoPainel(
  ctx: ContextoDaFerramenta,
  args: { processo_id?: string; pedido_id?: string } = {},
): Promise<ResultadoDaFerramenta> {
  if (!analiseLigada(ctx.settings, "manual")) return recusaDesligada();
  const alvo = await processoDaConversa(ctx, args.processo_id);
  if ("ok" in alvo) return alvo;
  const fc = args.pedido_id
    ? await lerAnaliseFc(ctx.admin, ctx.orgId, args.pedido_id)
    : await lerAnaliseFcMaisRecenteDoProcesso(ctx.admin, ctx.orgId, alvo.id);
  const seguro = args.pedido_id && (!fc || String(fc.pedido_id) !== args.pedido_id)
    ? await lerAnaliseSeguro(ctx.admin, ctx.orgId, args.pedido_id)
    : await lerAnaliseSeguroMaisRecente(ctx.admin, ctx.orgId, alvo.id);
  const fcAbre = estadoAbreManual(typeof fc?.estado === "string" ? fc.estado : null);
  const seguroAbre = estadoAbreManual(typeof seguro?.estado === "string" ? seguro.estado : null);
  if (!fcAbre && !seguroAbre) {
    return { ok: false, texto: TEXTO_MANUAL_SEM_FALHA, codigo: "validation_error" };
  }
  const linhaFicha = await lerFichaAtualDoProcesso(ctx.admin, ctx.orgId, alvo.id);
  const ficha = completarFicha(linhaFicha?.ficha);
  const cpfHash = typeof fc?.cpf_hash === "string" ? fc.cpf_hash : null;
  const pessoa = pessoaDaFichaParaManual(ficha, { cpfHash });
  const dados = montarDadosParaCopiar(ficha, { pessoa });
  return {
    ok: true,
    texto: mascararPessoaNoTexto(TEXTO_MANUAL_PREPARADO),
    extra: extraDaCopia(dados, {
      processo_id: alvo.id,
      fc_pedido_id: fcAbre && typeof fc?.pedido_id === "string" ? fc.pedido_id : null,
      fc_estado: fcAbre ? fc?.estado : null,
      seguro_pedido_id: seguroAbre && typeof seguro?.pedido_id === "string" ? seguro.pedido_id : null,
      seguro_estado: seguroAbre ? seguro?.estado : null,
      etapa_fc: fcAbre,
      etapa_seguro: seguroAbre,
    }),
  };
}

export async function revelarCpfManualDoPainel(
  ctx: ContextoDaFerramenta,
  args: { processo_id?: string; pedido_id?: string } = {},
): Promise<ResultadoDaFerramenta> {
  if (!analiseLigada(ctx.settings, "manual")) return recusaDesligada();
  const alvo = await processoDaConversa(ctx, args.processo_id);
  if ("ok" in alvo) return alvo;
  const fc = args.pedido_id
    ? await lerAnaliseFc(ctx.admin, ctx.orgId, args.pedido_id)
    : await lerAnaliseFcMaisRecenteDoProcesso(ctx.admin, ctx.orgId, alvo.id);
  const seguro = await lerAnaliseSeguroMaisRecente(ctx.admin, ctx.orgId, alvo.id);
  const abre =
    estadoAbreManual(typeof fc?.estado === "string" ? fc.estado : null)
    || estadoAbreManual(typeof seguro?.estado === "string" ? seguro.estado : null);
  if (!abre) return { ok: false, texto: TEXTO_MANUAL_SEM_FALHA, codigo: "validation_error" };
  const linhaFicha = await lerFichaAtualDoProcesso(ctx.admin, ctx.orgId, alvo.id);
  const ficha = completarFicha(linhaFicha?.ficha);
  const pessoa = pessoaDaFichaParaManual(ficha, {
    cpfHash: typeof fc?.cpf_hash === "string" ? fc.cpf_hash : null,
  });
  const claro = cpfClaroDaFicha(pessoa);
  if (!claro) return { ok: false, texto: TEXTO_SEM_CPF_FICHA, codigo: "validation_error" };
  return {
    ok: true,
    texto: TEXTO_CPF_REVELADO,
    extra: {
      processo_id: alvo.id,
      cpf: claro,
      cpf_formatado: formatarCpf(claro),
    },
  };
}

type AnexoArgs = { bytes_b64?: string; mime?: string };

export async function registrarManualFcDoPainel(
  ctx: ContextoDaFerramenta,
  args: {
    processo_id?: string;
    pedido_id?: string;
    score?: number | string | null;
    risco?: string | null;
    id_fc?: string | null;
    anexo?: AnexoArgs;
  } = {},
): Promise<ResultadoDaFerramenta> {
  if (!analiseLigada(ctx.settings, "manual")) return recusaDesligada();
  const alvo = await processoDaConversa(ctx, args.processo_id);
  if ("ok" in alvo) return alvo;
  const processo = await lerProcesso(ctx.admin, ctx.orgId, alvo.id);
  const trava = exigirRendaConfirmada(processo);
  if (trava) return trava;
  const linha = args.pedido_id
    ? await lerAnaliseFc(ctx.admin, ctx.orgId, args.pedido_id)
    : await lerAnaliseFcMaisRecenteDoProcesso(ctx.admin, ctx.orgId, alvo.id);
  const pedidoId = typeof linha?.pedido_id === "string" ? linha.pedido_id : "";
  if (!linha || !pedidoId || !estadoAbreManual(typeof linha.estado === "string" ? linha.estado : null)) {
    return { ok: false, texto: TEXTO_SEM_PEDIDO_FALHO, codigo: "validation_error" };
  }
  const motivo = validarResultadoManualFc({ score: args.score, risco: args.risco, id_fc: args.id_fc });
  if (motivo) return { ok: false, texto: motivo, codigo: "validation_error" };

  const avisos: string[] = [];
  let documentoId: string | null = typeof linha.documento_id === "string" ? linha.documento_id : null;
  if (args.anexo?.bytes_b64) {
    if (!arquivosLigados(ctx.settings)) {
      avisos.push("laudo_sem_arquivos");
    } else {
      const laudo = decodificarAnexoManual(args.anexo, "laudo");
      if (!laudo) return { ok: false, texto: TEXTO_ANEXO_INVALIDO, codigo: "validation_error" };
      try {
        documentoId = await guardarLaudoFc(ctx.admin, {
          orgId: ctx.orgId,
          processoId: String(linha.processo_id ?? alvo.id),
          userId: ctx.userId,
          participanteId: typeof linha.participante_id === "string" ? linha.participante_id : null,
          bytes: laudo.bytes,
          mime: laudo.mime,
          ext: laudo.ext,
          origem: "manual_assistido",
        });
      } catch (e) {
        if (e instanceof LocacaoErro) return { ok: false, texto: TEXTO_ANEXO_INVALIDO, codigo: "internal_error" };
        throw e;
      }
    }
  }

  const resultado = resultadoManualFc(
    { score: args.score, risco: args.risco, id_fc: args.id_fc },
    !!documentoId,
  );
  await marcarEstadoAnaliseFc(ctx.admin, {
    orgId: ctx.orgId,
    pedidoId,
    estado: "concluida",
    origem: "manual",
    resultado,
    documentoId,
    erroCodigo: null,
    autorizadoPor: ctx.userId,
  });
  await gravarEvento(ctx.admin, {
    orgId: ctx.orgId,
    processoId: alvo.id,
    tipo: "analise_fc",
    atorTipo: "usuario",
    atorId: ctx.userId,
    detalhe: { pedido_id: pedidoId, origem: "manual", documento_id: documentoId },
  });
  const texto = avisos.includes("laudo_sem_arquivos")
    ? `${TEXTO_MANUAL_FC_OK} ${TEXTO_LAUDO_SEM_ARQUIVOS}`
    : TEXTO_MANUAL_FC_OK;
  return {
    ok: true,
    texto: mascararPessoaNoTexto(texto),
    extra: {
      pedido_id: pedidoId,
      estado: "concluida",
      origem: "manual",
      score: resultado.score,
      risco: resultado.risco,
      id_fc: resultado.id_fc,
      documento_id: documentoId,
      avisos,
    },
  };
}

export async function registrarManualSeguroDoPainel(
  ctx: ContextoDaFerramenta,
  args: {
    processo_id?: string;
    pedido_id?: string;
    cards?: unknown;
    anexo?: AnexoArgs;
  } = {},
): Promise<ResultadoDaFerramenta> {
  if (!analiseLigada(ctx.settings, "manual")) return recusaDesligada();
  const alvo = await processoDaConversa(ctx, args.processo_id);
  if ("ok" in alvo) return alvo;
  const processo = await lerProcesso(ctx.admin, ctx.orgId, alvo.id);
  const trava = exigirRendaConfirmada(processo);
  if (trava) return trava;
  const linha = args.pedido_id
    ? await lerAnaliseSeguro(ctx.admin, ctx.orgId, args.pedido_id)
    : await lerAnaliseSeguroMaisRecente(ctx.admin, ctx.orgId, alvo.id);
  const pedidoId = typeof linha?.pedido_id === "string" ? linha.pedido_id : "";
  if (!linha || !pedidoId || !estadoAbreManual(typeof linha.estado === "string" ? linha.estado : null)) {
    return { ok: false, texto: TEXTO_SEM_PEDIDO_FALHO, codigo: "validation_error" };
  }
  const motivo = validarCardsManual(args.cards);
  if (motivo) return { ok: false, texto: motivo, codigo: "validation_error" };

  const avisos: string[] = [];
  let documentoId: string | null = typeof linha.documento_id === "string" ? linha.documento_id : null;
  if (args.anexo?.bytes_b64) {
    if (!arquivosLigados(ctx.settings)) {
      avisos.push("print_sem_arquivos");
    } else {
      const print = decodificarAnexoManual(args.anexo, "print");
      if (!print) return { ok: false, texto: TEXTO_ANEXO_INVALIDO, codigo: "validation_error" };
      try {
        documentoId = await guardarPrintMigra(ctx.admin, {
          orgId: ctx.orgId,
          processoId: String(linha.processo_id ?? alvo.id),
          userId: ctx.userId,
          participanteId: typeof linha.participante_id === "string" ? linha.participante_id : null,
          bytes: print.bytes,
          mime: print.mime,
          ext: print.ext,
          origem: "manual_assistido",
        });
      } catch (e) {
        if (e instanceof LocacaoErro) return { ok: false, texto: TEXTO_ANEXO_INVALIDO, codigo: "internal_error" };
        throw e;
      }
    }
  }

  const resultado = resultadoManualSeguro(args.cards);
  if (documentoId) resultado.print_disponivel = true;
  await marcarEstadoAnaliseSeguro(ctx.admin, {
    orgId: ctx.orgId,
    pedidoId,
    estado: "concluida",
    origem: "manual",
    resultado,
    documentoId,
    erroCodigo: null,
  });
  await gravarEvento(ctx.admin, {
    orgId: ctx.orgId,
    processoId: alvo.id,
    tipo: "migra",
    atorTipo: "usuario",
    atorId: ctx.userId,
    detalhe: { pedido_id: pedidoId, origem: "manual", documento_id: documentoId },
  });
  const texto = avisos.includes("print_sem_arquivos")
    ? `${TEXTO_MANUAL_SEGURO_OK} ${TEXTO_PRINT_SEM_ARQUIVOS}`
    : TEXTO_MANUAL_SEGURO_OK;
  return {
    ok: true,
    texto: mascararPessoaNoTexto(texto),
    extra: {
      pedido_id: pedidoId,
      estado: "concluida",
      origem: "manual",
      cards: resultado.cards,
      documento_id: documentoId,
      avisos,
    },
  };
}
