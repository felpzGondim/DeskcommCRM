/**
 * Spec 21 nas rotas que ainda deixavam mídia e documentos de pessoal
 * alcançáveis pelo UUID: GET messages/[id]/media e locacao/documentos.
 *
 * Recusa = 404 mudo, SEM assinar URL e SEM ir ao provedor. A Inbox comum não
 * exige sessão corporativa — isso é só o caminho delegado, desligado.
 */
import fs from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const RAIZ = process.cwd();
const fonte = (...partes: string[]) => fs.readFileSync(path.join(RAIZ, ...partes), "utf8");

const estado = vi.hoisted(() => ({
  org: "11111111-1111-4111-8111-111111111111",
  conversa: "aaaaaaaa-1111-4111-8111-111111111111",
  contato: "bbbbbbbb-1111-4111-8111-111111111111",
  mensagem: "cccccccc-1111-4111-8111-111111111111",
  pessoal: true,
  assinar: vi.fn(async (..._args: unknown[]) => ({
    data: { signedUrl: "https://storage.example/segredo" },
    error: null,
  })),
  fetchInboundMedia: vi.fn(async () => ({ buffer: new ArrayBuffer(8), mime: "image/jpeg" })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "usuario-1" } }, error: null }) },
    from(tabela: string) {
      let rows: Array<Record<string, unknown>> =
        tabela === "messages"
          ? [
              {
                id: estado.mensagem,
                organization_id: estado.org,
                conversation_id: estado.conversa,
                media_url: "https://provider.test/a.jpg",
                media_storage_path: estado.org + "/a.jpg",
                media_mime: "image/jpeg",
                media_size_bytes: 8,
                metadata: {},
                channel_session_id: "s",
              },
            ]
          : tabela === "conversations"
            ? [
                {
                  id: estado.conversa,
                  organization_id: estado.org,
                  contact_id: estado.contato,
                },
              ]
            : tabela === "contacts"
              ? [
                  {
                    id: estado.contato,
                    organization_id: estado.org,
                    is_personal: estado.pessoal,
                  },
                ]
              : [];
      const q = {
        select: () => q,
        eq(coluna: string, valor: unknown) {
          rows = rows.filter((r) => r[coluna] === valor);
          return q;
        },
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/auth/server", () => ({ loadAuthUser: async () => ({ idioma: "pt-BR" }) }));
vi.mock("@/lib/auth/require-role", () => ({
  orgAtivaDaApi: async () => ({ ok: true, org: { orgId: estado.org } }),
  requireRole: vi.fn(async () => ({
    ok: true,
    org: { orgId: estado.org },
    user: { id: "usuario-1" },
  })),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: { provider: "waha", id: "s" }, error: null }),
      };
      return q;
    },
    storage: {
      from: () => ({
        createSignedUrl: (...args: unknown[]) => estado.assinar(...args),
        download: async () => ({ data: new Blob([new Uint8Array(8)]), error: null }),
      }),
    },
  }),
}));
vi.mock("@/lib/channels", () => ({
  CHANNEL_SESSION_REF_COLUMNS: "id",
  DEFAULT_CHANNEL_PROVIDER: "waha",
  getAdapter: () => ({ fetchInboundMedia: estado.fetchInboundMedia }),
  resolveSessionRef: () => ({ session: "s" }),
}));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/locacao/ficha-compartilhada", () => ({
  processoAtivoDaConversa: vi.fn(async () => null),
}));
vi.mock("@/lib/locacao/ficha-repositorio", () => ({ lerFichaAtual: vi.fn(async () => null) }));
vi.mock("@/lib/locacao/admin", () => ({
  tabelaLocacao: () => ({
    select: () => ({
      eq: () => ({ eq: () => ({ is: () => ({ order: () => ({ data: [], error: null }) }) }) }),
    }),
  }),
}));
vi.mock("@/lib/locacao/classificar-documento-modelo", () => ({
  TETO_CHAMADAS_POR_LISTA: 3,
  classificarDocumentoComModelo: vi.fn(async () => null),
}));
vi.mock("@/lib/agent-engine/agent/request-deps", () => ({
  requestTurnDeps: () => ({ llmCfg: {} }),
}));

import { GET as GET_MIDIA } from "@/app/api/v1/messages/[id]/media/route";
import { GET as GET_DOCS } from "@/app/api/v1/conversations/[id]/locacao/documentos/route";
import { requireRole } from "@/lib/auth/require-role";

describe("fonte: mídia e documentos recusam pessoal antes de assinar", () => {
  it("a rota de mídia pede conversation_id e chama a exclusão", () => {
    const src = fonte("app", "api", "v1", "messages", "[id]", "media", "route.ts");
    expect(src).toMatch(/conversation_id/);
    expect(src).toMatch(/conversaTemContatoPessoal/);
    expect(src).toMatch(/getUser\(\)/);
  });

  it("documentos mantém requireRole(agent, locacao) e recusa pessoal", () => {
    const src = fonte("app", "api", "v1", "conversations", "[id]", "locacao", "documentos", "route.ts");
    expect(src).toMatch(/requireRole\("agent"/);
    expect(src).toMatch(/resource:\s*"locacao"/);
    expect(src).toMatch(/conversaTemContatoPessoal/);
  });
});

describe("GET messages/[id]/media recusa contato pessoal", () => {
  beforeEach(() => {
    estado.pessoal = true;
    estado.assinar.mockClear();
    estado.fetchInboundMedia.mockClear();
  });

  it("404 sem assinar e sem provedor", async () => {
    const r = await GET_MIDIA(
      new Request("http://localhost/api/v1/messages/" + estado.mensagem + "/media") as never,
      { params: Promise.resolve({ id: estado.mensagem }) },
    );
    expect(r.status).toBe(404);
    const corpo = (await r.json()) as { error?: { code?: string; message?: string }; data?: unknown };
    expect(corpo.error?.code).toBe("not_found");
    expect(JSON.stringify(corpo)).not.toMatch(/storage\.example|provider\.test|segredo/i);
    expect(estado.assinar).not.toHaveBeenCalled();
    expect(estado.fetchInboundMedia).not.toHaveBeenCalled();
  });

  it("contato operacional ainda assina (regressão da Inbox)", async () => {
    estado.pessoal = false;
    const r = await GET_MIDIA(
      new Request("http://localhost/api/v1/messages/" + estado.mensagem + "/media") as never,
      { params: Promise.resolve({ id: estado.mensagem }) },
    );
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe("https://storage.example/segredo");
    expect(estado.assinar).toHaveBeenCalledTimes(1);
  });
});

describe("GET locacao/documentos recusa contato pessoal", () => {
  beforeEach(() => {
    estado.pessoal = true;
    estado.assinar.mockClear();
    vi.mocked(requireRole).mockClear();
  });

  it("lista 404 sem metadado e sem assinar", async () => {
    const r = await GET_DOCS(new Request("https://crm.example/api") as NextRequest, {
      params: Promise.resolve({ id: estado.conversa }),
    });
    expect(r.status).toBe(404);
    const corpo = (await r.json()) as { error?: { code?: string }; data?: { recebidos?: unknown } };
    expect(corpo.error?.code).toBe("not_found");
    expect(corpo.data?.recebidos).toBeUndefined();
    expect(estado.assinar).not.toHaveBeenCalled();
    expect(requireRole).toHaveBeenCalled();
  });

  it("download 404 sem assinar", async () => {
    const r = await GET_DOCS(
      new Request(
        "https://crm.example/api?arquivo=" + estado.mensagem + "&origem=mensagem",
      ) as NextRequest,
      { params: Promise.resolve({ id: estado.conversa }) },
    );
    expect(r.status).toBe(404);
    expect(estado.assinar).not.toHaveBeenCalled();
  });
});
