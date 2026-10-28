/**
 * FC Score+ no Painel (PR 4.3). Mesmo caminho do botão e do /pergunta.
 * Clique 1 (`analisar_fc`, L): SALVAR grátis no Hub (`acao: "fc_salvar"`).
 * Clique 2 (`confirmar_cobranca_fc`, S): só o atendente; aviso "vai gastar créditos".
 * Nada vai ao cliente. Nunca o agente confirma a cobrança.
 */
import {
  DIAS_REUSO_FC,
  decodificarLaudo,
  lerResultadoDaCobranca,
  lerStatusDoHub,
  mapearEstadoHubFc,
  montarArgumentosFc,
  papelExigeCliqueHumano,
  papelFichaDoProcesso,
  pendenciaDoPayloadFc,
  pessoaDaFichaParaFc,
  resultadoDaFc,
  sanitizarResultadoFc,
  type ResultadoDaFc,
} from "@/lib/locacao/analise/fc";
import { exigirRendaConfirmada } from "@/lib/locacao/analise/trava";
import { analiseLigada, arquivosLigados } from "@/lib/locacao/chaves";
import { hashCpfDoParticipante } from "@/lib/locacao/cpf";
import { completarFicha } from "@/lib/locacao/ficha-schema";
import type { PessoaDaFicha } from "@/lib/locacao/ficha-schema";
import { telefoneDoInquilinoPrincipal } from "@/lib/locacao/ficha-telefone";
import {
  abrirAnaliseFc,
  fcReaproveitavel,
  guardarLaudoFc,
  lerAnaliseFc,
  lerAnaliseFcEmAndamento,
  lerAnaliseFcMaisRecenteDoParticipante,
  lerAnaliseFcMaisRecenteDoProcesso,
  lerFichaAtualDoProcesso,
  lerParticipanteDoProcesso,
  lerProcesso,
  listarParticipantesParaFc,
  listarProcessosDaConversa,
  LocacaoErro,
  marcarEstadoAnaliseFc,
} from "@/lib/locacao/repositorio";
import { TEXTO_ANALISE_DESLIGADA } from "@/lib/painel/acoes/analise";
import {
  chamarBaixarResultadoAnalise,
  chamarConfirmarCobrancaFc,
  chamarIniciarAnaliseInquilino,
  chamarStatusAnaliseInquilino,
  ehFalhaDoHub,
  exigirFerramentasDeFcCobranca,
  exigirFerramentasDeFcSalvar,
} from "@/lib/painel/acoes/hub";
import { mascararPessoaNoTexto } from "@/lib/painel/mascarar";
import type { ContextoDaFerramenta, ResultadoDaFerramenta } from "@/lib/painel/ferramentas/tipos";

export const TEXTO_SEM_PROCESSO_FC = "Abra um processo de locação antes de analisar a FC.";
export const TEXTO_FC_INICIADA = "FC Score+ salva (sem cobrança). Confirme no painel para gastar créditos.";
export const TEXTO_FC_EM_ANDAMENTO = "Já há uma FC em andamento para esta pessoa. Acompanhe o status.";
export const TEXTO_FC_AGUARDANDO =
  "FC Score+ salva e pendente. Confirme a cobrança no painel — vai gastar créditos.";
export const TEXTO_FC_CONCLUIDA = "FC Score+ concluída.";
export const TEXTO_FC_REAPROVEITADA =
  "Há um FC Score+ desta pessoa nos últimos 90 dias. Reaproveitado, sem nova cobrança.";
export const TEXTO_FC_LOGIN =
  "O Brisa Hub pediu login para a FC. Depois da sessão, confirme de novo — a trava do Hub evita cobrança dupla.";
export const TEXTO_FC_ERRO = "Não foi possível analisar a FC. Tente de novo.";
export const TEXTO_FC_INCERTA =
  "A cobrança da FC ficou incerta. Nada foi confirmado daqui. Não repetimos sozinhos — clique de novo só se tiver conferido no Hub.";
export const TEXTO_FC_JA_COBRADO = "Esta FC já tinha sido cobrada. Nada novo foi disparado.";
export const TEXTO_LAUDO_SEM_ARQUIVOS =
  "O resultado foi salvo. Os arquivos do processo estão desligados, então o laudo não foi guardado.";
export const TEXTO_SEM_FC = "Não há análise FC neste processo. Dispare o salvamento primeiro.";
export const TEXTO_FIADOR_SO_ATENDENTE =
  "Fiador ou garantidor só recebe FC quando um atendente pede. A IA não dispara.";
export const TEXTO_SEM_LOCATARIO =
  "Inclua o inquilino principal como locatário no processo antes de analisar a FC.";
export const TEXTO_CONFIRMAR_SEM_PENDENTE =
  "Não há cobrança da FC aguardando confirmação neste pedido.";
export const TEXTO_AVISO_CREDITOS = "vai gastar créditos";

function recusaDesligada(): ResultadoDaFerramenta {
  return { ok: false, texto: TEXTO_ANALISE_DESLIGADA, codigo: "tool_unavailable" };
}

function recusaHub(err: unknown): ResultadoDaFerramenta {
  if (ehFalhaDoHub(err)) return { ok: false, texto: mascararPessoaNoTexto(err.message), codigo: err.codigo };
  return { ok: false, texto: TEXTO_FC_ERRO, codigo: "hub_unavailable" };
}

async function processoDaConversa(
  ctx: ContextoDaFerramenta,
  processoId?: string,
): Promise<{ id: string } | ResultadoDaFerramenta> {
  if (processoId) {
    const linha = await lerProcesso(ctx.admin, ctx.orgId, processoId);
    if (!linha) return { ok: false, texto: TEXTO_SEM_PROCESSO_FC, codigo: "validation_error" };
    return { id: processoId };
  }
  const lista = await listarProcessosDaConversa(ctx.admin, ctx.orgId, ctx.conversationId);
  const primeiro = lista[0];
  const id = typeof primeiro?.id === "string" ? primeiro.id : "";
  if (!id) return { ok: false, texto: TEXTO_SEM_PROCESSO_FC, codigo: "validation_error" };
  return { id };
}

function extraDaFc(linha: Record<string, unknown>, avisos: string[] = []) {
  const resultado = sanitizarResultadoFc(linha.resultado);
  return {
    pedido_id: linha.pedido_id,
    estado: linha.estado,
    score: resultado.score,
    risco: resultado.risco,
    id_fc: resultado.id_fc,
    laudo_disponivel: resultado.laudo_disponivel,
    documento_id: linha.documento_id ?? null,
    reaproveitada: linha.estado === "reaproveitada" || !!linha.reaproveitou_de,
    cobranca: resultado.cobranca,
    reconfirmacao: resultado.reconfirmacao,
    aviso_creditos: TEXTO_AVISO_CREDITOS,
    avisos,
  };
}

function textoDoEstado(estado: string, avisos: string[], cobranca: ResultadoDaFc["cobranca"]): string {
  if (cobranca === "incerta") return TEXTO_FC_INCERTA;
  if (cobranca === "ja_cobrado" && estado !== "concluida") return TEXTO_FC_JA_COBRADO;
  if (estado === "login_necessario") return TEXTO_FC_LOGIN;
  if (estado === "erro") return TEXTO_FC_ERRO;
  if (estado === "reaproveitada") return TEXTO_FC_REAPROVEITADA;
  if (estado === "concluida") {
    return avisos.includes("laudo_sem_arquivos")
      ? `${TEXTO_FC_CONCLUIDA} ${TEXTO_LAUDO_SEM_ARQUIVOS}`
      : TEXTO_FC_CONCLUIDA;
  }
  if (estado === "aguardando_cobranca") return TEXTO_FC_AGUARDANDO;
  if (estado === "solicitada" || estado === "cobrando") return TEXTO_FC_EM_ANDAMENTO;
  return TEXTO_FC_INICIADA;
}

async function resolverParticipante(
  ctx: ContextoDaFerramenta,
  processoId: string,
  participanteId?: string,
): Promise<
  | { id: string; papel: string; cpfHash: string | null; cpfMascarado: string | null }
  | ResultadoDaFerramenta
> {
  if (participanteId) {
    const part = await lerParticipanteDoProcesso(ctx.admin, ctx.orgId, processoId, participanteId);
    if (!part) return { ok: false, texto: TEXTO_SEM_LOCATARIO, codigo: "validation_error" };
    const papel = String(part.papel ?? "");
    if (papelExigeCliqueHumano(papel) && ctx.origem === "agente") {
      return { ok: false, texto: TEXTO_FIADOR_SO_ATENDENTE, codigo: "validation_error" };
    }
    return {
      id: String(part.id),
      papel,
      cpfHash: typeof part.cpf_hash === "string" ? part.cpf_hash : null,
      cpfMascarado: typeof part.cpf_mascarado === "string" ? part.cpf_mascarado : null,
    };
  }
  const lista = await listarParticipantesParaFc(ctx.admin, ctx.orgId, processoId);
  const locatarios = lista.filter((p) => p.papel === "locatario");
  const escolhido = locatarios.find((p) => p.principal === true) ?? locatarios[0];
  if (!escolhido) return { ok: false, texto: TEXTO_SEM_LOCATARIO, codigo: "validation_error" };
  return {
    id: String(escolhido.id),
    papel: String(escolhido.papel ?? "locatario"),
    cpfHash: typeof escolhido.cpf_hash === "string" ? escolhido.cpf_hash : null,
    cpfMascarado: typeof escolhido.cpf_mascarado === "string" ? escolhido.cpf_mascarado : null,
  };
}

function pessoaETelefone(
  ficha: ReturnType<typeof completarFicha>,
  part: { papel: string; cpfHash: string | null },
): { pessoa: PessoaDaFicha | null; telefone: string | null } {
  const pessoa = pessoaDaFichaParaFc(ficha, {
    papelFicha: papelFichaDoProcesso(part.papel),
    cpfHash: part.cpfHash,
  });
  const telPessoa = (pessoa?.celular.valor ?? "").replace(/\D/g, "").length >= 8
    ? (pessoa?.celular.valor ?? null)
    : null;
  const telefone = telPessoa ?? (part.papel === "locatario" || part.papel === "inquilino"
    ? telefoneDoInquilinoPrincipal(ficha)
    : null);
  return { pessoa, telefone };
}

async function baixarLaudoSePuder(
  ctx: ContextoDaFerramenta,
  linha: Record<string, unknown>,
  laudoDisponivel: boolean,
): Promise<{ documentoId: string | null; aviso: string | null }> {
  if (!laudoDisponivel) {
    return { documentoId: typeof linha.documento_id === "string" ? linha.documento_id : null, aviso: null };
  }
  if (typeof linha.documento_id === "string" && linha.documento_id) {
    return { documentoId: linha.documento_id, aviso: null };
  }
  if (!arquivosLigados(ctx.settings)) {
    return { documentoId: null, aviso: "laudo_sem_arquivos" };
  }
  const pedidoId = String(linha.pedido_id ?? "");
  const processoId = String(linha.processo_id ?? "");
  if (!pedidoId || !processoId) return { documentoId: null, aviso: null };
  try {
    const bruto = await chamarBaixarResultadoAnalise(ctx, pedidoId, "laudo");
    const laudo = decodificarLaudo(bruto);
    if (!laudo) return { documentoId: null, aviso: null };
    const documentoId = await guardarLaudoFc(ctx.admin, {
      orgId: ctx.orgId,
      processoId,
      userId: ctx.userId,
      participanteId: typeof linha.participante_id === "string" ? linha.participante_id : null,
      bytes: laudo.bytes,
      mime: laudo.mime,
      ext: laudo.ext,
    });
    return { documentoId, aviso: null };
  } catch {
    return { documentoId: null, aviso: null };
  }
}

async function acompanharPedido(
  ctx: ContextoDaFerramenta,
  pedidoId: string,
  cobranca: ResultadoDaFc["cobranca"] = null,
): Promise<ResultadoDaFerramenta> {
  const linha = await lerAnaliseFc(ctx.admin, ctx.orgId, pedidoId);
  if (!linha) return { ok: false, texto: TEXTO_SEM_FC, codigo: "validation_error" };
  try {
    const bruto = await chamarStatusAnaliseInquilino(ctx, pedidoId);
    const status = lerStatusDoHub(bruto);
    const estado = mapearEstadoHubFc(status.estado);
    const avisos: string[] = [];
    const laudo = await baixarLaudoSePuder(ctx, linha, status.laudo_disponivel);
    if (laudo.aviso) avisos.push(laudo.aviso);
    const resultado = resultadoDaFc(status, cobranca ?? sanitizarResultadoFc(linha.resultado).cobranca);
    await marcarEstadoAnaliseFc(ctx.admin, {
      orgId: ctx.orgId,
      pedidoId,
      estado,
      hubJobId: status.job_id,
      hubEstado: status.estado,
      resultado,
      documentoId: laudo.documentoId,
      erroCodigo: estado === "erro" || estado === "login_necessario" || resultado.cobranca === "incerta"
        ? (status.erro ?? (resultado.cobranca === "incerta" ? "cobranca_incerta" : estado))
        : null,
    });
    const atual = await lerAnaliseFc(ctx.admin, ctx.orgId, pedidoId);
    const extra = extraDaFc(atual ?? linha, avisos);
    return {
      ok: true,
      texto: mascararPessoaNoTexto(textoDoEstado(estado, avisos, extra.cobranca)),
      extra,
    };
  } catch (err) {
    return recusaHub(err);
  }
}

export async function analisarFcDoPainel(
  ctx: ContextoDaFerramenta,
  args: { processo_id?: string; participante_id?: string } = {},
): Promise<ResultadoDaFerramenta> {
  if (!analiseLigada(ctx.settings, "fc")) return recusaDesligada();
  const alvo = await processoDaConversa(ctx, args.processo_id);
  if ("ok" in alvo) return alvo;
  const processo = await lerProcesso(ctx.admin, ctx.orgId, alvo.id);
  const trava = exigirRendaConfirmada(processo);
  if (trava) return trava;

  const part = await resolverParticipante(ctx, alvo.id, args.participante_id);
  if (!("id" in part) || !("papel" in part)) return part;

  const atual = await lerFichaAtualDoProcesso(ctx.admin, ctx.orgId, alvo.id);
  if (!atual) return { ok: false, texto: TEXTO_SEM_PROCESSO_FC, codigo: "validation_error" };
  const ficha = completarFicha(atual.ficha);
  const { pessoa, telefone } = pessoaETelefone(ficha, part);
  const hashFicha = pessoa ? hashCpfDoParticipante(pessoa.cpf.valor ?? "") : null;
  const cpfHash = part.cpfHash ?? hashFicha;

  if (cpfHash) {
    const andamento = await lerAnaliseFcEmAndamento(ctx.admin, ctx.orgId, cpfHash);
    if (andamento && typeof andamento.pedido_id === "string") {
      try {
        await exigirFerramentasDeFcSalvar(ctx);
      } catch (err) {
        return recusaHub(err);
      }
      try {
        await chamarIniciarAnaliseInquilino(ctx, {
          pedido_id: andamento.pedido_id,
          conversa_id: ctx.conversationId,
          organization_id: ctx.orgId,
          acao: "fc_salvar",
        });
      } catch (err) {
        if (ehFalhaDoHub(err) && err.codigo === "tool_unavailable") return recusaHub(err);
      }
      return acompanharPedido(ctx, andamento.pedido_id);
    }
  }

  const recentePart = await lerAnaliseFcMaisRecenteDoParticipante(ctx.admin, ctx.orgId, alvo.id, part.id);
  if (recentePart && recentePart.estado === "login_necessario" && typeof recentePart.pedido_id === "string") {
    try {
      await exigirFerramentasDeFcSalvar(ctx);
    } catch (err) {
      return recusaHub(err);
    }
    return acompanharPedido(ctx, recentePart.pedido_id);
  }

  if (cpfHash) {
    const reuso = await fcReaproveitavel(ctx.admin, ctx.orgId, cpfHash, DIAS_REUSO_FC);
    if (reuso) {
      try {
        const pedidoId = await abrirAnaliseFc(ctx.admin, {
          orgId: ctx.orgId,
          processoId: alvo.id,
          participanteId: part.id,
          userId: ctx.userId,
          cpfHash,
          fichaVersao: atual.versao,
          reaproveitouDe: String(reuso.id),
        });
        const resultado = sanitizarResultadoFc(reuso.resultado);
        await marcarEstadoAnaliseFc(ctx.admin, {
          orgId: ctx.orgId,
          pedidoId,
          estado: "reaproveitada",
          resultado,
        });
        const linha = await lerAnaliseFc(ctx.admin, ctx.orgId, pedidoId);
        return {
          ok: true,
          texto: TEXTO_FC_REAPROVEITADA,
          extra: extraDaFc(linha ?? { pedido_id: pedidoId, estado: "reaproveitada", resultado, reaproveitou_de: reuso.id }),
        };
      } catch (err) {
        if (err instanceof LocacaoErro) {
          return { ok: false, texto: TEXTO_FC_ERRO, codigo: "internal_error" };
        }
        throw err;
      }
    }
  }

  try {
    await exigirFerramentasDeFcSalvar(ctx);
  } catch (err) {
    return recusaHub(err);
  }

  const pendencia = pendenciaDoPayloadFc(ficha, pessoa, telefone);
  if (pendencia || !pessoa || !telefone) {
    return { ok: false, texto: pendencia ?? TEXTO_SEM_LOCATARIO, codigo: "validation_error" };
  }

  let pedidoId: string;
  try {
    pedidoId = await abrirAnaliseFc(ctx.admin, {
      orgId: ctx.orgId,
      processoId: alvo.id,
      participanteId: part.id,
      userId: ctx.userId,
      cpfHash,
      fichaVersao: atual.versao,
    });
  } catch (err) {
    if (err instanceof LocacaoErro) {
      return { ok: false, texto: TEXTO_FC_ERRO, codigo: "internal_error" };
    }
    throw err;
  }

  const payload = montarArgumentosFc({
    ficha,
    pessoa,
    pedidoId,
    conversaId: ctx.conversationId,
    orgId: ctx.orgId,
    telefone,
  });
  if (!payload.ok) {
    await marcarEstadoAnaliseFc(ctx.admin, {
      orgId: ctx.orgId,
      pedidoId,
      estado: "erro",
      erroCodigo: "validation_error",
    });
    return { ok: false, texto: payload.motivo, codigo: "validation_error" };
  }

  try {
    const hub = await chamarIniciarAnaliseInquilino(ctx, { ...payload.argumentos, acao: "fc_salvar" });
    const jobId = typeof hub.job_id === "string" ? hub.job_id : (typeof hub.hub_job_id === "string" ? hub.hub_job_id : null);
    await marcarEstadoAnaliseFc(ctx.admin, {
      orgId: ctx.orgId,
      pedidoId,
      estado: "solicitada",
      hubJobId: jobId,
      hubEstado: typeof hub.estado === "string" ? hub.estado : "solicitada",
    });
  } catch (err) {
    await marcarEstadoAnaliseFc(ctx.admin, {
      orgId: ctx.orgId,
      pedidoId,
      estado: "erro",
      erroCodigo: ehFalhaDoHub(err) ? err.codigo : "hub_unavailable",
    });
    return recusaHub(err);
  }

  const acompanhado = await acompanharPedido(ctx, pedidoId);
  if (acompanhado.ok && acompanhado.extra?.estado === "solicitada") {
    return { ...acompanhado, texto: TEXTO_FC_INICIADA };
  }
  return acompanhado;
}

export async function statusFcDoPainel(
  ctx: ContextoDaFerramenta,
  args: { processo_id?: string; pedido_id?: string; participante_id?: string } = {},
): Promise<ResultadoDaFerramenta> {
  if (!analiseLigada(ctx.settings, "fc")) return recusaDesligada();
  const alvo = await processoDaConversa(ctx, args.processo_id);
  if ("ok" in alvo) return alvo;
  const trava = exigirRendaConfirmada(await lerProcesso(ctx.admin, ctx.orgId, alvo.id));
  if (trava) return trava;
  let pedidoId = args.pedido_id;
  if (!pedidoId && args.participante_id) {
    const linha = await lerAnaliseFcMaisRecenteDoParticipante(ctx.admin, ctx.orgId, alvo.id, args.participante_id);
    pedidoId = typeof linha?.pedido_id === "string" ? linha.pedido_id : undefined;
  }
  if (!pedidoId) {
    const linha = await lerAnaliseFcMaisRecenteDoProcesso(ctx.admin, ctx.orgId, alvo.id);
    pedidoId = typeof linha?.pedido_id === "string" ? linha.pedido_id : undefined;
  }
  if (!pedidoId) return { ok: false, texto: TEXTO_SEM_FC, codigo: "validation_error" };
  return acompanharPedido(ctx, pedidoId);
}

export async function confirmarCobrancaFcDoPainel(
  ctx: ContextoDaFerramenta,
  args: { processo_id?: string; pedido_id?: string } = {},
): Promise<ResultadoDaFerramenta> {
  if (!analiseLigada(ctx.settings, "fc")) return recusaDesligada();
  if (ctx.origem === "agente") {
    return {
      ok: false,
      texto: "A ferramenta confirmar_cobranca_fc exige clique do atendente no painel. Proposta registrada; nada foi executado.",
    };
  }
  const alvo = await processoDaConversa(ctx, args.processo_id);
  if ("ok" in alvo) return alvo;
  const trava = exigirRendaConfirmada(await lerProcesso(ctx.admin, ctx.orgId, alvo.id));
  if (trava) return trava;

  let pedidoId = args.pedido_id;
  if (!pedidoId) {
    const linha = await lerAnaliseFcMaisRecenteDoProcesso(ctx.admin, ctx.orgId, alvo.id);
    pedidoId = typeof linha?.pedido_id === "string" ? linha.pedido_id : undefined;
  }
  if (!pedidoId) return { ok: false, texto: TEXTO_SEM_FC, codigo: "validation_error" };
  const linha = await lerAnaliseFc(ctx.admin, ctx.orgId, pedidoId);
  if (!linha) return { ok: false, texto: TEXTO_SEM_FC, codigo: "validation_error" };
  const estado = String(linha.estado ?? "");
  if (estado === "concluida" || estado === "reaproveitada") {
    return {
      ok: true,
      texto: estado === "reaproveitada" ? TEXTO_FC_REAPROVEITADA : TEXTO_FC_JA_COBRADO,
      extra: extraDaFc(linha),
    };
  }
  if (estado !== "aguardando_cobranca" && estado !== "cobrando" && estado !== "login_necessario") {
    return { ok: false, texto: TEXTO_CONFIRMAR_SEM_PENDENTE, codigo: "validation_error" };
  }

  try {
    await exigirFerramentasDeFcCobranca(ctx);
  } catch (err) {
    return recusaHub(err);
  }

  try {
    const bruto = await chamarConfirmarCobrancaFc(ctx, {
      pedido_id: pedidoId,
      confirmado: true,
      confirmado_por: ctx.userId,
    });
    const cobranca = lerResultadoDaCobranca(bruto);
    if (cobranca.tipo === "indisponivel") {
      return { ok: false, texto: mascararPessoaNoTexto(
        "Esta ferramenta ainda não está disponível no Brisa Hub (chave desligada ou versão antiga). Nada foi disparado.",
      ), codigo: "tool_unavailable" };
    }
    if (cobranca.tipo === "cobranca_incerta") {
      const resultado = { ...sanitizarResultadoFc(linha.resultado), cobranca: "incerta" as const };
      await marcarEstadoAnaliseFc(ctx.admin, {
        orgId: ctx.orgId,
        pedidoId,
        estado: "aguardando_cobranca",
        resultado,
        erroCodigo: "cobranca_incerta",
        autorizadoPor: ctx.userId,
      });
      const atual = await lerAnaliseFc(ctx.admin, ctx.orgId, pedidoId);
      return {
        ok: false,
        texto: TEXTO_FC_INCERTA,
        codigo: "hub_contract_error",
        extra: extraDaFc(atual ?? { ...linha, resultado }),
      };
    }
    if (cobranca.tipo === "login_necessario") {
      await marcarEstadoAnaliseFc(ctx.admin, {
        orgId: ctx.orgId,
        pedidoId,
        estado: "login_necessario",
        erroCodigo: "login_necessario",
        autorizadoPor: ctx.userId,
      });
      const atual = await lerAnaliseFc(ctx.admin, ctx.orgId, pedidoId);
      return { ok: true, texto: TEXTO_FC_LOGIN, extra: extraDaFc(atual ?? linha) };
    }
    if (cobranca.tipo === "erro") {
      return { ok: false, texto: cobranca.motivo, codigo: "hub_contract_error" };
    }
    const cobrancaFlag = cobranca.tipo === "ja_cobrado" ? "ja_cobrado" as const : null;
    await marcarEstadoAnaliseFc(ctx.admin, {
      orgId: ctx.orgId,
      pedidoId,
      estado: "cobrando",
      hubJobId: cobranca.tipo === "ok" ? cobranca.job_id : undefined,
      autorizadoPor: ctx.userId,
      resultado: { ...sanitizarResultadoFc(linha.resultado), cobranca: cobrancaFlag },
    });
    return acompanharPedido(ctx, pedidoId, cobrancaFlag);
  } catch (err) {
    return recusaHub(err);
  }
}
