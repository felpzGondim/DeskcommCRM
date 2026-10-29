import { beforeEach, describe, expect, it, vi } from "vitest";

import { EVENTO_RELATORIO_PRELIMINAR } from "@/lib/painel/relatorio-preliminar-fila";
import type { EventRow } from "@/lib/event-log/dispatcher";
import { processarRelatorioPreliminar } from "@/workers/painel-relatorio-preliminar";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONV = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONTATO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const EVENTO = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/logger", () => ({
  logger: { error: mocks.logError, warn: mocks.logWarn, info: vi.fn() },
}));

function evento(parcial: Partial<EventRow> = {}): EventRow {
  return {
    id: EVENTO,
    organization_id: ORG,
    event_type: EVENTO_RELATORIO_PRELIMINAR,
    entity_kind: "conversation",
    entity_id: CONV,
    payload: {
      conversation_id: CONV,
      contact_id: CONTATO,
      user_id: USER,
      request_id: "req-ficticio",
    },
    metadata: {},
    consumed_by: [],
    attempts: 0,
    ...parcial,
  };
}

function adminFalso(emCurso: Array<{ id: string }> = [{ id: EVENTO }]) {
  const updates: Array<Record<string, unknown>> = [];
  return {
    updates,
    from: (tabela: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        in: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () =>
          tabela === "organizations" ? { data: { settings: {} }, error: null } : { data: null, error: null },
        update: (payload: Record<string, unknown>) => {
          updates.push(payload);
          return q;
        },
        then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
          resolve({
            data: tabela === "event_log" ? emCurso.map((e) => ({ ...e, status: "processing", payload: {}, created_at: "t" })) : [],
            error: null,
          }),
      };
      return q;
    },
  };
}

describe("worker do relatório preliminar", () => {
  beforeEach(() => {
    mocks.audit.mockReset();
    mocks.logError.mockReset();
    mocks.logWarn.mockReset();
  });

  it("sucesso grava versão e audita sem dado pessoal", async () => {
    const admin = adminFalso();
    const gerar = vi.fn(async () => ({
      ok: true as const,
      texto: "Maria Silva CPF 529.982.247-25 quer o apto.",
      extra: { versao: 2 },
    }));
    const r = await processarRelatorioPreliminar(evento(), {
      admin: admin as never,
      gerar: gerar as never,
      deposito: { guardar: vi.fn(), ler: vi.fn(async () => ({})) },
    });
    expect(r).toEqual({ consumer_key: "painel-relatorio-preliminar.v1", status: "ok" });
    expect(gerar).toHaveBeenCalledWith(expect.anything(), {}, { eventoId: EVENTO });
    expect(admin.updates[0]).toMatchObject({
      payload: expect.objectContaining({ resultado: { ok: true, versao: 2 } }),
      last_error: null,
    });
    expect(JSON.stringify(admin.updates)).not.toMatch(/Maria|529\.982|apto/);
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toMatch(/Maria|529\.982/);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ sucesso: true, versao: 2, evento_id: EVENTO }),
      }),
    );
  });

  it("falha com motivo fecha o evento e não coloca PII no log", async () => {
    const admin = adminFalso();
    const gerar = vi.fn(async () => ({
      ok: false as const,
      texto: "Não foi possível gerar o relatório preliminar. A resposta da IA veio em formato inválido. Tente de novo.",
      codigo: "invalid_format",
      extra: { motivo: "relatorio_json" },
    }));
    const r = await processarRelatorioPreliminar(evento(), {
      admin: admin as never,
      gerar: gerar as never,
      deposito: { guardar: vi.fn(), ler: vi.fn(async () => ({})) },
    });
    expect(r.status).toBe("ok");
    expect(admin.updates[0]).toMatchObject({
      payload: expect.objectContaining({ resultado: { ok: false, motivo: "relatorio_json" } }),
      last_error: "relatorio_json",
    });
    expect(mocks.logError).toHaveBeenCalledWith(
      "[painel-ficha] falha ao gerar relatório",
      expect.objectContaining({ motivo: "relatorio_json", organizationId: ORG }),
    );
    expect(JSON.stringify(mocks.logError.mock.calls)).not.toMatch(/Maria|529|senha/);
  });

  it("payload incompleto é pulado sem gastar IA", async () => {
    const gerar = vi.fn();
    const r = await processarRelatorioPreliminar(
      evento({ payload: { conversation_id: CONV } }),
      { gerar: gerar as never },
    );
    expect(r).toEqual({
      consumer_key: "painel-relatorio-preliminar.v1",
      status: "skipped",
      detail: "payload_incompleto",
    });
    expect(gerar).not.toHaveBeenCalled();
    expect(mocks.logWarn).toHaveBeenCalledWith(
      "[painel-ficha] evento sem ids",
      expect.objectContaining({ motivo: "payload_incompleto" }),
    );
  });

  it("evento duplicado mais novo é pulado", async () => {
    const admin = adminFalso([{ id: "11111111-1111-1111-1111-111111111111" }]);
    const gerar = vi.fn();
    const r = await processarRelatorioPreliminar(evento(), {
      admin: admin as never,
      gerar: gerar as never,
    });
    expect(r).toEqual({
      consumer_key: "painel-relatorio-preliminar.v1",
      status: "ok",
      detail: "duplicado",
    });
    expect(gerar).not.toHaveBeenCalled();
  });
});
