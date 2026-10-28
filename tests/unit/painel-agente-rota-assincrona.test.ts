import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const afterFns: Array<() => unknown> = [];
vi.mock("@/lib/painel/depois-da-resposta", () => ({
  depoisDaResposta: (fn: () => unknown) => {
    afterFns.push(fn);
  },
}));

const mocks = vi.hoisted(() => ({
  role: vi.fn(),
  support: vi.fn(),
  rate: vi.fn(),
  client: vi.fn(),
  admin: vi.fn(),
  audit: vi.fn(),
  ferramentas: vi.fn(),
  abrir: vi.fn(),
  etapa: vi.fn(),
  fechar: vi.fn(),
  ler: vi.fn(),
  loop: vi.fn(),
  modo: vi.fn(),
  executar: vi.fn(),
}));

vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: mocks.support }));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit: mocks.rate }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/painel/chave", () => ({ ferramentasDoPainelLigadas: mocks.ferramentas }));
vi.mock("@/lib/painel/consulta", async () => {
  const real =
    await vi.importActual<typeof import("@/lib/painel/consulta")>("@/lib/painel/consulta");
  return {
    ...real,
    abrirConsulta: mocks.abrir,
    atualizarEtapa: mocks.etapa,
    fecharConsulta: mocks.fechar,
    lerAndamento: mocks.ler,
  };
});
vi.mock("@/lib/painel/ferramentas/loop", () => ({
  responderComFerramentas: mocks.loop,
  modoDaPergunta: mocks.modo,
}));
vi.mock("@/lib/painel/ferramentas/executar", () => ({ executarFerramenta: mocks.executar }));

import { GET, POST } from "@/app/api/v1/conversations/[id]/painel-agente/route";

const ctx = { params: Promise.resolve({ id: "conversa-1" }) };
const CONSULTA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function reqPost(body: unknown) {
  return new NextRequest("http://localhost/api/v1/conversations/conversa-1/painel-agente", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function reqGet(consultaId: string) {
  return new NextRequest(
    `http://localhost/api/v1/conversations/conversa-1/painel-agente?consulta_id=${consultaId}`,
  );
}

describe("rota do painel — pergunta assíncrona", () => {
  beforeEach(() => {
    afterFns.length = 0;
    vi.clearAllMocks();
    mocks.support.mockResolvedValue(null);
    mocks.role.mockResolvedValue({
      ok: true,
      user: { id: "user-1", idioma: "pt-BR" },
      org: { orgId: "org-1" },
    });
    mocks.rate.mockResolvedValue({ allowed: true });
    mocks.ferramentas.mockReturnValue(true);
    mocks.modo.mockReturnValue("normal");
    mocks.abrir.mockResolvedValue("criada");
    mocks.ler.mockResolvedValue(null);
    mocks.loop.mockResolvedValue({
      texto: "Aluguel 1.200.",
      passos: [],
      propostas: [],
      tokensEntrada: 10,
      tokensSaida: 20,
      custoUsd: 0,
      parouPor: "fim",
      callId: "c1",
      modo: "normal",
    });
    const from = (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        order: () => q,
        limit: () => Promise.resolve({ data: table === "messages" ? [] : null, error: null }),
        maybeSingle: async () => ({
          data:
            table === "conversations"
              ? { id: "conversa-1", contact_id: "contato-1" }
              : table === "contacts"
                ? {
                    name: "Maria",
                    display_name: "Maria",
                    is_anonymized: false,
                    phone_number: "119999",
                  }
                : { settings: { painel_agente: { ferramentas_habilitado: true } } },
          error: null,
        }),
      };
      return q;
    };
    mocks.client.mockResolvedValue({ from });
    mocks.admin.mockReturnValue({ from });
  });

  it("POST da pergunta devolve 202 e agenda o trabalho no after", async () => {
    const r = await POST(
      reqPost({
        acao: "pergunta",
        pergunta: "qual o aluguel?",
        consulta_id: CONSULTA,
      }),
      ctx,
    );
    expect(r.status).toBe(202);
    const corpo = await r.json();
    expect(corpo.data.status).toBe("rodando");
    expect(corpo.data.consulta_id).toBe(CONSULTA);
    expect(corpo.data.resposta).toBeUndefined();
    expect(afterFns).toHaveLength(1);
    expect(mocks.loop).not.toHaveBeenCalled();
    await afterFns[0]?.();
    expect(mocks.loop).toHaveBeenCalledTimes(1);
    expect(mocks.fechar).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: CONSULTA, resposta: "Aluguel 1.200." }),
    );
    expect(mocks.fechar.mock.calls[0]?.[1]).not.toEqual(
      expect.objectContaining({ status: "erro" }),
    );
  });

  it("GET devolve a resposta quando a consulta está pronta", async () => {
    mocks.ler.mockResolvedValue({
      etapa: null,
      status: "pronto",
      resposta: "Aluguel 1.200.",
      propostas: [],
      parou_por: "fim",
      modo: "normal",
      updated_at: "2026-10-28T12:00:00.000Z",
    });
    const r = await GET(reqGet(CONSULTA), ctx);
    expect(r.status).toBe(200);
    expect((await r.json()).data).toEqual(
      expect.objectContaining({
        status: "pronto",
        resposta: "Aluguel 1.200.",
        parou_por: "fim",
      }),
    );
  });

  it("POST com consulta_id existente não roda de novo", async () => {
    mocks.ler.mockResolvedValue({
      etapa: "lendo anexo…",
      status: "rodando",
      resposta: null,
      propostas: [],
      parou_por: null,
      modo: "normal",
      updated_at: "2026-10-28T12:00:00.000Z",
    });
    const r = await POST(
      reqPost({
        acao: "pergunta",
        pergunta: "qual o aluguel?",
        consulta_id: CONSULTA,
      }),
      ctx,
    );
    expect(r.status).toBe(202);
    expect(mocks.abrir).not.toHaveBeenCalled();
    expect(afterFns).toHaveLength(0);
    expect(mocks.loop).not.toHaveBeenCalled();
  });

  it("resumir continua síncrono e não usa after", async () => {
    mocks.executar.mockResolvedValue({ ok: true, texto: "resumo", extra: { callId: "x" } });
    const r = await POST(reqPost({ acao: "resumir" }), ctx);
    expect(r.status).toBe(200);
    expect((await r.json()).data.resposta).toBe("resumo");
    expect(afterFns).toHaveLength(0);
  });

  it("o fonte agenda after e não envia mensagem", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("app/api/v1/conversations/[id]/painel-agente/route.ts", "utf8");
    const afterSrc = readFileSync("lib/painel/depois-da-resposta.ts", "utf8");
    expect(src).toMatch(/depoisDaResposta\(/);
    expect(src).toMatch(/status: 202/);
    expect(src).not.toMatch(/sendMessage|outbound_queue/);
    expect(afterSrc).toMatch(/from "next\/server"/);
    expect(afterSrc).toMatch(/\bafter\(/);
  });
});
