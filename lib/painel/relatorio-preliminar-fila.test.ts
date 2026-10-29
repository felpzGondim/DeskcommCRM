import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  EVENTO_RELATORIO_PRELIMINAR,
  enfileirarRelatorioPreliminar,
  eventoVencedor,
  lerGeracaoDaFicha,
  resultadoDoPayload,
} from "@/lib/painel/relatorio-preliminar-fila";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONV = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONTATO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

type Linha = {
  id: string;
  organization_id: string;
  event_type: string;
  entity_id: string;
  status: string;
  payload: Record<string, unknown>;
  created_at: string;
};

function adminFalso(estado: { linhas: Linha[]; emit?: () => { data: unknown; error: unknown } }) {
  const rpc = vi.fn(async () => estado.emit?.() ?? { data: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", error: null });
  return {
    rpc,
    from: (tabela: string) => {
      const filtros: Record<string, unknown> = {};
      let statuses: string[] | null = null;
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => {
          filtros[c] = v;
          return q;
        },
        in: (c: string, v: string[]) => {
          if (c === "status") statuses = v;
          return q;
        },
        order: () => q,
        limit: () => q,
        maybeSingle: async () => {
          const rows = filtrar();
          return { data: rows[0] ?? null, error: null };
        },
        then: (resolve: (v: { data: Linha[]; error: null }) => unknown) =>
          resolve({ data: filtrar(), error: null }),
      };
      function filtrar() {
        if (tabela !== "event_log") return [];
        return estado.linhas.filter((l) => {
          if (filtros.organization_id && l.organization_id !== filtros.organization_id) return false;
          if (filtros.event_type && l.event_type !== filtros.event_type) return false;
          if (filtros.entity_id && l.entity_id !== filtros.entity_id) return false;
          if (statuses && !statuses.includes(l.status)) return false;
          return true;
        });
      }
      return q;
    },
  };
}

function linha(parcial: Partial<Linha> = {}): Linha {
  return {
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    organization_id: ORG,
    event_type: EVENTO_RELATORIO_PRELIMINAR,
    entity_id: CONV,
    status: "pending",
    payload: { conversation_id: CONV },
    created_at: "2026-10-29T00:00:00.000Z",
    ...parcial,
  };
}

describe("fila do relatório preliminar", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("enfileira quando não há geração em curso", async () => {
    const admin = adminFalso({ linhas: [] });
    const r = await enfileirarRelatorioPreliminar(admin as never, {
      orgId: ORG,
      conversationId: CONV,
      contactId: CONTATO,
      userId: USER,
      requestId: "req-1",
    });
    expect(r).toEqual({ eventoId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", existente: false });
    expect(admin.rpc).toHaveBeenCalledWith(
      "emit_event",
      expect.objectContaining({
        p_event_type: EVENTO_RELATORIO_PRELIMINAR,
        p_entity_kind: "conversation",
        p_entity_id: CONV,
        p_organization_id: ORG,
        p_payload: expect.objectContaining({
          conversation_id: CONV,
          contact_id: CONTATO,
          user_id: USER,
          request_id: "req-1",
        }),
      }),
    );
    expect(JSON.stringify(admin.rpc.mock.calls)).not.toMatch(/senha|119|Maria|cpf/i);
  });

  it("senha de PDF vai ao depósito, não ao evento", async () => {
    const guardar = vi.fn();
    const admin = adminFalso({ linhas: [] });
    await enfileirarRelatorioPreliminar(admin as never, {
      orgId: ORG,
      conversationId: CONV,
      contactId: CONTATO,
      userId: USER,
      requestId: "req-senha",
      senhas: { "extrato.pdf": "segredo-ficticio" },
      deposito: { guardar, ler: vi.fn(async () => ({})) },
    });
    expect(guardar).toHaveBeenCalledWith(
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      { "extrato.pdf": "segredo-ficticio" },
    );
    expect(JSON.stringify(admin.rpc.mock.calls)).not.toMatch(/segredo-ficticio/);
  });

  it("segundo clique na mesma conversa devolve o evento em curso", async () => {
    const admin = adminFalso({ linhas: [linha()] });
    const r = await enfileirarRelatorioPreliminar(admin as never, {
      orgId: ORG,
      conversationId: CONV,
      contactId: CONTATO,
      userId: USER,
      requestId: "req-2",
    });
    expect(r).toEqual({ eventoId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", existente: true });
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("lê gerando, erro com motivo e ausência de geração", async () => {
    const gerando = await lerGeracaoDaFicha(
      adminFalso({ linhas: [linha({ status: "processing" })] }) as never,
      ORG,
      CONV,
    );
    expect(gerando).toEqual({
      status: "gerando",
      motivo: null,
      eventoId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    });

    const erro = await lerGeracaoDaFicha(
      adminFalso({
        linhas: [
          linha({
            status: "done",
            payload: { resultado: { ok: false, motivo: "relatorio_json" } },
          }),
        ],
      }) as never,
      ORG,
      CONV,
    );
    expect(erro).toEqual({
      status: "erro",
      motivo: "relatorio_json",
      eventoId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    });

    const vazia = await lerGeracaoDaFicha(adminFalso({ linhas: [] }) as never, ORG, CONV);
    expect(vazia).toBeNull();
  });

  it("o evento mais antigo vence a corrida", () => {
    const primeiro = linha({ id: "11111111-1111-1111-1111-111111111111", created_at: "2026-10-29T00:00:00Z" });
    const segundo = linha({ id: "22222222-2222-2222-2222-222222222222", created_at: "2026-10-29T00:00:01Z" });
    expect(eventoVencedor([primeiro, segundo])?.id).toBe(primeiro.id);
  });

  it("resultado do payload ignora lixo e aceita sucesso/falha", () => {
    expect(resultadoDoPayload({})).toBeNull();
    expect(resultadoDoPayload({ resultado: { ok: true, versao: 3 } })).toEqual({ ok: true, versao: 3 });
    expect(resultadoDoPayload({ resultado: { ok: false, motivo: "zod" } })).toEqual({
      ok: false,
      motivo: "zod",
    });
  });
});
