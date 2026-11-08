import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const estado = vi.hoisted(() => ({
  org: "10000000-0000-4000-8000-000000000001",
  conversa: "20000000-0000-4000-8000-000000000001",
  mensagem: "30000000-0000-4000-8000-000000000001",
  processo: "50000000-0000-4000-8000-000000000001",
  locatario: "60000000-0000-4000-8000-000000000001",
  gravacoes: [] as Array<Record<string, unknown>>,
  mensagens: [] as Array<Record<string, unknown>>,
  participantes: [] as Array<Record<string, unknown>>,
  documentos: [] as Array<Record<string, unknown>>,
  ficha: null as { ficha: unknown } | null,
  modelo: vi.fn(async (..._a: unknown[]) => null as string | null),
}));

vi.mock("@/lib/auth/require-role", () => ({
  requireRole: vi.fn(async () => ({ ok: true, org: { orgId: estado.org }, user: { id: "ator" } })),
}));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/api/wrappers", () => ({
  ok: (data: unknown) => Response.json({ data }),
  fail: (code: string, message: string, status: number) => Response.json({ error: { code, message } }, { status }),
}));
vi.mock("@/lib/locacao/ficha-compartilhada", () => ({
  processoAtivoDaConversa: vi.fn(async () => ({ id: estado.processo })),
}));
vi.mock("@/lib/locacao/ficha-repositorio", () => ({
  lerFichaAtual: vi.fn(async () => estado.ficha),
}));
vi.mock("@/lib/locacao/classificar-documento-modelo", () => ({
  TETO_CHAMADAS_POR_LISTA: 3,
  classificarDocumentoComModelo: (entrada: unknown) => estado.modelo(entrada),
}));
vi.mock("@/lib/agent-engine/agent/request-deps", () => ({
  requestTurnDeps: () => ({ llmCfg: {} }),
}));

function query(tabela: string) {
  let rows: Array<Record<string, unknown>> =
    tabela === "conversations" ? [{ id: estado.conversa, organization_id: estado.org, contact_id: "contato-1" }]
    : tabela === "contacts" ? [{ id: "contato-1", organization_id: estado.org, is_personal: false }]
    : tabela === "messages" ? estado.mensagens
    : tabela === "locacao_processo_participantes" ? estado.participantes
    : tabela === "locacao_processo_documentos" ? estado.documentos
    : [];
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (k: string, v: unknown) => { rows = rows.filter((r) => r[k] === v); return q; },
    is: (k: string, v: unknown) => { rows = rows.filter((r) => (r[k] ?? null) === v); return q; },
    in: () => q,
    order: () => q,
    range: () => q,
    limit: () => q,
    filter: () => q,
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
    update: (valores: Record<string, unknown>) => {
      estado.gravacoes.push({ tabela, ...valores });
      if (tabela === "messages" && rows[0]) Object.assign(rows[0], valores);
      return q;
    },
  };
  return q;
}

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: query }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: query }) }));
vi.mock("@/lib/locacao/admin", () => ({ tabelaLocacao: (_a: unknown, tabela: string) => query(tabela) }));

import { GET, PATCH } from "@/app/api/v1/conversations/[id]/locacao/documentos/route";
import { audit } from "@/lib/audit";
import { fichaVazia, pessoaVazia } from "@/lib/locacao/ficha-schema";

function listar() {
  return GET(new Request("https://crm.example/api") as NextRequest, {
    params: Promise.resolve({ id: estado.conversa }),
  });
}

function editar(corpo: Record<string, unknown>) {
  return PATCH(new Request("https://crm.example/api", {
    method: "PATCH",
    body: JSON.stringify(corpo),
  }) as NextRequest, { params: Promise.resolve({ id: estado.conversa }) });
}

describe("GET de documentos classifica e grava sem sobrescrever o manual", () => {
  beforeEach(() => {
    vi.mocked(audit).mockClear();
    estado.gravacoes = [];
    estado.modelo.mockReset().mockResolvedValue(null);
    estado.participantes = [{
      id: estado.locatario, organization_id: estado.org, processo_id: estado.processo,
      papel: "locatario", principal: true, nome_exibicao: "Candidato", cpf_mascarado: null,
      cpf_hash: "hash-loc", removido_em: null,
    }];
    estado.documentos = [];
    estado.ficha = {
      ficha: {
        ...fichaVazia(),
        pessoas: [{
          ...pessoaVazia("inquilino"),
          principal: true,
          cpf: { ...pessoaVazia().cpf, message_id: estado.mensagem },
        }],
      },
    };
    estado.mensagens = [{
      id: estado.mensagem, organization_id: estado.org, conversation_id: estado.conversa,
      type: "document", media_mime: "application/pdf", media_storage_path: estado.org + "/a.pdf",
      media_derived_status: "ready", media_derived_text: "folha",
      metadata: { media_filename: "folha.pdf" }, sent_at: "2026-10-29T12:00:00Z", revoked_at: null,
    }];
  });

  it("grava documento pessoal e o único participante a partir da ficha", async () => {
    const r = await listar();
    expect(r.status).toBe(200);
    const json = await r.json() as { data: { recebidos: Array<Record<string, unknown>> } };
    expect(json.data.recebidos[0]).toMatchObject({
      categoria: "documento_pessoal",
      participante_id: estado.locatario,
      categoria_automatica: true,
      participante_automatico: true,
    });
    expect(estado.gravacoes).toHaveLength(1);
    const meta = estado.gravacoes[0]!.metadata as { locacao_documentos: Record<string, { categoria: string; categoria_origem: string }> };
    expect(meta.locacao_documentos[estado.processo]).toMatchObject({
      categoria: "documento_pessoal",
      categoria_origem: "automatico",
      participante_origem: "automatico",
    });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "locacao.documento_classificado",
      metadata: expect.objectContaining({ origem: "automatico", quantidade: 1 }),
    }));
  });

  it("não sobrescreve escolha manual já gravada", async () => {
    estado.mensagens[0]!.metadata = {
      media_filename: "folha.pdf",
      locacao_documentos: {
        [estado.processo]: {
          categoria: "outro",
          participante_id: null,
          categoria_origem: "manual",
          participante_origem: "manual",
        },
      },
    };
    const r = await listar();
    const json = await r.json() as { data: { recebidos: Array<Record<string, unknown>> } };
    expect(json.data.recebidos[0]).toMatchObject({
      categoria: "outro",
      participante_id: null,
      categoria_automatica: false,
      participante_automatico: false,
    });
    expect(estado.gravacoes).toEqual([]);
    expect(audit).not.toHaveBeenCalled();
  });

  it("reabrir não chama o modelo nem regrava o automático já persistido", async () => {
    estado.ficha = { ficha: fichaVazia() };
    estado.mensagens[0]!.metadata = {
      media_filename: "anexo.pdf",
      locacao_documentos: {
        [estado.processo]: {
          categoria: "comprovante_renda",
          participante_id: estado.locatario,
          categoria_origem: "automatico",
          participante_origem: "automatico",
          tentou_modelo: true,
        },
      },
    };
    estado.mensagens[0]!.media_derived_text = "campos do formulario preenchidos pelo candidato";
    const r = await listar();
    const json = await r.json() as { data: { recebidos: Array<Record<string, unknown>> } };
    expect(estado.modelo).not.toHaveBeenCalled();
    expect(json.data.recebidos[0]).toMatchObject({
      categoria: "comprovante_renda",
      participante_id: estado.locatario,
      categoria_automatica: true,
    });
    expect(estado.gravacoes).toEqual([]);
    expect(audit).not.toHaveBeenCalled();
  });

  it("chama o modelo só no residual e grava o resultado", async () => {
    estado.ficha = { ficha: fichaVazia() };
    estado.mensagens[0]!.metadata = { media_filename: "anexo.pdf" };
    estado.mensagens[0]!.media_derived_text = "campos do formulario preenchidos pelo candidato";
    estado.modelo.mockResolvedValue("comprovante_renda");
    const r = await listar();
    const json = await r.json() as { data: { recebidos: Array<Record<string, unknown>> } };
    expect(estado.modelo).toHaveBeenCalledTimes(1);
    expect(json.data.recebidos[0]).toMatchObject({
      categoria: "comprovante_renda",
      participante_id: estado.locatario,
      categoria_automatica: true,
    });
    expect(estado.gravacoes[0]).toMatchObject({
      metadata: expect.objectContaining({
        locacao_documentos: expect.objectContaining({
          [estado.processo]: expect.objectContaining({ tentou_modelo: true }),
        }),
      }),
    });
  });

  it("PATCH marca só o campo editado como manual", async () => {
    estado.mensagens[0]!.metadata = {
      media_filename: "folha.pdf",
      locacao_documentos: {
        [estado.processo]: {
          categoria: "comprovante_renda",
          participante_id: estado.locatario,
          categoria_origem: "automatico",
          participante_origem: "automatico",
        },
      },
    };
    const r = await editar({
      id: estado.mensagem, origem: "mensagem",
      categoria: "documento_pessoal", participante_id: estado.locatario,
    });
    expect(r.status).toBe(200);
    const meta = estado.gravacoes.at(-1)!.metadata as {
      locacao_documentos: Record<string, { categoria_origem: string; participante_origem: string }>;
    };
    expect(meta.locacao_documentos[estado.processo]).toMatchObject({
      categoria_origem: "manual",
      participante_origem: "automatico",
    });
  });
});
