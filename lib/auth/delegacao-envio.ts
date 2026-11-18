/** Única passagem do JWT delegado para o handler de escrita do Inbox. */
import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { reservarTetosCompartilhados } from "@/lib/ai/dispatcher/rate-limit";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { comIdempotencia, TTL_MS } from "@/lib/api/idempotency";
import { ApiError } from "@/lib/api/types";
import { audit } from "@/lib/audit";
import { roleAtLeast } from "@/lib/auth/types";
import {
  listarSessoesDelegadas,
  autorizarConversaDelegada,
  autorizarSessaoDelegada,
  carregarAcessoDelegado,
  grantsComEfeito,
  type DepsSuperficieDelegada,
  type OrigemDelegada,
} from "@/lib/auth/delegacao-superficie";
import type { SujeitoOAuth } from "@/lib/auth/delegacao-oauth-sujeito";
import {
  CHANNEL_SESSION_REF_COLUMNS,
  getAdapter,
  resolveSessionRef,
  type ChannelSessionRef,
} from "@/lib/channels";
import { canalDesativado } from "@/lib/channels/desativado";
import { PROVIDERS_DE_TELEFONE } from "@/lib/channels/capabilities";
import { phoneLookupVariants } from "@/lib/channels/phone-variants";
import type { ChannelAdapter, RecipientInput } from "@/lib/channels/types";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { MAX_MEDIA_BYTES } from "@/lib/messaging/media/types";
import { kindFromMime } from "@/lib/messaging/media/upload-validation";
import { openSharedContactConversation } from "@/lib/messaging/open-shared-contact-conversation";
import {
  depsDoRitmo,
  registrarEnvioPorToken,
  segurarEnvioPorToken,
} from "@/lib/messaging/ritmo-do-envio-por-token";
import { assertOrgOperante, OrgNaoOperanteError } from "@/lib/organizacao/operante";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Message } from "@/lib/types/messaging";

import { type PedidoEnvioDelegado } from "./delegacao-envio-entrada";

type Deps = Pick<DepsSuperficieDelegada, "agora" | "buscarGrants" | "clientDoUsuario">;

type Contexto = {
  db: SupabaseClient;
  org: string;
  uid: string;
  origem: OrigemDelegada;
  requestId: string;
  sessaoId: string;
  ref: string;
  transporte: ChannelAdapter;
  role: string;
};

type Recibo = {
  status: string;
  message_id: string | null;
  external_id: string | null;
  sent_at: string | null;
  conversation_id: string;
  deduplicated: boolean;
};

type Falha = {
  ok: false;
  status: 404 | 409 | 422 | 429 | 503;
  motivo: string;
  retry_after?: number;
};

type Resultado = { ok: true; dados: Recibo } | Falha;

type Contato = {
  id: string;
  phone_number: string | null;
  wa_identity: string | null;
  wa_lid: string | null;
  is_blocked: boolean;
  is_personal: boolean;
};

type Midia = {
  bytes: Buffer;
  nome: string;
  mime: string;
};

const BUCKET_OUTBOUND = "whatsapp-media";
const COLUNAS_CONTATO = "id,phone_number,wa_identity,wa_lid,is_blocked,is_personal";
const HORA = { limite: 20, segundos: 3600 };
const DIA = { limite: 80, segundos: 86400 };
const E164 = /^\+[1-9]\d{7,14}$/;

function falha(motivo: string, status: Falha["status"] = 404, retryAfter?: number): Falha {
  return { ok: false, status, motivo, retry_after: retryAfter };
}

function hash(bytes: string | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function auditar(
  ctx: Pick<Contexto, "org" | "uid" | "origem" | "requestId">,
  motivo: string,
  recibo?: Recibo,
  conversaId?: string,
) {
  void audit({
    action: motivo === "ok" ? "delegacao.mensagem_enviada" : "delegacao.envio_recusado",
    actorUserId: ctx.uid,
    organizationId: ctx.org,
    resourceType: "conversation",
    resourceId: recibo?.conversation_id ?? conversaId,
    requestId: ctx.requestId,
    bypassedRls: true,
    metadata: {
      origem: ctx.origem,
      motivo,
      conversation_id: recibo?.conversation_id ?? conversaId,
      message_id: recibo?.message_id,
      external_id: recibo?.external_id,
    },
  });
}

function prefixar(texto: string | undefined, origem: OrigemDelegada): string | undefined {
  const nome = env.DELEGACAO_ENVIO_PREFIXO_NOME;
  if (!texto || !nome || origem !== "empresarial") return texto;
  const prefixo = `*${nome}*: `;
  return texto.startsWith(prefixo) ? texto : prefixo + texto;
}

function nomeSeguro(nome: string): string {
  return (
    nome
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/^\.+/, "")
      .slice(-120) || "arquivo"
  );
}

async function baixarAnexo(
  client: SupabaseClient,
  anexo: NonNullable<PedidoEnvioDelegado["anexo"]>,
): Promise<Midia | Falha> {
  // O próprio download passa pela RLS de Storage, como a assinatura do
  // delegacao_baixar. O client privilegiado nunca lê o path pedido pelo bot.
  const bucket = client.storage.from(anexo.bucket);
  const info = await bucket.info(anexo.path);
  if (info.error || !info.data) return falha("anexo_fora_do_recurso");
  if ((info.data.size ?? 0) > MAX_MEDIA_BYTES) return falha("arquivo_grande", 422);
  const r = await bucket.download(anexo.path).asStream();
  if (r.error || !r.data) return falha("anexo_fora_do_recurso");
  const leitor = r.data.getReader();
  const partes: Buffer[] = [];
  let tamanho = 0;
  try {
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      const parte = Buffer.from(value as Uint8Array);
      tamanho += parte.length;
      if (tamanho > MAX_MEDIA_BYTES) {
        await leitor.cancel();
        return falha("arquivo_grande", 422);
      }
      partes.push(parte);
    }
  } finally {
    leitor.releaseLock();
  }
  if (!tamanho) return falha("arquivo_vazio", 422);
  return {
    bytes: Buffer.concat(partes, tamanho),
    nome: anexo.path.split("/").pop() ?? "arquivo",
    mime: info.data.contentType ?? "application/octet-stream",
  };
}

function contatoPermitido(contato: Contato | null): contato is Contato {
  return !!contato && contato.is_personal === false && contato.is_blocked === false;
}

function destinoDoContato(
  contato: Contato,
  grupo: { is_group: boolean; group_chat_id: string | null },
): RecipientInput {
  return {
    isGroup: grupo.is_group,
    groupChatId: grupo.group_chat_id,
    phoneNumber: contato.phone_number,
    waIdentity: contato.wa_identity,
    waLid: contato.wa_lid,
  };
}

async function telefoneConfirmado(
  ctx: Contexto,
  telefone?: string | null,
  identidade?: string | null,
) {
  const { transporte, ref, org } = ctx;
  if (!transporte.resolveRegisteredPhone) return null;
  try {
    const telefoneDoLid = identidade
      ? await transporte.resolvePhoneForIdentity?.({
          organizationId: org,
          sessionRef: ref,
          identity: identidade,
        })
      : null;
    // Um telefone confirmado não basta se o destino efetivo for um LID
    // divergente. Confere a correspondência antes de conservar o LID.
    if (
      identidade &&
      (!telefoneDoLid || (telefone && !phoneLookupVariants(telefone).includes(telefoneDoLid)))
    ) {
      return null;
    }
    const numero = telefoneDoLid ?? telefone;
    if (!numero || !E164.test(numero)) return null;
    const existente = await transporte.resolveRegisteredPhone({
      organizationId: org,
      sessionRef: ref,
      phone: numero,
    });
    if (!existente) return null;
    const e164 = existente.startsWith("+") ? existente : `+${existente}`;
    return phoneLookupVariants(numero).includes(e164) ? e164 : null;
  } catch {
    return null;
  }
}

async function papelAtivo(db: SupabaseClient, org: string, uid: string): Promise<string | null> {
  const { data, error } = await db
    .from("user_organizations")
    .select("role")
    .eq("organization_id", org)
    .eq("user_id", uid)
    .is("revoked_at", null)
    .maybeSingle();
  if (error || !data?.role || (!roleAtLeast(data.role, "agent") && data.role !== "owner"))
    return null;
  return data.role;
}

async function lerContato(ctx: Contexto, id: string): Promise<Contato | null> {
  const { data, error } = await ctx.db
    .from("contacts")
    .select(COLUNAS_CONTATO)
    .eq("organization_id", ctx.org)
    .eq("id", id)
    .maybeSingle();
  return error ? null : (data as Contato | null);
}

async function prepararAlvo(ctx: Contexto, pedido: PedidoEnvioDelegado) {
  const { db, org, transporte } = ctx;
  if ("conversation_id" in pedido) {
    const { data: conversa, error } = await db
      .from("conversations")
      .select("id,contact_id,is_group,group_chat_id")
      .eq("organization_id", org)
      .eq("channel_session_id", ctx.sessaoId)
      .eq("id", pedido.conversation_id)
      .maybeSingle();
    if (error || !conversa) return falha("conversa_nao_autorizada");
    const contato = await lerContato(ctx, conversa.contact_id);
    if (!contatoPermitido(contato)) return falha("contato_indisponivel");
    const destinoOriginal = destinoDoContato(contato, conversa);
    if (conversa.is_group) {
      const destino = conversa.group_chat_id && transporte.resolveRecipient(destinoOriginal);
      return destino ? { conversa, destino, destinoOriginal } : falha("grupo_sem_destino");
    }
    const lid = contato.wa_lid
      ? `lid:${contato.wa_lid}`
      : contato.wa_identity?.startsWith("lid:")
        ? contato.wa_identity
        : null;
    const telefone = await telefoneConfirmado(ctx, contato.phone_number, lid);
    if (!telefone) return falha("numero_nao_confirmado");
    const destino = transporte.resolveRecipient({ ...destinoOriginal, phoneNumber: telefone });
    return destino ? { conversa, destino, destinoOriginal } : falha("numero_nao_confirmado");
  }

  const telefone = await telefoneConfirmado(ctx, pedido.telefone);
  if (!telefone) return falha("numero_nao_confirmado");
  const { data: contatos, error } = await db
    .from("contacts")
    .select(COLUNAS_CONTATO)
    .eq("organization_id", org)
    .is("is_merged_into", null)
    .in("phone_number", phoneLookupVariants(telefone));
  // Cobre as duas grafias antes de qualquer criação, inclusive se um gêmeo
  // legado ainda não fundido estiver bloqueado ou marcado como pessoal.
  if (error || !contatos || contatos.some((c) => !contatoPermitido(c))) {
    return falha("contato_indisponivel");
  }
  const destino = transporte.resolveRecipient({
    isGroup: false,
    groupChatId: null,
    phoneNumber: telefone,
    waIdentity: null,
  });
  return destino ? { destino, telefone } : falha("numero_nao_confirmado");
}

type Alvo = Exclude<Awaited<ReturnType<typeof prepararAlvo>>, Falha>;

async function abrirAlvo(ctx: Contexto, pedido: PedidoEnvioDelegado, alvo: Alvo) {
  if (alvo.conversa) {
    return {
      id: alvo.conversa.id,
      contatoId: alvo.conversa.contact_id,
      destinatario: alvo.destinoOriginal,
    };
  }
  const aberta = await openSharedContactConversation(ctx.db, ctx.org, {
    channel_session_id: ctx.sessaoId,
    phone_number: alvo.telefone,
    name: "nome" in pedido ? pedido.nome : undefined,
    vetarBloqueado: true,
  });
  const contato = await lerContato(ctx, aberta.contact_id);
  if (
    !contatoPermitido(contato) ||
    !contato.phone_number ||
    !phoneLookupVariants(alvo.telefone).includes(contato.phone_number)
  ) {
    throw new Error("contato_indisponivel");
  }
  return {
    id: aberta.conversation_id,
    contatoId: aberta.contact_id,
    destinatario: destinoDoContato(contato, { is_group: false, group_chat_id: null }),
  };
}

function reciboDaMensagem(
  msg: Pick<Message, "id" | "status" | "external_id" | "sent_at">,
  conversaId: string,
): Recibo {
  return {
    status: msg.status,
    message_id: msg.id,
    // IDs compostos do canal podem conter o endereço. A correlação fora da
    // Inbox é pelo message_id ou pelo hash estável, inclusive na auditoria.
    external_id: msg.external_id ? hash(msg.external_id) : null,
    sent_at: msg.sent_at,
    conversation_id: conversaId,
    deduplicated: false,
  };
}

/** Usada somente depois de o HTTP verificar o sujeito OAuth. */
export async function executarEnvioDelegado(
  sujeito: SujeitoOAuth,
  pedido: PedidoEnvioDelegado,
  deps: Deps,
  requestId: string,
): Promise<Resultado> {
  if (!env.DELEGACAO_ENVIO_HABILITADO) return falha("envio_desligado");
  const autorizacao = await carregarAcessoDelegado(sujeito, deps, "enviar");
  if (!autorizacao.ok) return falha(autorizacao.motivo);
  const { acesso } = autorizacao;
  const existente = "conversation_id" in pedido ? pedido.conversation_id : undefined;
  const alvoRls =
    "conversation_id" in pedido
      ? await autorizarConversaDelegada(acesso, "enviar", pedido.conversation_id)
      : await autorizarSessaoDelegada(acesso, "enviar", pedido.channel_session_id);
  if (!alvoRls.ok) return falha(alvoRls.motivo);

  const { sessao } = alvoRls;
  const org = sessao.organization_id;
  const origem = sessao.origem;
  const corpo = prefixar(pedido.legenda ?? pedido.texto, origem);
  if (corpo && corpo.length > 4096) return falha("texto_acima_do_limite", 422);

  const { arquivo, anexo, idempotency_key: chave, ...entrada } = pedido;
  if (
    anexo &&
    !grantsComEfeito(acesso, "baixar").some((g) => g.organization_id === anexo.path.split("/")[0])
  )
    return falha("anexo_fora_do_recurso");
  const midiaDoBot = arquivo
    ? { nome: arquivo.nome, mime: arquivo.mime, bytes: Buffer.from(arquivo.base64, "base64") }
    : null;

  // A troca de cliente só ocorre com a org, o efeito e a origem provados
  // pelo JWT. Nenhuma consulta privilegiada escolhe a organização.
  const db = createAdminClient();
  const base = {
    db,
    org,
    origem,
    uid: sujeito.userId,
    requestId,
    sessaoId: sessao.channel_session_id,
  };
  const recusar = (r: Falha, conversaId = existente) => {
    auditar(base, r.motivo, undefined, conversaId);
    return r;
  };
  const role = await papelAtivo(db, org, sujeito.userId);
  if (!role) return recusar(falha("papel_insuficiente"));

  // Só o vencedor da reserva pode verificar mídia, consumir quota ou tocar
  // o transporte. Se o recibo se perder, a reserva dura a janela de replay.
  let espera: Falha | undefined;
  let conversaDaRecusa = existente;
  const resultado = await comIdempotencia<Resultado>({
    db,
    organizationId: org,
    chave,
    endpoint: existente ? "mcp:delegacao_enviar" : "mcp:delegacao_iniciar_conversa",
    corpo: {
      ...entrada,
      anexo,
      sujeito: sujeito.userId,
      client_id: sujeito.clientId,
      arquivo: midiaDoBot && {
        nome: midiaDoBot.nome,
        mime: midiaDoBot.mime,
        sha256: hash(midiaDoBot.bytes),
      },
    },
    exigirReserva: true,
    janelaDaReservaMs: TTL_MS,
    executar: async () => {
      const parar = (r: Falha, conversaId?: string) => ({
        resposta: recusar(r, conversaId),
        status: r.status,
      });
      await assertOrgOperante(db, org);
      const { data: canal, error } = await db
        .from("channel_sessions")
        .select(`${CHANNEL_SESSION_REF_COLUMNS},status,metadata,archived_at`)
        .eq("organization_id", org)
        .eq("id", sessao.channel_session_id)
        .maybeSingle();
      if (
        error ||
        !canal ||
        canal.status !== "WORKING" ||
        canal.archived_at ||
        canalDesativado(canal.metadata)
      ) {
        return parar(falha("sessao_indisponivel"));
      }
      if (!(PROVIDERS_DE_TELEFONE as readonly string[]).includes(canal.provider)) {
        return parar(falha("transporte_indisponivel"));
      }
      const transporte = getAdapter(canal.provider);
      const ref = resolveSessionRef(canal as ChannelSessionRef);
      if (!ref || !transporte.isConfigured()) {
        return parar(falha("transporte_indisponivel"));
      }
      const ctx: Contexto = { ...base, transporte, ref, role };
      const alvo = await prepararAlvo(ctx, pedido);
      if ("ok" in alvo) return parar(alvo);

      const midia = anexo
        ? await baixarAnexo(acesso.client as unknown as SupabaseClient, anexo).catch(() =>
            falha("anexo_fora_do_recurso"),
          )
        : midiaDoBot;
      if (midia && "ok" in midia) return parar(midia);

      const ritmo = await depsDoRitmo(db);
      let segurado: Awaited<ReturnType<typeof segurarEnvioPorToken>> = null;
      try {
        segurado = await segurarEnvioPorToken(ritmo, {
          organizationId: org,
          channelSessionId: ctx.sessaoId,
          requestId,
        });
        const retryAfter = await reservarTetosCompartilhados(
          `deleg:env:${hash(sujeito.userId)}`,
          HORA,
          DIA,
        );
        if (retryAfter > 0) espera = falha("teto_envio", 429, retryAfter);
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 429) throw err;
        espera = falha("ritmo_numero", 429, Number(err.details?.retry_after_seconds) || 1);
      }
      // Liberar a reserva é seguro aqui. Nenhuma conversa/mensagem nasceu;
      // a mesma chave poderá ser retomada ao terminar o Retry-After.
      if (espera) throw new Error("envio_adiado");

      const aindaAutorizado = async () => {
        const atual = await carregarAcessoDelegado(sujeito, deps, "enviar");
        if (!atual.ok) return false;
        const prova = existente
          ? await autorizarConversaDelegada(atual.acesso, "enviar", existente)
          : await autorizarSessaoDelegada(atual.acesso, "enviar", ctx.sessaoId, org);
        return (
          prova.ok &&
          prova.sessao.channel_session_id === ctx.sessaoId &&
          prova.sessao.origem === origem &&
          prova.sessao.status === "WORKING" &&
          (await papelAtivo(db, org, sujeito.userId)) !== null
        );
      };
      if (!(await aindaAutorizado())) return parar(falha("autorizacao_alterada"));

      let conversa: Awaited<ReturnType<typeof abrirAlvo>>;
      try {
        conversa = await abrirAlvo(ctx, pedido, alvo);
      } catch {
        return parar(falha("conversa_indisponivel"));
      }
      let path: string | undefined;
      if (midia) {
        path = `${org}/${conversa.id}/${randomUUID()}/${nomeSeguro(midia.nome)}`;
        const { error } = await db.storage.from(BUCKET_OUTBOUND).upload(path, midia.bytes, {
          contentType: midia.mime,
          upsert: false,
        });
        if (error) return parar(falha("upload_indisponivel", 503), conversa.id);
      }

      const messageId = randomUUID();
      const handlerCtx: HandlerCtx = {
        organization_id: org,
        requestId,
        actor: { type: "user", id: sujeito.userId, role: ctx.role },
        internalMessageId: messageId,
        envioDelegado: {
          sessaoId: ctx.sessaoId,
          sessaoRef: ref,
          contatoId: conversa.contatoId,
          destino: alvo.destino,
          destinatario: conversa.destinatario,
          conferirAutorizacao: aindaAutorizado,
        },
      };
      const tipo = midia ? (kindFromMime(midia.mime) ?? "document") : "text";
      let mensagem: Message;
      try {
        mensagem = await sendMessageHandler(db, handlerCtx, {
          conversation_id: conversa.id,
          body: corpo,
          // O formato de áudio do canal não leva legenda. Como documento o
          // mesmo arquivo mantém a legenda que o bot pediu na mesma mensagem.
          type: tipo === "audio" && corpo ? "document" : tipo,
          media_storage_path: path,
          media_mime: midia?.mime,
          media_size_bytes: midia?.bytes.length,
          metadata: { origem: "delegacao_bot", delegacao_origem: origem },
        });
      } catch (err) {
        if (err instanceof ApiError && err.status < 500) {
          // Vetos do handler são anteriores ao insert.
          if (path)
            await db.storage
              .from(BUCKET_OUTBOUND)
              .remove([path])
              .catch(() => undefined);
          if (err instanceof OrgNaoOperanteError) {
            conversaDaRecusa = conversa.id;
            throw err;
          }
          return parar(falha("veto_do_handler", err.status === 422 ? 422 : 404), conversa.id);
        }
        // O transporte pode ter aceitado antes da exceção. Grave desfecho
        // terminal e preserve o id de correlação, sem reexecutar o envio.
        auditar(ctx, "envio_sem_recibo", {
          status: "failed",
          message_id: messageId,
          conversation_id: conversa.id,
          external_id: null,
          sent_at: null,
          deduplicated: false,
        });
        return { resposta: falha("envio_sem_recibo", 503), status: 503 };
      }
      const recibo = reciboDaMensagem(mensagem, conversa.id);
      // Mesmo que o ledger falhe, a mensagem já pode ter saído. O recibo
      // existente continua sendo a resposta canônica à mesma chave.
      await registrarEnvioPorToken(ritmo, org, segurado, mensagem.status).catch(() => {
        logger.warn("delegacao.ritmo_indisponivel", { request_id: requestId });
      });
      auditar(ctx, mensagem.status === "sent" ? "ok" : "falha_de_entrega", recibo);
      return { resposta: { ok: true, dados: recibo }, status: 200 };
    },
  }).catch((err: unknown) => (err instanceof OrgNaoOperanteError ? "org_parada" : null));

  // A suspensão libera a reserva. Depois da reativação a mesma chave pode enviar.
  if (resultado === "org_parada") return recusar(falha("organizacao_indisponivel"), conversaDaRecusa);
  if (!resultado) return recusar(espera ?? falha("envio_indisponivel", 503));
  if (resultado.tipo === "replay") {
    const { resposta } = resultado;
    return resposta.ok ? { ok: true, dados: { ...resposta.dados, deduplicated: true } } : resposta;
  }
  if (resultado.tipo === "executou") return resultado.resposta;
  return recusar(
    falha(resultado.tipo === "conflito" ? "chave_em_conflito" : "envio_em_curso", 409),
  );
}

export async function listarSessoesParaEnvioDelegado(sujeito: SujeitoOAuth, deps: Deps) {
  const auth = await carregarAcessoDelegado(sujeito, deps, "enviar");
  if (!auth.ok) return falha(auth.motivo);
  const { acesso } = auth;
  const sessoes = await listarSessoesDelegadas(acesso.client);
  if (!sessoes) return falha("sessao_nao_autorizada");
  const orgs = new Set(grantsComEfeito(acesso, "enviar").map((g) => g.organization_id));
  return {
    ok: true as const,
    dados: { sessoes: sessoes.filter((s) => orgs.has(s.organization_id)) },
  };
}
