import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import type * as Canais from "@/lib/channels";
import { criarDubleDoHandler } from "@/tests/helpers/duble-do-handler";

const h = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/channels", async (importOriginal) => ({
  ...(await importOriginal<typeof Canais>()),
  getAdapter: () => ({
    isConfigured: () => true,
    send: h.send,
    codes: { notConfigured: "fixture_sem_transporte", sendFailed: "fixture_falha" },
  }),
}));

const org = randomUUID();
const id = randomUUID();
const uid = randomUUID();
const sessaoId = randomUUID();
const contatoId = randomUUID();
const telefone = "+12025550104";

function preparar(status = "WORKING", autoriza = true) {
  h.send.mockReset().mockResolvedValue({ externalId: "id-ficticio-da-entrega" });
  const db = criarDubleDoHandler({
    conversation: {
      id,
      organization_id: org,
      contact_id: contatoId,
      channel_session_id: sessaoId,
      is_group: false,
      group_chat_id: null,
      contacts: {
        phone_number: telefone,
        wa_identity: null,
        wa_lid: null,
        is_blocked: false,
        is_personal: false,
      },
      channel_sessions: {
        provider: "waha",
        waha_session_name: "sessao-ficticia",
        status,
        archived_at: null,
      },
    },
  });
  const ctx: HandlerCtx = {
    organization_id: org,
    requestId: "req-teste",
    actor: { type: "user", id: uid, role: "manager" },
    envioDelegado: {
      sessaoId,
      sessaoRef: "sessao-ficticia",
      contatoId,
      destino: "destino-confirmado",
      destinatario: {
        isGroup: false,
        groupChatId: null,
        phoneNumber: telefone,
        waIdentity: null,
        waLid: null,
      },
      conferirAutorizacao: async () => autoriza,
    },
  };
  return {
    ...db,
    enviar: () =>
      sendMessageHandler(db.supabase, ctx, {
        conversation_id: id,
        type: "text",
        body: "Mensagem fictícia",
        metadata: { origem: "delegacao_bot", delegacao_origem: "titular" },
      }),
  };
}

describe("envio delegado no handler real do Inbox", () => {
  it("usa o destino confirmado e persiste autoria humana com metadados", async () => {
    const db = preparar();
    expect(await db.enviar()).toMatchObject({
      status: "sent",
      sent_via: "user",
      sent_by_user_id: uid,
    });
    expect(h.send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        to: "destino-confirmado",
        recipientVerified: true,
        body: "Mensagem fictícia",
      }),
    );
    expect(db.capturas.inserts.messages).toEqual([
      expect.objectContaining({
        status: "sending",
        sent_via: "user",
        sent_by_user_id: uid,
        metadata: expect.objectContaining({ origem: "delegacao_bot", delegacao_origem: "titular" }),
      }),
    ]);
  });

  it.each([
    ["STOPPED", true],
    ["WORKING", false],
  ])("recusa antes do insert com sessão %s e autorização %s", async (status, autoriza) => {
    const db = preparar(status, autoriza);
    await expect(db.enviar()).rejects.toMatchObject({ status: 404 });
    expect(db.capturas.inserts.messages).toEqual([]);
    expect(h.send).not.toHaveBeenCalled();
  });
});
