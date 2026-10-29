import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  support: vi.fn(),
  gate: vi.fn(),
}));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: mocks.support }));
vi.mock("@/lib/locacao/api-gate", () => ({ gateLocacao: mocks.gate }));

import { POST } from "@/app/api/v1/locacao/vinculos/busca/route";
import {
  definirClienteBuscaSuperlogicaParaTeste,
} from "@/lib/locacao/busca-superlogica";

const req = (body: unknown) =>
  new NextRequest("http://localhost/api/v1/locacao/vinculos/busca", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

describe("POST /api/v1/locacao/vinculos/busca", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    definirClienteBuscaSuperlogicaParaTeste(null);
    mocks.support.mockResolvedValue(null);
    mocks.gate.mockResolvedValue({
      ok: true,
      gate: {
        orgId: "org-1",
        user: { id: "u1" },
        t: (s: string) => s,
        admin: {
          from: () => ({
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: { id: "conv-1", contact_id: "contato-1" } }),
                }),
              }),
            }),
          }),
        },
      },
    });
  });

  it("usa {pesquisa}, mascara o nome e não devolve CPF", async () => {
    const visto: unknown[] = [];
    definirClienteBuscaSuperlogicaParaTeste({
      buscar: async (pedido) => {
        visto.push(pedido);
        return {
          status: "ok",
          encontrado: true,
          haMais: false,
          candidatos: [{
            id: "1001",
            nome: "Maria Souza",
            tipo: "locatário",
            imovel: "Rua Fictícia 1",
            contrato: "9",
          }],
        };
      },
    });
    const r = await POST(req({
      conversation_id: "11111111-1111-4111-8111-111111111111",
      pesquisa: "52998224725",
    }));
    expect(r.status).toBe(200);
    const corpo = await r.json() as { data: { candidatos: Array<{ nome: string }>; encontrado: boolean } };
    expect(visto).toEqual([{ pesquisa: "52998224725" }]);
    expect(corpo.data.encontrado).toBe(true);
    expect(corpo.data.candidatos[0]?.nome).toBe("Ma*** So***");
    expect(JSON.stringify(corpo)).not.toMatch(/52998224725|cpf/i);
  });

  it("sem match devolve nao_encontrado e lista vazia", async () => {
    definirClienteBuscaSuperlogicaParaTeste({
      buscar: async () => ({
        status: "nao_encontrado",
        encontrado: false,
        haMais: false,
        candidatos: [],
      }),
    });
    const r = await POST(req({
      conversation_id: "11111111-1111-4111-8111-111111111111",
      pesquisa: "Ana",
    }));
    expect(r.status).toBe(200);
    const corpo = await r.json() as { data: { status: string; candidatos: unknown[]; encontrado: boolean } };
    expect(corpo.data).toMatchObject({
      status: "nao_encontrado",
      encontrado: false,
      candidatos: [],
    });
  });
});
