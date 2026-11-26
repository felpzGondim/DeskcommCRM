import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/types";
import { env } from "@/lib/env";
import { DEFAULT_CHANNEL_PROVIDER } from "@/lib/channels/capabilities";
import { OrgNaoOperanteError } from "@/lib/organizacao/operante";
import type { SujeitoOAuth } from "./delegacao-oauth-sujeito";
import type { GrantDelegacaoCorporativa, OrigemDelegada } from "./delegacao-superficie";
import { executarEnvioDelegado, listarSessoesParaEnvioDelegado } from "./delegacao-envio";
import {
  delegacaoEnviarSchema,
  delegacaoIniciarConversaSchema,
  LIMITE_ARQUIVO_DELEGADO,
} from "./delegacao-envio-entrada";

const h = vi.hoisted(() => ({
  admin: vi.fn(),
  abrir: vi.fn(),
  auditoria: vi.fn(),
  enviar: vi.fn(),
  teto: vi.fn(),
  existe: vi.fn(),
  configurado: vi.fn(),
  resolverLid: vi.fn(),
  lidRegistrado: vi.fn(),
  ritmo: vi.fn(),
  frear: vi.fn(),
  registrar: vi.fn(),
  info: vi.fn(),
  download: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: h.admin }));
vi.mock("@/lib/audit", () => ({ audit: h.auditoria }));
vi.mock("@/app/api/v1/messages/_handler", () => ({ sendMessageHandler: h.enviar }));
vi.mock("@/lib/messaging/open-shared-contact-conversation", () => ({
  openSharedContactConversation: h.abrir,
}));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ reservarTetosCompartilhados: h.teto }));
vi.mock("@/lib/messaging/ritmo-do-envio-por-token", () => ({
  depsDoRitmo: h.ritmo,
  segurarEnvioPorToken: h.frear,
  registrarEnvioPorToken: h.registrar,
}));
vi.mock("@/lib/channels", () => ({
  CHANNEL_SESSION_REF_COLUMNS: "provider",
  resolveSessionRef: () => "sessao-de-teste",
  getAdapter: () => ({
    isConfigured: h.configurado,
    resolveRegisteredPhone: h.existe,
    resolveRegisteredLid: h.lidRegistrado,
    resolvePhoneForIdentity: h.resolverLid,
    resolveRecipient: ({
      isGroup,
      groupChatId,
      phoneNumber,
      waLid,
    }: {
      isGroup: boolean;
      groupChatId: string;
      phoneNumber: string;
      waLid?: string | null;
    }) => {
      if (isGroup) return groupChatId;
      return waLid ? `${waLid}@lid` : phoneNumber;
    },
  }),
}));

const sujeito: SujeitoOAuth = {
  userId: randomUUID(),
  clientId: randomUUID(),
  accessToken: "jwt-ficticio",
  sessionId: randomUUID(),
  exp: 1800000000,
};
const ORG = randomUUID();
const OUTRA_ORG = randomUUID();
const CONV = randomUUID();
const SESS = randomUUID();
const CONTATO = randomUUID();
const MSG = randomUUID();
const TELEFONE = "+12025550123";
const LID = "lid-sintetico-1";
const HOJE = "2026-11-18T13:00:00Z";
const entrada = { conversation_id: CONV, texto: "Teste fictício" };
const contato = {
  id: CONTATO,
  phone_number: TELEFONE,
  is_personal: false,
  is_blocked: false,
  wa_lid: null,
  wa_identity: null,
};
const conversa = {
  id: CONV,
  organization_id: ORG,
  channel_session_id: SESS,
  contact_id: CONTATO,
  is_group: false,
  group_chat_id: null,
};
const grant = {
  user_id: sujeito.userId,
  oauth_client_id: sujeito.clientId,
  organization_id: ORG,
  expires_at: "2026-11-19T13:00:00Z",
  revoked_at: null,
  efeitos: ["buscar", "ler", "baixar", "enviar"],
};
type Linha = Record<string, unknown>;

function fixture(
  op: {
    origem?: OrigemDelegada | null;
    grants?: readonly GrantDelegacaoCorporativa[];
    convRls?: boolean;
    grupo?: boolean;
    pessoal?: boolean;
    contato?: Linha;
    bloqueado?: boolean;
    canal?: Linha;
    role?: string;
    org?: string;
    organizacao?: { status: string };
  } = {},
) {
  const org = op.org ?? ORG;
  const sessao = {
    channel_session_id: SESS,
    organization_id: org,
    origem: op.origem === undefined ? "empresarial" : op.origem,
    status: "WORKING",
  };
  const conv = {
    ...conversa,
    organization_id: org,
    is_group: !!op.grupo,
    group_chat_id: op.grupo ? "grupo-sintetico" : null,
  };
  const ct = { ...contato, is_personal: !!op.pessoal, is_blocked: !!op.bloqueado, ...op.contato };
  const dbRows: Record<string, Linha> = {
    channel_sessions: { provider: DEFAULT_CHANNEL_PROVIDER, status: "WORKING", archived_at: null, ...op.canal },
    user_organizations: { role: op.role ?? "manager" },
    organizations: op.organizacao ?? { status: "active" },
    contacts: ct,
    conversations: conv,
  };
  const rlsRows = { conversations: conv, contacts: ct };
  const recibos = new Map<string, Linha>();

  function from(tabela: string, rls: boolean) {
    const filtros: Linha = {};
    let apos: string | undefined;
    let update: Linha | undefined;
    function chave(linha: Linha) {
      return JSON.stringify([linha.organization_id, linha.key, linha.endpoint]);
    }
    function resolver(multi = false) {
      if (!rls && tabela === "idempotency_keys") {
        let row = filtros.id
          ? [...recibos.values()].find((r) => r.id === filtros.id)
          : recibos.get(chave(filtros));
        if (row && Object.entries(filtros).some(([k, v]) => row?.[k] !== v)) row = undefined;
        if (row && apos && String(row.expires_at) <= apos) row = undefined;
        if (update && row) Object.assign(row, update);
        return { data: row ?? null, error: null };
      }
      const row = rls ? rlsRows[tabela as keyof typeof rlsRows] : dbRows[tabela];
      if (rls && tabela === "conversations" && op.convRls === false)
        return { data: null, error: null };
      return { data: multi ? (row ? [row] : []) : (row ?? null), error: null };
    }
    const q = {
      select: () => q,
      eq: (k: string, v: unknown) => {
        filtros[k] = v;
        return q;
      },
      is: () => q,
      in: () => q,
      gt: (_k: string, v: string) => {
        apos = v;
        return q;
      },
      insert: async (row: Linha) => {
        const k = chave(row);
        if (recibos.has(k)) return { error: { code: "23505" } };
        recibos.set(k, { id: randomUUID(), ...row });
        return { error: null };
      },
      update: (row: Linha) => {
        update = row;
        return q;
      },
      maybeSingle: async () => resolver(),
      then: (aceitar: (r: unknown) => void) => Promise.resolve(resolver(true)).then(aceitar),
    };
    return q;
  }
  h.admin.mockReturnValue({
    from: (t: string) => from(t, false),
    storage: { from: () => ({ upload: h.upload, remove: h.remove }) },
  });
  const clientDoUsuario = vi.fn(() => ({
    from: (t: string) => from(t, true),
    rpc: vi.fn(async () => ({ data: sessao.origem ? [sessao] : [], error: null })),
    storage: { from: () => ({ info: h.info, download: h.download }) },
  }));
  const deps = {
    agora: new Date(HOJE),
    buscarGrants: vi.fn(async () => [...(op.grants ?? [{ ...grant, organization_id: org }])]),
    clientDoUsuario,
  };
  return {
    deps,
    recibos,
    enviar: (body = entrada, chave = randomUUID()) =>
      executarEnvioDelegado(
        sujeito,
        delegacaoEnviarSchema.parse({ ...body, idempotency_key: chave }),
        deps,
        "request-test",
      ),
    iniciar: (extra = {}) =>
      executarEnvioDelegado(
        sujeito,
        delegacaoIniciarConversaSchema.parse({
          channel_session_id: SESS,
          telefone: TELEFONE,
          texto: entrada.texto,
          idempotency_key: randomUUID(),
          ...extra,
        }),
        deps,
        "request-test",
      ),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  env.DELEGACAO_ENVIO_HABILITADO = true;
  env.DELEGACAO_ENVIO_PREFIXO_NOME = "Teste";
  h.enviar.mockResolvedValue({
    id: MSG,
    status: "sent",
    external_id: "true_endereco_chave",
    sent_at: HOJE,
  });
  h.abrir.mockResolvedValue({ conversation_id: CONV, contact_id: CONTATO });
  h.teto.mockResolvedValue(0);
  h.frear.mockResolvedValue({ channelSessionId: SESS });
  h.registrar.mockResolvedValue(undefined);
  h.existe.mockResolvedValue(TELEFONE.slice(1));
  h.resolverLid.mockResolvedValue(null);
  h.lidRegistrado.mockResolvedValue(null);
  h.configurado.mockReturnValue(true);
  h.upload.mockResolvedValue({ error: null });
  h.remove.mockResolvedValue({ error: null });
});

describe("delegação de envio", () => {
  it.each(["suspended", "redacted", "archived"])("recusa envio com organização %s", async (status) => {
    const organizacao = { status };
    const f = fixture({ organizacao });
    const chave = randomUUID();

    expect(await f.enviar(entrada, chave)).toMatchObject({
      status: 404,
      motivo: "organizacao_indisponivel",
    });
    expect(h.frear).not.toHaveBeenCalled();
    expect(h.abrir).not.toHaveBeenCalled();
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.enviar).not.toHaveBeenCalled();
    expect(h.auditoria).toHaveBeenCalledWith(expect.objectContaining({
      action: "delegacao.envio_recusado",
      metadata: expect.objectContaining({ motivo: "organizacao_indisponivel" }),
    }));

    organizacao.status = "active";
    expect(await f.enviar(entrada, chave)).toMatchObject({ ok: true });
    expect(h.enviar).toHaveBeenCalledOnce();
  });

  it("limpa o upload e libera a mesma chave se a organização parar na entrada do handler", async () => {
    const f = fixture();
    const pedido = delegacaoEnviarSchema.parse({
      ...entrada,
      arquivo: { base64: "dGVzdGU=", nome: "arquivo.pdf", mime: "application/pdf" },
      idempotency_key: randomUUID(),
    });
    h.enviar.mockRejectedValueOnce(new OrgNaoOperanteError(ORG, "suspended"));

    expect(await executarEnvioDelegado(sujeito, pedido, f.deps, "request-test")).toMatchObject({
      status: 404,
      motivo: "organizacao_indisponivel",
    });
    expect(h.upload).toHaveBeenCalledOnce();
    expect(h.remove).toHaveBeenCalledExactlyOnceWith([h.upload.mock.calls[0]?.[0]]);
    expect(h.registrar).not.toHaveBeenCalled();

    expect(await executarEnvioDelegado(sujeito, pedido, f.deps, "request-test")).toMatchObject({ ok: true });
    expect(h.enviar).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["grant ausente", { grants: [] }],
    ["grant de leitura", { grants: [{ ...grant, efeitos: ["ler"] }] }],
    [
      "grant de envio em outra org",
      {
        grants: [
          { ...grant, efeitos: ["ler"] },
          { ...grant, organization_id: OUTRA_ORG },
        ],
      },
    ],
    ["conversa invisível", { convRls: false }],
    ["sessão sem origem", { origem: null }],
    ["contato pessoal", { pessoal: true }],
  ] as const)("recusa %s antes de criar admin", async (_nome, op) => {
    expect(await fixture(op).enviar()).toMatchObject({ ok: false, status: 404 });
    expect(h.admin).not.toHaveBeenCalled();
    expect(h.enviar).not.toHaveBeenCalled();
  });

  it("recusa interruptor desligado antes de consultar o grant", async () => {
    env.DELEGACAO_ENVIO_HABILITADO = false;
    const f = fixture();
    expect(await f.enviar()).toMatchObject({ status: 404, motivo: "envio_desligado" });
    expect(f.deps.buscarGrants).not.toHaveBeenCalled();
    expect(h.admin).not.toHaveBeenCalled();
  });

  it("autoriza pelo JWT antes do admin, relê o papel e envia um recibo opaco", async () => {
    const f = fixture();
    const r = await f.enviar();
    expect(r).toMatchObject({
      ok: true,
      dados: { status: "sent", message_id: MSG, deduplicated: false, conversation_id: CONV },
    });
    expect(JSON.stringify(r)).not.toContain("true_endereco_chave");
    expect(f.deps.clientDoUsuario.mock.invocationCallOrder[0]).toBeLessThan(
      h.admin.mock.invocationCallOrder[0]!,
    );
    expect(h.existe.mock.invocationCallOrder[0]).toBeLessThan(
      h.enviar.mock.invocationCallOrder[0]!,
    );
    expect(h.enviar.mock.calls[0]?.[1]).toMatchObject({
      actor: { type: "user", id: sujeito.userId, role: "manager" },
    });
    expect(h.enviar.mock.calls[0]?.[2]).toMatchObject({
      body: "*Teste*: Teste fictício",
      metadata: { origem: "delegacao_bot", delegacao_origem: "empresarial" },
    });
    expect(h.auditoria).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "delegacao.mensagem_enviada",
        resourceId: CONV,
        metadata: expect.objectContaining({ origem: "empresarial", message_id: MSG }),
      }),
    );
    expect(JSON.stringify(h.auditoria.mock.calls)).not.toMatch(
      /Teste fictício|jwt-ficticio|12025550123|true_endereco_chave/,
    );
  });

  it.each([
    ["titular", "Teste", "Mensagem", "Mensagem"],
    ["empresarial", "", "Mensagem", "Mensagem"],
    ["empresarial", "Teste", "*Teste*: Mensagem", "*Teste*: Mensagem"],
  ] as const)(
    "aplica a regra de prefixo para %s com nome %j",
    async (origem, nome, texto, corpo) => {
      env.DELEGACAO_ENVIO_PREFIXO_NOME = nome;
      await fixture({ origem }).enviar({ ...entrada, texto });
      expect(h.enviar.mock.calls[0]?.[2].body).toBe(corpo);
    },
  );

  it("replay e conflito usam o helper real sem segundo envio, verificação ou quota", async () => {
    const f = fixture();
    const chave = randomUUID();
    await f.enviar(entrada, chave);
    expect(await f.enviar(entrada, chave)).toMatchObject({
      ok: true,
      dados: { deduplicated: true, message_id: MSG },
    });
    expect(await f.enviar({ ...entrada, texto: "Outro" }, chave)).toMatchObject({
      status: 409,
      motivo: "chave_em_conflito",
    });
    expect(h.existe).toHaveBeenCalledTimes(1);
    expect(h.teto).toHaveBeenCalledTimes(1);
    expect(h.enviar).toHaveBeenCalledTimes(1);
  });

  it("a mesma chave simultânea encontra a reserva antes do transporte", async () => {
    const f = fixture();
    const chave = randomUUID();
    const { promise: enviar, resolve: chegouAoHandler } = Promise.withResolvers();
    const { promise: recibo, resolve: finalizar } = Promise.withResolvers();
    h.enviar.mockImplementationOnce(() => {
      chegouAoHandler(undefined);
      return recibo;
    });
    const primeira = f.enviar(entrada, chave);
    await enviar;
    expect(await f.enviar(entrada, chave)).toMatchObject({ status: 409, motivo: "envio_em_curso" });
    finalizar({ id: MSG, status: "sent", external_id: null, sent_at: HOJE });
    expect(await primeira).toMatchObject({ ok: true });
    expect(h.enviar).toHaveBeenCalledTimes(1);
    expect(h.teto).toHaveBeenCalledTimes(1);
  });

  it("guarda falha do handler e não repete se a mesma chave voltar", async () => {
    h.enviar.mockRejectedValueOnce(new Error("resposta do transporte perdeu-se"));
    const f = fixture();
    const chave = randomUUID();
    expect(await f.enviar(entrada, chave)).toMatchObject({ status: 503 });
    expect(await f.enviar(entrada, chave)).toMatchObject({ status: 503 });
    expect(h.enviar).toHaveBeenCalledTimes(1);
    expect(h.auditoria).toHaveBeenCalledTimes(1);
  });

  it("usa o mesmo teto de 20/h e 80/d nas duas organizações", async () => {
    await fixture().enviar();
    await fixture({ org: OUTRA_ORG, origem: "titular" }).enviar();
    expect(h.teto.mock.calls[0]).toEqual([
      expect.stringMatching(/^deleg:env:[a-f0-9]{64}$/),
      { limite: 20, segundos: 3600 },
      { limite: 80, segundos: 86400 },
    ]);
    expect(h.teto.mock.calls[1]).toEqual(h.teto.mock.calls[0]);
  });

  it("reserva só depois da validação do destino e devolve retry_after sem perder a chave", async () => {
    h.teto.mockResolvedValueOnce(17);
    const f = fixture();
    const chave = randomUUID();
    expect(await f.enviar(entrada, chave)).toMatchObject({ status: 429, retry_after: 17 });
    expect(h.enviar).not.toHaveBeenCalled();
    expect(await f.enviar(entrada, chave)).toMatchObject({ ok: true });
  });

  it("mantém o freio do número e falha fechado se a quota distribuída estiver fora", async () => {
    h.frear.mockRejectedValueOnce(
      new ApiError(429, "rate_limited", { retry_after_seconds: 7 }, "request-test"),
    );
    expect(await fixture().enviar()).toMatchObject({ status: 429, retry_after: 7 });
    expect(h.teto).not.toHaveBeenCalled();
    h.teto.mockRejectedValueOnce(new Error("quota indisponível"));
    expect(await fixture().enviar()).toMatchObject({ status: 503 });
    expect(h.enviar).not.toHaveBeenCalled();
  });

  it.each([
    { canal: { status: "STOPPED" } },
    { canal: { archived_at: HOJE } },
    { canal: { metadata: { disabled: true } } },
    { bloqueado: true },
    { role: "viewer" },
  ])("recusa destino indisponível antes do handler (%j)", async (op) => {
    expect(await fixture(op).enviar()).toMatchObject({ status: 404 });
    expect(h.existe).not.toHaveBeenCalled();
    expect(h.enviar).not.toHaveBeenCalled();
  });

  it("check-exists inexistente, exceção e transporte não configurado falham fechado", async () => {
    const f = fixture();
    h.existe.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("timeout"));
    expect(await f.enviar()).toMatchObject({ status: 404 });
    expect(await f.enviar()).toMatchObject({ status: 404 });
    h.configurado.mockReturnValue(false);
    expect(await f.enviar()).toMatchObject({ status: 404, motivo: "transporte_indisponivel" });
    expect(h.enviar).not.toHaveBeenCalled();
    expect(h.teto).not.toHaveBeenCalled();
  });

  it("confirma um LID traduzido mesmo sem telefone cadastrado", async () => {
    h.resolverLid.mockResolvedValue(TELEFONE);
    const f = fixture({ contato: { wa_lid: LID, phone_number: null } });
    expect(await f.enviar()).toMatchObject({ ok: true });
    expect(h.existe).toHaveBeenCalledWith(expect.objectContaining({ phone: TELEFONE }));
  });

  it.each([
    { traduzido: null, registrado: TELEFONE.slice(1), lidRegistrado: null, destino: TELEFONE },
    { traduzido: TELEFONE, registrado: TELEFONE.slice(1), lidRegistrado: null, destino: `${LID}@lid` },
    { traduzido: null, registrado: null, lidRegistrado: LID, destino: `${LID}@lid` },
    { traduzido: null, registrado: TELEFONE.slice(1), lidRegistrado: LID, destino: `${LID}@lid` },
  ])("envia ao destino confirmado (%j)", async ({ traduzido, registrado, lidRegistrado, destino }) => {
    h.resolverLid.mockResolvedValue(traduzido);
    h.existe.mockResolvedValue(registrado);
    h.lidRegistrado.mockResolvedValue(lidRegistrado);
    const f = fixture({ contato: { wa_lid: LID, wa_identity: `lid:${LID}` } });

    expect(await f.enviar()).toMatchObject({ ok: true });
    expect(h.existe).toHaveBeenCalledWith(expect.objectContaining({ phone: TELEFONE }));
    expect(h.enviar.mock.calls[0]?.[1]).toMatchObject({
      envioDelegado: {
        destino,
        destinatario: { waLid: LID, waIdentity: `lid:${LID}`, phoneNumber: TELEFONE },
      },
    });
  });

  it.each([
    { traduzido: "+12025550133", registrado: TELEFONE.slice(1), lidRegistrado: null },
    { traduzido: null, registrado: null, lidRegistrado: "lid-sintetico-2" },
    { traduzido: null, registrado: TELEFONE.slice(1), lidRegistrado: "lid-sintetico-2" },
  ])("recusa identidade divergente antes do handler (%j)", async ({ traduzido, registrado, lidRegistrado }) => {
    h.resolverLid.mockResolvedValue(traduzido);
    h.existe.mockResolvedValue(registrado);
    h.lidRegistrado.mockResolvedValue(lidRegistrado);

    expect(await fixture({ contato: { wa_lid: LID } }).enviar()).toMatchObject({
      status: 404,
      motivo: "numero_nao_confirmado",
    });
    expect(h.enviar).not.toHaveBeenCalled();
  });

  it("grupo pula check-exists", async () => {
    expect(await fixture({ grupo: true }).enviar()).toMatchObject({ ok: true });
    expect(h.existe).not.toHaveBeenCalled();
    expect(h.enviar.mock.calls[0]?.[1]).toMatchObject({
      envioDelegado: { destino: "grupo-sintetico" },
    });
  });

  it("nova conversa exige sessão autorizada e número confirmado antes de criar", async () => {
    expect(await fixture({ origem: null }).iniciar()).toMatchObject({ status: 404 });
    expect(h.admin).not.toHaveBeenCalled();
    h.existe.mockResolvedValueOnce(null);
    expect(await fixture({ origem: "titular" }).iniciar()).toMatchObject({ status: 404 });
    expect(h.abrir).not.toHaveBeenCalled();
    expect(await fixture({ origem: "titular" }).iniciar()).toMatchObject({
      ok: true,
      dados: { conversation_id: CONV },
    });
    expect(h.abrir.mock.invocationCallOrder[0]).toBeGreaterThan(
      h.existe.mock.invocationCallOrder[1]!,
    );
    expect(h.enviar.mock.calls[0]?.[2]).toMatchObject({
      body: entrada.texto,
      metadata: { delegacao_origem: "titular" },
    });
  });

  it("nova conversa recusa contato pessoal ou bloqueado existente antes de abrir", async () => {
    expect(await fixture({ bloqueado: true }).iniciar()).toMatchObject({ status: 404 });
    expect(await fixture({ pessoal: true }).iniciar()).toMatchObject({ status: 404 });
    expect(h.abrir).not.toHaveBeenCalled();
  });

  it("lista sessão com efeito enviar e omite dados de contato", async () => {
    const { deps } = fixture({ origem: "titular" });
    expect(await listarSessoesParaEnvioDelegado(sujeito, deps)).toEqual({
      ok: true,
      dados: {
        sessoes: [
          { channel_session_id: SESS, organization_id: ORG, origem: "titular", status: "WORKING" },
        ],
      },
    });
    expect(h.admin).not.toHaveBeenCalled();
  });

  it("upload usa o caminho da Inbox, nome sanitizado, legenda e identidade por hash", async () => {
    const f = fixture();
    const chave = randomUUID();
    const d = {
      ...entrada,
      legenda: "Anexo",
      arquivo: { base64: "dGVzdGU=", nome: "../x?.pdf", mime: "application/pdf" },
      idempotency_key: chave,
    };
    expect(
      await executarEnvioDelegado(sujeito, delegacaoEnviarSchema.parse(d), f.deps, "request-test"),
    ).toMatchObject({ ok: true });
    expect(h.upload).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(`^${ORG}/${CONV}/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}/_x_\\.pdf$`),
      ),
      Buffer.from("teste"),
      { contentType: "application/pdf", upsert: false },
    );
    expect(h.enviar.mock.calls[0]?.[2]).toMatchObject({
      type: "document",
      body: "*Teste*: Anexo",
      media_size_bytes: 5,
    });
    expect(JSON.stringify([...f.recibos.values()])).not.toContain("dGVzdGU=");
    const diferente = { ...d, arquivo: { ...d.arquivo, base64: "cGRm" } };
    expect(
      await executarEnvioDelegado(
        sujeito,
        delegacaoEnviarSchema.parse(diferente),
        f.deps,
        "request-test",
      ),
    ).toMatchObject({ status: 409 });
    expect(h.upload).toHaveBeenCalledTimes(1);
  });

  it("recusa MIME proibido, base64 inválido e tamanho acima de 16 MiB", () => {
    const d = { ...entrada, idempotency_key: randomUUID() };
    const arquivo = { nome: "arquivo.pdf", base64: "dGVzdGU=", mime: "application/pdf" };
    for (const invalid of [
      { ...arquivo, mime: "application/zip" },
      { ...arquivo, base64: "////=+++" },
      { ...arquivo, base64: Buffer.alloc(LIMITE_ARQUIVO_DELEGADO + 1).toString("base64") },
    ])
      expect(delegacaoEnviarSchema.safeParse({ ...d, arquivo: invalid }).success).toBe(false);
    expect(h.admin).not.toHaveBeenCalled();
  });

  it("encaminha anexo visível por RLS como mídia da conversa de saída", async () => {
    const bytes = Buffer.from("anexo sintético");
    h.info.mockResolvedValue({ data: { size: bytes.length, contentType: "image/png" } });
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(bytes);
        c.close();
      },
    });
    h.download.mockReturnValue({ asStream: async () => ({ data: stream, error: null }) });
    const f = fixture({
      grants: [grant, { ...grant, organization_id: OUTRA_ORG, efeitos: ["baixar"] }],
    });
    const anexo = { bucket: "whatsapp-media", path: `${OUTRA_ORG}/prova.png` };
    const d = delegacaoEnviarSchema.parse({
      conversation_id: CONV,
      anexo,
      idempotency_key: randomUUID(),
    });
    expect(await executarEnvioDelegado(sujeito, d, f.deps, "request-test")).toMatchObject({
      ok: true,
    });
    expect(h.download).toHaveBeenCalledWith(anexo.path);
    expect(h.upload.mock.calls[0]?.[0]).toMatch(new RegExp(`^${ORG}/${CONV}/`));
    expect(h.upload.mock.calls[0]?.[1]).toEqual(bytes);
    expect(h.enviar.mock.calls[0]?.[2]).toMatchObject({ body: undefined, type: "image" });
  });

  it("anexo invisível em Storage é recusado com o JWT e nunca lido pelo admin", async () => {
    h.info.mockResolvedValue({ data: null, error: "fora_da_rls" });
    const f = fixture();
    const d = delegacaoEnviarSchema.parse({
      conversation_id: CONV,
      anexo: { bucket: "locacao-processos", path: `${ORG}/arquivo.pdf` },
      idempotency_key: randomUUID(),
    });
    expect(await executarEnvioDelegado(sujeito, d, f.deps, "request-test")).toMatchObject({
      status: 404,
      motivo: "anexo_fora_do_recurso",
    });
    expect(h.info).toHaveBeenCalledWith(`${ORG}/arquivo.pdf`);
    expect(h.download).not.toHaveBeenCalled();
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.enviar).not.toHaveBeenCalled();
  });
});
