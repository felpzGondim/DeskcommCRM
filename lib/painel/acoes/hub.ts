/**
 * Consultas de leitura do Brisa Hub usadas pelos botões E pelo agente.
 * Caminho único: `executarConsultaHub` / `prepararAnaliseHub` / `confirmarAnaliseHub`.
 * Identidade do contato vai só nos cabeçalhos de identidade da conversa, nunca no argumento do modelo.
 * Nenhuma escrita na Superlógica.
 */
import { randomUUID } from "node:crypto";

import {
  apresentarResultado,
  ferramentaDaAcao,
  ferramentaDoInquilino,
  leituraPermitida,
  montarFichaTemporaria,
  tresDigitosDoCliente,
  type AcaoHub,
} from "@/lib/agent-engine/agent/painel-acoes-hub";
import {
  abrirPrevia,
  fontesDaAnalise,
  hashDasFontes,
  pendenciasDaPrevia,
  previaSchema,
  resumoDaPrevia,
  selarPrevia,
} from "@/lib/agent-engine/agent/painel-analise-preparo";
import {
  janelaUtilDaAnalise,
  limitesDaAnalise,
  rotuloDoLimite,
} from "@/lib/agent-engine/agent/painel-anexos-limites";
import { assinarAnexosParaOHub, chaveDosArquivos, ferramentaAceitaArquivos } from "@/lib/agent-engine/agent/painel-arquivos-hub";
import {
  aplicarLeiturasDocumentais,
  enriquecerAnexosDaAnalise,
  frasesDosAvisos,
  leiturasDocumentais,
  lerPdfsOriginais,
} from "@/lib/agent-engine/agent/painel-leitura-anexos";
import { prepararAnaliseNoPainel } from "@/lib/agent-engine/agent/painel-do-atendente";
import { requestTurnDeps } from "@/lib/agent-engine/agent/request-deps";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { lerDocumentoPorVisao } from "@/lib/ai/visao/ler-documento";
import { comIdempotencia } from "@/lib/api/idempotency";
import { env } from "@/lib/env";
import { telefoneDoInquilinoPrincipal } from "@/lib/locacao/ficha-telefone";
import { lerFichaAtual } from "@/lib/locacao/ficha-repositorio";
import { chamarFerramentaRemota, type FerramentaRemota } from "@/lib/mcp/servidor-externo/chamada";
import { carregarServidorMcpExterno } from "@/lib/mcp/servidor-externo/carregar";
import { mascararPessoaNoTexto } from "@/lib/painel/mascarar";
import type { ContextoDaFerramenta, ResultadoDaFerramenta } from "@/lib/painel/ferramentas/tipos";

export const NOMES_HUB_IMOVEL = ["buscar_imoveis", "buscar_imovel"] as const;
export const NOMES_HUB_PESSOAS = ["buscar_pessoas", "buscar_inquilino"] as const;

/**
 * Lista fechada das ferramentas H1/H2 (Fase 4). Só estes nomes são chamados
 * para cotação/status/print. Com a chave do Hub desligada elas não entram no
 * `tools/list` — trate como inexistentes, sem disparar o caminho antigo
 * (Migra+FC juntas, sem campo `acao`).
 */
export const NOMES_INICIAR_ANALISE_INQUILINO = [
  "iniciar_analise_inquilino",
  "brisa-hub-analise",
  "brisa_hub_analise",
] as const;
export const NOME_STATUS_ANALISE_INQUILINO = "status_analise_inquilino";
export const NOME_BAIXAR_RESULTADO_ANALISE = "baixar_resultado_analise";
export const LISTA_FECHADA_HUB_ANALISE = [
  ...NOMES_INICIAR_ANALISE_INQUILINO,
  NOME_STATUS_ANALISE_INQUILINO,
  NOME_BAIXAR_RESULTADO_ANALISE,
] as const;
export const ACOES_INICIAR_ANALISE = ["seguro", "fc_salvar"] as const;
export type AcaoIniciarAnalise = (typeof ACOES_INICIAR_ANALISE)[number];

export const TEXTO_FERRAMENTA_HUB_AUSENTE =
  "Esta ferramenta ainda não está disponível no Brisa Hub (chave desligada ou versão antiga). Nada foi disparado.";
export const TEXTO_INICIAR_SEM_ACAO =
  "O Brisa Hub desta instalação ainda não separa a cotação do seguro da análise paga. Nada foi disparado.";

class FalhaDoHub extends Error {
  constructor(
    readonly codigo: "tool_unavailable" | "hub_contract_error" | "hub_unavailable" | "validation_error" | "idempotency_conflict" | "idempotency_in_progress",
    message: string,
  ) {
    super(message);
    this.name = "FalhaDoHub";
  }
}

export function ehFalhaDoHub(e: unknown): e is FalhaDoHub {
  return e instanceof FalhaDoHub;
}

function falhou(texto: string, codigo = "hub_unavailable"): ResultadoDaFerramenta {
  return { ok: false, texto: mascararPessoaNoTexto(texto), codigo };
}

async function carregarHub(ctx: ContextoDaFerramenta) {
  return carregarServidorMcpExterno(ctx.admin, ctx.orgId, {
    contatoDoTurno: ctx.contactId,
    conversaDoTurno: ctx.conversationId,
    noAtendimento: true,
  });
}

export function ferramentaNaListaFechada(
  anunciadas: readonly FerramentaRemota[],
  nomes: readonly string[],
): FerramentaRemota | null {
  const permitidos = new Set<string>(nomes.filter((n) => (LISTA_FECHADA_HUB_ANALISE as readonly string[]).includes(n)));
  if (permitidos.size === 0) return null;
  return anunciadas.find((f) => permitidos.has(f.name)) ?? null;
}

export function schemaTemCampo(ferramenta: FerramentaRemota, campo: string): boolean {
  const props = ferramenta.inputSchema?.properties;
  return !!props && typeof props === "object" && campo in props;
}

export function iniciarAnaliseComAcao(anunciadas: readonly FerramentaRemota[]): FerramentaRemota | null {
  const f = ferramentaNaListaFechada(anunciadas, NOMES_INICIAR_ANALISE_INQUILINO);
  if (!f || !schemaTemCampo(f, "acao")) return null;
  return f;
}

function recusaComoAusente(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return /unknown tool|not found|inexistent|não encontr|nao encontr|indispon|unavailable|not announced|not exist/.test(msg);
}

function dadosDoHub(r: { dados?: unknown; texto: string }): Record<string, unknown> {
  if (r.dados && typeof r.dados === "object") return r.dados as Record<string, unknown>;
  try {
    const p = JSON.parse(r.texto) as unknown;
    if (p && typeof p === "object") return p as Record<string, unknown>;
  } catch {
    /* resposta sem JSON */
  }
  return {};
}

async function chamarNaListaFechada(
  ctx: ContextoDaFerramenta,
  ferramenta: FerramentaRemota,
  argumentos: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!(LISTA_FECHADA_HUB_ANALISE as readonly string[]).includes(ferramenta.name)) {
    throw new FalhaDoHub("tool_unavailable", TEXTO_FERRAMENTA_HUB_AUSENTE);
  }
  const montado = await carregarHub(ctx);
  if (!montado) throw new FalhaDoHub("tool_unavailable", TEXTO_FERRAMENTA_HUB_AUSENTE);
  try {
    const r = await chamarFerramentaRemota(montado.servidor, ferramenta.name, argumentos, {
      cabecalhos: montado.cabecalhos,
    });
    return dadosDoHub(r);
  } catch (err) {
    if (recusaComoAusente(err)) throw new FalhaDoHub("tool_unavailable", TEXTO_FERRAMENTA_HUB_AUSENTE);
    throw new FalhaDoHub("hub_unavailable", "Não foi possível consultar o Brisa Hub agora. Tente novamente.");
  }
}

/** Confere H1 (iniciar com `acao` + status) antes de gravar pedido. */
export async function exigirFerramentasDeSeguro(ctx: ContextoDaFerramenta): Promise<void> {
  const montado = await carregarHub(ctx);
  if (!montado) throw new FalhaDoHub("tool_unavailable", TEXTO_FERRAMENTA_HUB_AUSENTE);
  if (!iniciarAnaliseComAcao(montado.ferramentas)) {
    const anunciada = ferramentaNaListaFechada(montado.ferramentas, NOMES_INICIAR_ANALISE_INQUILINO);
    throw new FalhaDoHub("tool_unavailable", anunciada ? TEXTO_INICIAR_SEM_ACAO : TEXTO_FERRAMENTA_HUB_AUSENTE);
  }
  const status = ferramentaNaListaFechada(montado.ferramentas, [NOME_STATUS_ANALISE_INQUILINO]);
  if (!status || !schemaTemCampo(status, "pedido_id")) {
    throw new FalhaDoHub("tool_unavailable", TEXTO_FERRAMENTA_HUB_AUSENTE);
  }
}

export async function chamarIniciarAnaliseInquilino(
  ctx: ContextoDaFerramenta,
  argumentos: Record<string, unknown> & { acao: AcaoIniciarAnalise; pedido_id: string },
): Promise<Record<string, unknown>> {
  const montado = await carregarHub(ctx);
  const ferramenta = montado ? iniciarAnaliseComAcao(montado.ferramentas) : null;
  if (!montado || !ferramenta) {
    const anunciada = montado
      ? ferramentaNaListaFechada(montado.ferramentas, NOMES_INICIAR_ANALISE_INQUILINO)
      : null;
    throw new FalhaDoHub("tool_unavailable", anunciada ? TEXTO_INICIAR_SEM_ACAO : TEXTO_FERRAMENTA_HUB_AUSENTE);
  }
  const dados = await chamarNaListaFechada(ctx, ferramenta, argumentos);
  const resultado = dados.resultado;
  if (resultado !== "aceito" && resultado !== "ja_existia") {
    if (resultado === "indisponivel" || resultado === "indisponível") {
      throw new FalhaDoHub("tool_unavailable", TEXTO_FERRAMENTA_HUB_AUSENTE);
    }
    throw new FalhaDoHub("hub_contract_error", "O Brisa Hub não aceitou a cotação de seguro-fiança.");
  }
  return dados;
}

export async function chamarStatusAnaliseInquilino(
  ctx: ContextoDaFerramenta,
  pedidoId: string,
): Promise<Record<string, unknown>> {
  const montado = await carregarHub(ctx);
  const ferramenta = montado
    ? ferramentaNaListaFechada(montado.ferramentas, [NOME_STATUS_ANALISE_INQUILINO])
    : null;
  if (!montado || !ferramenta || !schemaTemCampo(ferramenta, "pedido_id")) {
    throw new FalhaDoHub("tool_unavailable", TEXTO_FERRAMENTA_HUB_AUSENTE);
  }
  return chamarNaListaFechada(ctx, ferramenta, { pedido_id: pedidoId });
}

export async function chamarBaixarResultadoAnalise(
  ctx: ContextoDaFerramenta,
  pedidoId: string,
  tipo: "print_migra" | "laudo",
): Promise<Record<string, unknown>> {
  const montado = await carregarHub(ctx);
  const ferramenta = montado
    ? ferramentaNaListaFechada(montado.ferramentas, [NOME_BAIXAR_RESULTADO_ANALISE])
    : null;
  if (!montado || !ferramenta || !schemaTemCampo(ferramenta, "pedido_id") || !schemaTemCampo(ferramenta, "tipo")) {
    throw new FalhaDoHub("tool_unavailable", TEXTO_FERRAMENTA_HUB_AUSENTE);
  }
  const spec = ferramenta.inputSchema?.properties?.tipo;
  const enumVals = spec && typeof spec === "object" ? (spec as { enum?: unknown }).enum : undefined;
  if (Array.isArray(enumVals) && !enumVals.includes(tipo)) {
    throw new FalhaDoHub("tool_unavailable", TEXTO_FERRAMENTA_HUB_AUSENTE);
  }
  return chamarNaListaFechada(ctx, ferramenta, { pedido_id: pedidoId, tipo });
}

export async function executarConsultaHub(
  ctx: ContextoDaFerramenta,
  acao: Exclude<AcaoHub, "analise">,
): Promise<ResultadoDaFerramenta> {
  if (!ctx.phoneNumber) {
    return falhou("O contato não tem telefone disponível para esta consulta.", "reply_context_unavailable");
  }
  const montado = await carregarHub(ctx);
  const ferramenta = montado && ferramentaDaAcao(acao, montado.ferramentas);
  const ferramentaInquilino =
    acao === "contrato" && montado && ferramenta?.name === "buscar_contrato"
      ? ferramentaDoInquilino(montado.ferramentas)
      : null;
  if (
    !montado ||
    !ferramenta ||
    !leituraPermitida(acao, ferramenta) ||
    (acao === "contrato" && ferramenta.name === "buscar_contrato" && ferramentaInquilino?.somenteLeitura !== true)
  ) {
    return falhou(
      "A ferramenta desta ação não está disponível no Brisa Hub. Peça à administração para conferir a integração MCP.",
      "tool_unavailable",
    );
  }
  try {
    let argumentos: Record<string, unknown> = {};
    if (acao === "boletos" && ferramenta.name === "segunda_via_boleto") {
      const { data: ultima, error: erroMensagem } = await ctx.dbSessao
        .from("messages")
        .select("body,sent_at")
        .eq("organization_id", ctx.orgId)
        .eq("conversation_id", ctx.conversationId)
        .eq("direction", "inbound")
        .is("revoked_at", null)
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (erroMensagem) throw new Error("message_read_failed");
      const cpf3 = tresDigitosDoCliente(ultima?.body, ultima?.sent_at);
      if (!cpf3) {
        return {
          ok: true,
          texto: "Aguardando os três primeiros dígitos do CPF do titular, enviados pelo cliente nesta conversa. O atendente não precisa digitá-los.",
          sugestao:
            "Para localizar sua 2ª via, por favor informe somente os três primeiros dígitos do CPF do titular do contrato. Não envie o CPF completo.",
        };
      }
      argumentos = { tres_primeiros_digitos_cpf: cpf3 };
    }
    if (acao === "ficha") {
      const { data: orgLinha } = await ctx.dbSessao
        .from("organizations")
        .select("settings")
        .eq("id", ctx.orgId)
        .maybeSingle();
      const limites = limitesDaAnalise(orgLinha?.settings ?? ctx.settings);
      const { data: linhas, error: erroFicha } = await ctx.dbSessao
        .from("messages")
        .select("type,body,media_derived_text,media_derived_status,media_mime,media_storage_path,media_size_bytes,metadata,revoked_at,direction")
        .eq("organization_id", ctx.orgId)
        .eq("conversation_id", ctx.conversationId)
        .eq("direction", "inbound")
        .order("sent_at", { ascending: false })
        .limit(limites.mensagens_brutas);
      if (erroFicha) throw new Error("message_read_failed");
      const janela = janelaUtilDaAnalise((linhas ?? []) as Record<string, unknown>[], limites);
      const deps = requestTurnDeps();
      const enriquecido = await enriquecerAnexosDaAnalise(janela, ctx.orgId, ctx.conversationId, {
        limites,
        lerDocumento: (e) => lerDocumentoPorVisao({ ...e, llmCfg: deps.llmCfg }),
      });
      argumentos = { ficha: montarFichaTemporaria(enriquecido.linhas, limites.chars_ficha_por_anexo, limites.anexos_ficha) };
    }
    const r = await chamarFerramentaRemota(montado.servidor, ferramenta.name, argumentos, {
      cabecalhos: montado.cabecalhos,
    });
    if (acao === "contrato" && ferramentaInquilino) {
      const inquilino = await chamarFerramentaRemota(montado.servidor, ferramentaInquilino.name, {}, {
        cabecalhos: montado.cabecalhos,
      });
      const dadosContrato = r.dados && typeof r.dados === "object" ? (r.dados as Record<string, unknown>) : {};
      const dadosInquilino =
        inquilino.dados && typeof inquilino.dados === "object" ? (inquilino.dados as Record<string, unknown>) : {};
      r.dados = { ...dadosContrato, inquilino_situacao: dadosInquilino.situacao };
    }
    const saida = apresentarResultado(acao, r);
    if (!saida) {
      return falhou("O Brisa Hub não devolveu os dados esperados para esta ação.", "hub_contract_error");
    }
    return {
      ok: true,
      texto: mascararPessoaNoTexto(saida.resumo),
      sugestao: saida.sugestao,
      links: saida.links,
    };
  } catch {
    return falhou("Não foi possível consultar o Brisa Hub agora. Tente novamente.");
  }
}

export async function consultarLeituraHub(
  ctx: ContextoDaFerramenta,
  nomes: readonly string[],
  ausente: string,
): Promise<ResultadoDaFerramenta> {
  const montado = await carregarHub(ctx);
  const ferramenta = montado?.ferramentas.find((f) => nomes.includes(f.name) && f.somenteLeitura === true);
  if (!montado || !ferramenta) return falhou(ausente, "tool_unavailable");
  try {
    const r = await chamarFerramentaRemota(montado.servidor, ferramenta.name, {}, {
      cabecalhos: montado.cabecalhos,
    });
    const dados = r.dados && typeof r.dados === "object" ? (r.dados as Record<string, unknown>) : null;
    if (!dados) return falhou("O Brisa Hub não devolveu os dados esperados para esta ação.", "hub_contract_error");
    const resultado = typeof dados.resultado === "string" ? dados.resultado : "ok";
    if (resultado !== "ok" && resultado !== undefined) {
      return { ok: true, texto: mascararPessoaNoTexto(`Consulta: ${resultado}.`) };
    }
    const resumo = JSON.stringify(dados).slice(0, 2_000);
    return { ok: true, texto: mascararPessoaNoTexto(resumo) };
  } catch {
    return falhou("Não foi possível consultar o Brisa Hub agora. Tente novamente.");
  }
}

export async function prepararAnaliseHub(
  ctx: ContextoDaFerramenta,
  senhasPdf: Record<string, string> = {},
): Promise<ResultadoDaFerramenta> {
  const limites = limitesDaAnalise(ctx.settings);
  const { data: linhas, error: erroFontes } = await ctx.dbSessao
    .from("messages")
    .select("direction,type,body,media_derived_text,media_derived_status,media_mime,media_storage_path,media_size_bytes,metadata,revoked_at")
    .eq("organization_id", ctx.orgId)
    .eq("conversation_id", ctx.conversationId)
    .order("sent_at", { ascending: false })
    .limit(limites.mensagens_brutas);
  if (erroFontes) return falhou("Não foi possível ler a conversa para análise.", "internal_error");
  const janela = janelaUtilDaAnalise((linhas ?? []) as Record<string, unknown>[], limites);
  const deps = requestTurnDeps();
  const escopo = `${ctx.orgId}:${ctx.conversationId}:${ctx.userId}`;
  try {
    const enriquecido = await enriquecerAnexosDaAnalise(janela, ctx.orgId, ctx.conversationId, {
      limites,
      senhas: senhasPdf,
      lerDocumento: (e) => lerDocumentoPorVisao({ ...e, llmCfg: deps.llmCfg }),
    });
    const fontes = fontesDaAnalise(enriquecido.linhas);
    const hash = hashDasFontes(fontes);
    const blocoFontes = fontes
      .map((f) => `[${f.id}] ${f.direcao} ${f.tipo} ${f.nome} ${f.legivel ? f.texto : "(sem texto documental legível)"}`)
      .join("\n");
    if (blocoFontes.length > limites.chars_conjunto) {
      return falhou("Há documentos demais para conferir de uma vez. Revise os anexos desta conversa.", "validation_error");
    }
    const resposta = await prepararAnaliseNoPainel(
      getRequestPool(),
      deps.llmCfg,
      { tenantId: ctx.orgId, contactId: ctx.contactId, fontes: blocoFontes },
      { registry: deps.registry, log: deps.log },
    );
    const previa = previaSchema.parse(JSON.parse(resposta.texto));
    const pendencias = [...pendenciasDaPrevia(previa, fontes), ...frasesDosAvisos(enriquecido.avisos, limites.tentativas_senha)];
    const unicas = [...new Set(pendencias)];
    const resumo = `${resumoDaPrevia(previa, unicas)}\n${rotuloDoLimite(limites)}`;
    const previaToken =
      unicas.length === 0
        ? selarPrevia(
            { previa, hash, expira: Date.now() + 30 * 60_000, leituras: leiturasDocumentais(enriquecido.linhas) },
            env.INTERNAL_SECRET,
            escopo,
          )
        : null;
    return {
      ok: true,
      texto: mascararPessoaNoTexto(resumo),
      previaToken,
      pronto: !!previaToken,
      avisos: enriquecido.avisos,
      extra: { limites: rotuloDoLimite(limites) },
    };
  } catch {
    return falhou("Não foi possível preparar uma prévia confiável. Confira os documentos e tente novamente.", "hub_contract_error");
  }
}

export async function confirmarAnaliseHub(
  ctx: ContextoDaFerramenta,
  input: { pedidoId: string; previaToken: string; senhasPdf?: Record<string, string> },
): Promise<ResultadoDaFerramenta> {
  const limites = limitesDaAnalise(ctx.settings);
  const { data: linhas, error: erroFontes } = await ctx.dbSessao
    .from("messages")
    .select("direction,type,body,media_derived_text,media_derived_status,media_mime,media_storage_path,media_size_bytes,metadata,revoked_at")
    .eq("organization_id", ctx.orgId)
    .eq("conversation_id", ctx.conversationId)
    .order("sent_at", { ascending: false })
    .limit(limites.mensagens_brutas);
  if (erroFontes) return falhou("Não foi possível ler a conversa para análise.", "internal_error");
  const janela = janelaUtilDaAnalise((linhas ?? []) as Record<string, unknown>[], limites);
  const escopo = `${ctx.orgId}:${ctx.conversationId}:${ctx.userId}`;
  const previaConfirmada = abrirPrevia(input.previaToken, env.INTERNAL_SECRET, escopo);
  const pdfs = await lerPdfsOriginais(janela, ctx.orgId, ctx.conversationId, ctx.admin, {
    limites,
    senhas: input.senhasPdf ?? {},
  });
  const anexosDaAnalise = aplicarLeiturasDocumentais(pdfs, previaConfirmada?.leituras);
  const fontes = fontesDaAnalise(anexosDaAnalise);
  const hash = hashDasFontes(fontes);
  if (!previaConfirmada || previaConfirmada.hash !== hash || pendenciasDaPrevia(previaConfirmada.previa, fontes).length) {
    throw new FalhaDoHub("idempotency_conflict", "A conversa mudou ou a prévia expirou. Refaça a leitura antes de confirmar.");
  }
  const montado = await carregarHub(ctx);
  const ferramenta = montado && ferramentaDaAcao("analise", montado.ferramentas);
  if (
    !montado ||
    !ferramenta ||
    !ferramenta.inputSchema?.properties?.pedido_id ||
    !ferramenta.inputSchema.properties.conversa_id ||
    !ferramenta.inputSchema.properties.candidato ||
    !ferramenta.inputSchema.properties.imovel ||
    !ferramenta.inputSchema.properties.renda
  ) {
    throw new FalhaDoHub(
      "tool_unavailable",
      "A ferramenta desta ação não está disponível no Brisa Hub. Peça à administração para conferir a integração MCP.",
    );
  }
  const previa = previaConfirmada.previa;
  const fichaAtual = await lerFichaAtual(ctx.admin, ctx.orgId, ctx.conversationId);
  const telefoneInquilino = telefoneDoInquilinoPrincipal(fichaAtual?.ficha);
  if (!telefoneInquilino) {
    throw new FalhaDoHub(
      "validation_error",
      "Informe o celular do inquilino principal na ficha preliminar antes de iniciar a análise.",
    );
  }
  const recibo = await comIdempotencia({
    db: ctx.dbSessao,
    organizationId: ctx.orgId,
    endpoint: `/api/v1/conversations/${ctx.conversationId}/painel-agente/acoes/analise`,
    exigirReserva: true,
    chave: input.pedidoId,
    corpo: { conversationId: ctx.conversationId, acao: "analise", pedidoId: input.pedidoId, hash: previaConfirmada.hash },
    executar: async () => {
      const argumentos: Record<string, unknown> = {
        pedido_id: input.pedidoId,
        conversa_id: ctx.conversationId,
        organization_id: ctx.orgId,
        candidato: {
          nome: previa.candidato.nome.valor,
          cpf: previa.candidato.cpf.valor,
          email: previa.candidato.email.valor,
          telefone: telefoneInquilino,
        },
        imovel: {
          codigo_fc: previa.imovel.codigo_fc.valor,
          logradouro: previa.imovel.logradouro.valor,
          apartamento: previa.imovel.apartamento.valor,
          aluguel: previa.imovel.aluguel.valor,
        },
        renda: { mensal: previa.renda.mensal.valor },
      };
      if (ferramentaAceitaArquivos(ferramenta)) {
        const arquivos = await assinarAnexosParaOHub(
          anexosDaAnalise,
          ctx.orgId,
          ctx.conversationId,
          ctx.admin,
          limites.url_assinada_segundos,
        );
        if (arquivos.length) argumentos[chaveDosArquivos(ferramenta)] = arquivos;
      }
      const r = await chamarFerramentaRemota(montado.servidor, ferramenta.name, argumentos, {
        cabecalhos: montado.cabecalhos,
      });
      if (
        !r.dados ||
        typeof r.dados !== "object" ||
        !["aceito", "ja_existia"].includes((r.dados as Record<string, unknown>).resultado as string)
      ) {
        throw new Error("analysis_not_accepted");
      }
      return {
        resposta: {
          resumo: "Análise iniciada no Brisa Hub. A cobrança da FC Score+ exige uma confirmação posterior no Hub.",
        },
        status: 200,
      };
    },
  });
  if (recibo.tipo === "conflito") {
    throw new FalhaDoHub("idempotency_conflict", "Este pedido já foi usado com outros dados.");
  }
  if (recibo.tipo === "em_curso") {
    throw new FalhaDoHub("idempotency_in_progress", "Esta análise já está em andamento. Aguarde e consulte novamente.");
  }
  const resumo =
    recibo.resposta && typeof recibo.resposta === "object" && "resumo" in recibo.resposta
      ? String((recibo.resposta as { resumo?: unknown }).resumo ?? "")
      : "Análise iniciada no Brisa Hub.";
  return {
    ok: true,
    texto: mascararPessoaNoTexto(resumo),
    extra: { replay: recibo.tipo === "replay", pedidoId: input.pedidoId || randomUUID() },
  };
}
