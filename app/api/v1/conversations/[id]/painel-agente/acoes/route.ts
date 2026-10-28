import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { apresentarResultado, ferramentaDaAcao, ferramentaDoInquilino, leituraPermitida, montarFichaTemporaria, tresDigitosDoCliente } from "@/lib/agent-engine/agent/painel-acoes-hub";
import { abrirPrevia, fontesDaAnalise, hashDasFontes, pendenciasDaPrevia, previaSchema, resumoDaPrevia, selarPrevia } from "@/lib/agent-engine/agent/painel-analise-preparo";
import { TETO_TOKEN_PREVIA, janelaUtilDaAnalise, limitesDaAnalise, rotuloDoLimite } from "@/lib/agent-engine/agent/painel-anexos-limites";
import { assinarAnexosParaOHub, chaveDosArquivos, ferramentaAceitaArquivos } from "@/lib/agent-engine/agent/painel-arquivos-hub";
import { aplicarLeiturasDocumentais, enriquecerAnexosDaAnalise, frasesDosAvisos, leiturasDocumentais, lerPdfsOriginais } from "@/lib/agent-engine/agent/painel-leitura-anexos";
import { prepararAnaliseNoPainel } from "@/lib/agent-engine/agent/painel-do-atendente";
import { lerDocumentoPorVisao } from "@/lib/ai/visao/ler-documento";
import { requestTurnDeps } from "@/lib/agent-engine/agent/request-deps";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { comIdempotencia } from "@/lib/api/idempotency";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { chamarFerramentaRemota } from "@/lib/mcp/servidor-externo/chamada";
import { carregarServidorMcpExterno } from "@/lib/mcp/servidor-externo/carregar";
import { telefoneDoInquilinoPrincipal } from "@/lib/locacao/ficha-telefone";
import { lerFichaAtual } from "@/lib/locacao/ficha-repositorio";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const corpo = z.discriminatedUnion("acao", [
  z.object({ acao: z.enum(["boletos", "contrato", "ficha"]) }).strict(),
  z.object({ acao: z.literal("analise"), etapa: z.enum(["preparar", "confirmar"]),
    confirmar: z.literal(true).optional(), pedidoId: z.string().uuid().optional(), previaToken: z.string().max(TETO_TOKEN_PREVIA).optional(),
    senhasPdf: z.array(z.object({ nome: z.string().trim().min(1).max(120), senha: z.string().min(1).max(200) })).max(12).optional() }).strict()
    .refine((v) => v.etapa === "preparar" ? !v.confirmar && !v.pedidoId && !v.previaToken
      : v.confirmar === true && !!v.pedidoId && !!v.previaToken),
]);

export async function POST(req: NextRequest, ctx: Ctx) {
  const denied = await requireSupportWrite();
  if (denied) return denied;
  const requestId = randomUUID();
  const auth = await requireRole("agent", { requestId, resource: "conversations" });
  if (!auth.ok) return auth.response;
  const t = (s: string) => traduzir(s, auth.user.idioma);
  const orgId = auth.org.orgId;
  const { id } = await ctx.params;
  const parsed = corpo.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_error", t("Pedido inválido."), 400, { requestId });
  const pedido = parsed.data;

  const [pessoa, org] = await Promise.all([
    checkRateLimit(`painel-agente:${auth.user.id}`, 10, 60),
    checkRateLimit(`painel-agente-org:${orgId}`, 40, 60),
  ]);
  if (!pessoa.allowed || !org.allowed) return fail("rate_limited", t("Muitos pedidos seguidos. Tente em um minuto."), 429, {
    requestId, headers: { "Retry-After": "60" },
  });

  // Sessão e organização verificadas antes de usar service role para abrir o segredo da org.
  const db = await createClient();
  const { data: conversa } = await db.from("conversations").select("id,contact_id")
    .eq("organization_id", orgId).eq("id", id).maybeSingle();
  if (!conversa?.contact_id) return fail("not_found", t("Conversa não encontrada."), 404, { requestId });
  const { data: contato } = await db.from("contacts").select("id,is_anonymized,phone_number")
    .eq("organization_id", orgId).eq("id", conversa.contact_id).maybeSingle();
  if (!contato || contato.is_anonymized) {
    return fail("reply_context_unavailable", t("O contato desta conversa não está disponível."), 422, { requestId });
  }
  if (pedido.acao !== "analise" && !contato.phone_number) {
    return fail("reply_context_unavailable", t("O contato não tem telefone disponível para esta consulta."), 422, { requestId });
  }

  const registrar = (sucesso: boolean, replay = false) => void audit({
    action: `ai.painel_atendente.${pedido.acao}`,
    actorUserId: auth.user.id, organizationId: orgId, resourceType: "conversation",
    resourceId: id, requestId, metadata: { sucesso, replay },
  });

  const { data: orgLinha } = await db.from("organizations").select("settings")
    .eq("id", orgId).maybeSingle();
  const limites = limitesDaAnalise(orgLinha?.settings);
  const senhasPdf = pedido.acao === "analise"
    ? Object.fromEntries((pedido.senhasPdf ?? []).map((s) => [s.nome, s.senha])) : {};

  let previaConfirmada: ReturnType<typeof abrirPrevia> = null;
  let anexosDaAnalise: Record<string, unknown>[] = [];
  if (pedido.acao === "analise") {
    const { data: linhas, error: erroFontes } = await db.from("messages")
      .select("direction,type,body,media_derived_text,media_derived_status,media_mime,media_storage_path,media_size_bytes,metadata,revoked_at")
      .eq("organization_id", orgId).eq("conversation_id", id)
      .order("sent_at", { ascending: false }).limit(limites.mensagens_brutas);
    if (erroFontes) return fail("internal_error", t("Não foi possível ler a conversa para análise."), 500, { requestId });
    const janela = janelaUtilDaAnalise((linhas ?? []) as Record<string, unknown>[], limites);
    const deps = requestTurnDeps();
    const escopo = `${orgId}:${id}:${auth.user.id}`;
    if (pedido.etapa === "preparar") {
      try {
        const enriquecido = await enriquecerAnexosDaAnalise(janela, orgId, id, {
          limites, senhas: senhasPdf,
          lerDocumento: (e) => lerDocumentoPorVisao({ ...e, llmCfg: deps.llmCfg }),
        });
        anexosDaAnalise = enriquecido.linhas;
        const fontes = fontesDaAnalise(enriquecido.linhas);
        const hash = hashDasFontes(fontes);
        const blocoFontes = fontes.map((f) => `[${f.id}] ${f.direcao} ${f.tipo} ${f.nome} ${f.legivel ? f.texto : "(sem texto documental legível)"}`).join("\n");
        if (blocoFontes.length > limites.chars_conjunto) {
          registrar(false);
          return fail("validation_error", t("Há documentos demais para conferir de uma vez. Revise os anexos desta conversa."), 422, { requestId });
        }
        const resposta = await prepararAnaliseNoPainel(getRequestPool(), deps.llmCfg, {
          tenantId: orgId, contactId: contato.id,
          fontes: blocoFontes,
        }, { registry: deps.registry, log: deps.log });
        const previa = previaSchema.parse(JSON.parse(resposta.texto));
        const pendencias = [
          ...pendenciasDaPrevia(previa, fontes),
          ...frasesDosAvisos(enriquecido.avisos, limites.tentativas_senha),
        ];
        const unicas = [...new Set(pendencias)];
        const resumo = `${resumoDaPrevia(previa, unicas)}\n${rotuloDoLimite(limites)}`;
        const previaToken = unicas.length === 0
          ? selarPrevia({ previa, hash, expira: Date.now() + 30 * 60_000,
            leituras: leiturasDocumentais(enriquecido.linhas) }, env.INTERNAL_SECRET, escopo) : null;
        registrar(true);
        return ok({
          resumo, previaToken, pronto: !!previaToken,
          avisos: enriquecido.avisos,
          limites: rotuloDoLimite(limites),
        }, { requestId });
      } catch {
        registrar(false);
        return fail("hub_contract_error", t("Não foi possível preparar uma prévia confiável. Confira os documentos e tente novamente."), 422, { requestId });
      }
    }
    previaConfirmada = abrirPrevia(pedido.previaToken ?? "", env.INTERNAL_SECRET, escopo);
    const pdfs = await lerPdfsOriginais(janela, orgId, id, createAdminClient(), { limites, senhas: senhasPdf });
    anexosDaAnalise = aplicarLeiturasDocumentais(pdfs, previaConfirmada?.leituras);
    const fontes = fontesDaAnalise(anexosDaAnalise);
    const hash = hashDasFontes(fontes);
    if (!previaConfirmada || previaConfirmada.hash !== hash || pendenciasDaPrevia(previaConfirmada.previa, fontes).length) {
      return fail("idempotency_conflict", t("A conversa mudou ou a prévia expirou. Refaça a leitura antes de confirmar."), 409, { requestId });
    }
  }

  const montado = await carregarServidorMcpExterno(createAdminClient(), orgId, {
    contatoDoTurno: contato.id, conversaDoTurno: id, noAtendimento: true,
  });
  const ferramenta = montado && ferramentaDaAcao(pedido.acao, montado.ferramentas);
  const ferramentaInquilino = pedido.acao === "contrato" && montado && ferramenta?.name === "buscar_contrato"
    ? ferramentaDoInquilino(montado.ferramentas) : null;
  if (!montado || !ferramenta || (pedido.acao !== "analise" && !leituraPermitida(pedido.acao, ferramenta)) ||
    (pedido.acao === "contrato" && ferramenta.name === "buscar_contrato" && ferramentaInquilino?.somenteLeitura !== true) ||
    (pedido.acao === "analise" &&
    (!ferramenta.inputSchema?.properties?.pedido_id || !ferramenta.inputSchema.properties.conversa_id ||
      !ferramenta.inputSchema.properties.candidato || !ferramenta.inputSchema.properties.imovel ||
      !ferramenta.inputSchema.properties.renda))) {
    registrar(false);
    return fail("tool_unavailable", t("A ferramenta desta ação não está disponível no Brisa Hub. Peça à administração para conferir a integração MCP."), 422, { requestId });
  }
  try {
    if (pedido.acao === "analise") {
      const previa = previaConfirmada!.previa;
      const pedidoId = pedido.pedidoId!;
      const fichaAtual = await lerFichaAtual(createAdminClient(), orgId, id);
      const telefoneInquilino = telefoneDoInquilinoPrincipal(fichaAtual?.ficha);
      if (!telefoneInquilino) {
        return fail("validation_error", t("Informe o celular do inquilino principal na ficha preliminar antes de iniciar a análise."), 422, { requestId });
      }
      const recibo = await comIdempotencia({
        db, organizationId: orgId, endpoint: `/api/v1/conversations/${id}/painel-agente/acoes/analise`,
        exigirReserva: true,
        chave: pedidoId, corpo: { conversationId: id, acao: "analise", pedidoId, hash: previaConfirmada!.hash },
        executar: async () => {
          const argumentos: Record<string, unknown> = {
            pedido_id: pedidoId, conversa_id: id, organization_id: orgId,
            candidato: { nome: previa.candidato.nome.valor, cpf: previa.candidato.cpf.valor,
              email: previa.candidato.email.valor, telefone: telefoneInquilino },
            imovel: { codigo_fc: previa.imovel.codigo_fc.valor, logradouro: previa.imovel.logradouro.valor,
              apartamento: previa.imovel.apartamento.valor, aluguel: previa.imovel.aluguel.valor },
            renda: { mensal: previa.renda.mensal.valor },
          };
          if (ferramentaAceitaArquivos(ferramenta)) {
            const arquivos = await assinarAnexosParaOHub(anexosDaAnalise, orgId, id, createAdminClient(), limites.url_assinada_segundos);
            if (arquivos.length) argumentos[chaveDosArquivos(ferramenta)] = arquivos;
          }
          const r = await chamarFerramentaRemota(montado.servidor, ferramenta.name,
            argumentos, { cabecalhos: montado.cabecalhos });
          if (!r.dados || typeof r.dados !== "object" || !["aceito", "ja_existia"].includes((r.dados as Record<string, unknown>).resultado as string)) {
            throw new Error("analysis_not_accepted");
          }
          return { resposta: { resumo: "Análise iniciada no Brisa Hub. A cobrança da FC Score+ exige uma confirmação posterior no Hub." }, status: 200 };
        },
      });
      if (recibo.tipo === "conflito") return fail("idempotency_conflict", t("Este pedido já foi usado com outros dados."), 409, { requestId });
      if (recibo.tipo === "em_curso") return fail("idempotency_in_progress", t("Esta análise já está em andamento. Aguarde e consulte novamente."), 409, { requestId });
      registrar(true, recibo.tipo === "replay");
      return ok(recibo.resposta, { requestId });
    }
    let argumentos: Record<string, unknown> = {};
    if (pedido.acao === "boletos" && ferramenta.name === "segunda_via_boleto") {
      const { data: ultima, error: erroMensagem } = await db.from("messages")
        .select("body,sent_at")
        .eq("organization_id", orgId)
        .eq("conversation_id", id)
        .eq("direction", "inbound")
        .is("revoked_at", null)
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (erroMensagem) throw new Error("message_read_failed");
      const cpf3 = tresDigitosDoCliente(ultima?.body, ultima?.sent_at);
      if (!cpf3) {
        registrar(true);
        return ok({
          resumo: "Aguardando os três primeiros dígitos do CPF do titular, enviados pelo cliente nesta conversa. O atendente não precisa digitá-los.",
          sugestao: "Para localizar sua 2ª via, por favor informe somente os três primeiros dígitos do CPF do titular do contrato. Não envie o CPF completo.",
        }, { requestId });
      }
      argumentos = { tres_primeiros_digitos_cpf: cpf3 };
    }
    if (pedido.acao === "ficha") {
      const { data: linhas, error: erroFicha } = await db.from("messages")
        .select("type,body,media_derived_text,media_derived_status,media_mime,media_storage_path,media_size_bytes,metadata,revoked_at,direction")
        .eq("organization_id", orgId)
        .eq("conversation_id", id)
        .eq("direction", "inbound")
        .order("sent_at", { ascending: false })
        .limit(limites.mensagens_brutas);
      if (erroFicha) throw new Error("message_read_failed");
      const janela = janelaUtilDaAnalise((linhas ?? []) as Record<string, unknown>[], limites);
      const deps = requestTurnDeps();
      const enriquecido = await enriquecerAnexosDaAnalise(janela, orgId, id, {
        limites,
        lerDocumento: (e) => lerDocumentoPorVisao({ ...e, llmCfg: deps.llmCfg }),
      });
      argumentos = { ficha: montarFichaTemporaria(enriquecido.linhas, limites.chars_ficha_por_anexo, limites.anexos_ficha) };
    }
    const r = await chamarFerramentaRemota(montado.servidor, ferramenta.name, argumentos, { cabecalhos: montado.cabecalhos });
    if (pedido.acao === "contrato" && ferramentaInquilino) {
      const inquilino = await chamarFerramentaRemota(montado.servidor, ferramentaInquilino.name, {}, { cabecalhos: montado.cabecalhos });
      const dadosContrato = r.dados && typeof r.dados === "object" ? r.dados as Record<string, unknown> : {};
      const dadosInquilino = inquilino.dados && typeof inquilino.dados === "object" ? inquilino.dados as Record<string, unknown> : {};
      r.dados = { ...dadosContrato, inquilino_situacao: dadosInquilino.situacao };
    }
    const saida = apresentarResultado(pedido.acao, r);
    if (!saida) {
      registrar(false);
      return fail("hub_contract_error", t("O Brisa Hub não devolveu os dados esperados para esta ação."), 422, { requestId });
    }
    registrar(true);
    return ok(saida, { requestId });
  } catch {
    // Nunca propagar mensagens de erro do Hub: podem conter telefone, CPF ou chave.
    registrar(false);
    return fail("hub_unavailable", t("Não foi possível consultar o Brisa Hub agora. Tente novamente."), 502, { requestId });
  }
}
