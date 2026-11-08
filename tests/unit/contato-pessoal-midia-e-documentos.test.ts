/**
 * Spec 21 nas rotas cookie: GET messages/[id]/media e locacao/documentos.
 * Recusa = 404/403, SEM assinar e SEM provedor. Execução do mock, não só grep.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const estado = vi.hoisted(() => ({
  org: "11111111-1111-4111-8111-111111111111",
  orgAtiva: "11111111-1111-4111-8111-111111111111",
  conversa: "aaaaaaaa-1111-4111-8111-111111111111",
  conversaOutra: "aaaaaaaa-9999-4111-8111-111111111111",
  contato: "bbbbbbbb-1111-4111-8111-111111111111",
  mensagem: "cccccccc-1111-4111-8111-111111111111",
  mensagemOutra: "cccccccc-9999-4111-8111-111111111111",
  usuario: { id: "usuario-1" } as { id: string } | null,
  pessoal: true as boolean | "ausente" | "malformado",
  contactId: "bbbbbbbb-1111-4111-8111-111111111111" as string | null,
  conversationIdNaMensagem: "aaaaaaaa-1111-4111-8111-111111111111" as string | null,
  erroConversas: null as { message: string } | null,
  erroContatos: null as { message: string } | null,
  erroMensagens: null as { message: string } | null,
  papelOk: true,
  assinar: vi.fn(async (..._args: unknown[]) => ({
    data: { signedUrl: "https://storage.example/segredo" },
    error: null,
  })),
  fetchInboundMedia: vi.fn(async () => ({ buffer: new ArrayBuffer(8), mime: "image/jpeg" })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: estado.usuario },
        error: estado.usuario ? null : { message: "sem sessão" },
      }),
    },
    from(tabela: string) {
      let rows: Array<Record<string, unknown>> = [];
      if (tabela === "messages") {
        rows = [
          {
            id: estado.mensagem,
            organization_id: estado.org,
            conversation_id: estado.conversationIdNaMensagem,
            media_url: "https://provider.test/a.jpg",
            media_storage_path: estado.org + "/a.jpg",
            media_mime: "image/jpeg",
            media_size_bytes: 8,
            metadata: {},
            channel_session_id: "s",
            revoked_at: null,
            type: "document",
            sent_at: "2026-10-29T12:00:00Z",
          },
          {
            id: estado.mensagemOutra,
            organization_id: estado.org,
            conversation_id: estado.conversaOutra,
            media_storage_path: estado.org + "/outra.jpg",
            media_mime: "image/jpeg",
            revoked_at: null,
            type: "image",
            sent_at: "2026-10-29T12:00:00Z",
            metadata: {},
          },
        ];
      } else if (tabela === "conversations") {
        rows = [
          {
            id: estado.conversa,
            organization_id: estado.org,
            contact_id: estado.contactId,
          },
        ];
      } else if (tabela === "contacts") {
        const marca =
          estado.pessoal === true
            ? true
            : estado.pessoal === false
              ? false
              : estado.pessoal === "malformado"
                ? "sim"
                : undefined;
        const row: Record<string, unknown> = {
          id: estado.contato,
          organization_id: estado.org,
        };
        if (estado.pessoal !== "ausente") row.is_personal = marca;
        rows = [row];
      }
      const q = {
        select: () => q,
        eq(coluna: string, valor: unknown) {
          rows = rows.filter((r) => r[coluna] === valor);
          return q;
        },
        is(coluna: string, valor: unknown) {
          rows = rows.filter((r) => (r[coluna] ?? null) === valor);
          return q;
        },
        in: () => q,
        order: () => q,
        range: () => q,
        limit: () => q,
        filter: () => q,
        update: () => q,
        maybeSingle: async () => {
          if (tabela === "messages" && estado.erroMensagens) {
            return { data: null, error: estado.erroMensagens };
          }
          if (tabela === "conversations" && estado.erroConversas) {
            return { data: null, error: estado.erroConversas };
          }
          if (tabela === "contacts" && estado.erroContatos) {
            return { data: null, error: estado.erroContatos };
          }
          return { data: rows[0] ?? null, error: null };
        },
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(
            tabela === "messages" && estado.erroMensagens
              ? { data: null, error: estado.erroMensagens }
              : { data: rows, error: null },
          ).then(resolve),
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/auth/server", () => ({ loadAuthUser: async () => ({ idioma: "pt-BR" }) }));
vi.mock("@/lib/auth/require-role", () => ({
  orgAtivaDaApi: async () => ({ ok: true, org: { orgId: estado.orgAtiva } }),
  requireRole: vi.fn(async () => {
    if (!estado.papelOk) {
      return {
        ok: false as const,
        response: new Response(JSON.stringify({ error: { code: "forbidden_role" } }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }),
      };
    }
    return {
      ok: true as const,
      org: { orgId: estado.orgAtiva },
      user: { id: "usuario-1" },
    };
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        is: () => q,
        filter: () => q,
        maybeSingle: async () => ({ data: { provider: "waha", id: "s" }, error: null }),
        update: () => q,
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
import { GET as GET_DOCS, PATCH as PATCH_DOCS } from "@/app/api/v1/conversations/[id]/locacao/documentos/route";
import { requireRole } from "@/lib/auth/require-role";

function resetPadrao() {
  estado.orgAtiva = estado.org;
  estado.usuario = { id: "usuario-1" };
  estado.pessoal = true;
  estado.contactId = estado.contato;
  estado.conversationIdNaMensagem = estado.conversa;
  estado.erroConversas = null;
  estado.erroContatos = null;
  estado.erroMensagens = null;
  estado.papelOk = true;
  estado.assinar.mockClear();
  estado.fetchInboundMedia.mockClear();
  vi.mocked(requireRole).mockClear();
}

function pedidoMidia() {
  return GET_MIDIA(
    new Request("http://localhost/api/v1/messages/" + estado.mensagem + "/media") as never,
    { params: Promise.resolve({ id: estado.mensagem }) },
  );
}

function pedidoDocs(busca = "") {
  return GET_DOCS(new Request("https://crm.example/api" + (busca ? "?" + busca : "")) as NextRequest, {
    params: Promise.resolve({ id: estado.conversa }),
  });
}

describe("GET messages/[id]/media — execução", () => {
  beforeEach(resetPadrao);

  it("pessoal 404 sem assinar e sem provedor", async () => {
    const r = await pedidoMidia();
    expect(r.status).toBe(404);
    const corpo = (await r.json()) as { error?: { code?: string }; data?: unknown };
    expect(corpo.error?.code).toBe("not_found");
    expect(JSON.stringify(corpo)).not.toMatch(/storage\.example|provider\.test|segredo/i);
    expect(estado.assinar).not.toHaveBeenCalled();
    expect(estado.fetchInboundMedia).not.toHaveBeenCalled();
  });

  it("operacional assina (regressão da Inbox)", async () => {
    estado.pessoal = false;
    const r = await pedidoMidia();
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe("https://storage.example/segredo");
    expect(estado.assinar).toHaveBeenCalledTimes(1);
  });

  it("org errada 404 sem assinar", async () => {
    estado.pessoal = false;
    estado.orgAtiva = "22222222-2222-4222-8222-222222222222";
    const r = await pedidoMidia();
    expect(r.status).toBe(404);
    expect(estado.assinar).not.toHaveBeenCalled();
    expect(estado.fetchInboundMedia).not.toHaveBeenCalled();
  });

  it("sem conversation_id 404 antes de assinar", async () => {
    estado.pessoal = false;
    estado.conversationIdNaMensagem = null;
    const r = await pedidoMidia();
    expect(r.status).toBe(404);
    expect(estado.assinar).not.toHaveBeenCalled();
    expect(estado.fetchInboundMedia).not.toHaveBeenCalled();
  });

  it("erro no banco da conversa não assina", async () => {
    estado.pessoal = false;
    estado.erroConversas = { message: "db" };
    const r = await pedidoMidia();
    expect(r.status).toBe(404);
    expect(estado.assinar).not.toHaveBeenCalled();
    expect(estado.fetchInboundMedia).not.toHaveBeenCalled();
  });

  it("erro no banco do contato não assina", async () => {
    estado.pessoal = false;
    estado.erroContatos = { message: "db" };
    const r = await pedidoMidia();
    expect(r.status).toBe(404);
    expect(estado.assinar).not.toHaveBeenCalled();
  });

  it("sem vínculo de contato não assina", async () => {
    estado.pessoal = false;
    estado.contactId = null;
    const r = await pedidoMidia();
    expect(r.status).toBe(404);
    expect(estado.assinar).not.toHaveBeenCalled();
  });

  it("is_personal malformado não assina", async () => {
    estado.pessoal = "malformado";
    const r = await pedidoMidia();
    expect(r.status).toBe(404);
    expect(estado.assinar).not.toHaveBeenCalled();
  });

  it("sem sessão 401 sem assinar", async () => {
    estado.usuario = null;
    const r = await pedidoMidia();
    expect(r.status).toBe(401);
    expect(estado.assinar).not.toHaveBeenCalled();
    expect(estado.fetchInboundMedia).not.toHaveBeenCalled();
  });

  it("erro na consulta da mensagem não vira operacional (500, sem assinar)", async () => {
    estado.pessoal = false;
    estado.erroMensagens = { message: "db" };
    const r = await pedidoMidia();
    expect(r.status).toBe(500);
    expect(estado.assinar).not.toHaveBeenCalled();
    expect(estado.fetchInboundMedia).not.toHaveBeenCalled();
  });
});

describe("GET/PATCH locacao/documentos — execução", () => {
  beforeEach(resetPadrao);

  it("lista pessoal 404 sem metadado e sem assinar", async () => {
    const r = await pedidoDocs();
    expect(r.status).toBe(404);
    const corpo = (await r.json()) as { error?: { code?: string }; data?: { recebidos?: unknown } };
    expect(corpo.error?.code).toBe("not_found");
    expect(corpo.data?.recebidos).toBeUndefined();
    expect(estado.assinar).not.toHaveBeenCalled();
    expect(requireRole).toHaveBeenCalled();
  });

  it("download pessoal 404 sem assinar", async () => {
    const r = await pedidoDocs("arquivo=" + estado.mensagem + "&origem=mensagem");
    expect(r.status).toBe(404);
    expect(estado.assinar).not.toHaveBeenCalled();
  });

  it("lista operacional 200 (fluxo válido)", async () => {
    estado.pessoal = false;
    const r = await pedidoDocs();
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { data?: { recebidos?: unknown[] } };
    expect(Array.isArray(corpo.data?.recebidos)).toBe(true);
  });

  it("download operacional assina (fluxo válido)", async () => {
    estado.pessoal = false;
    const r = await pedidoDocs("arquivo=" + estado.mensagem + "&origem=mensagem");
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { data?: { url?: string } };
    expect(corpo.data?.url).toBe("https://storage.example/segredo");
    expect(estado.assinar).toHaveBeenCalledTimes(1);
  });

  it("papel insuficiente 403 sem assinar", async () => {
    estado.pessoal = false;
    estado.papelOk = false;
    const r = await pedidoDocs("arquivo=" + estado.mensagem + "&origem=mensagem");
    expect(r.status).toBe(403);
    expect(estado.assinar).not.toHaveBeenCalled();
  });

  it("org da sessão diferente da conversa 404 sem assinar", async () => {
    estado.pessoal = false;
    estado.orgAtiva = "22222222-2222-4222-8222-222222222222";
    const r = await pedidoDocs("arquivo=" + estado.mensagem + "&origem=mensagem");
    expect(r.status).toBe(404);
    expect(estado.assinar).not.toHaveBeenCalled();
  });

  it("arquivo de outra conversa não assina", async () => {
    estado.pessoal = false;
    const r = await pedidoDocs("arquivo=" + estado.mensagemOutra + "&origem=mensagem");
    expect(r.status).toBe(404);
    expect(estado.assinar).not.toHaveBeenCalled();
  });

  it("erro de prova do contato não assina", async () => {
    estado.pessoal = false;
    estado.erroContatos = { message: "db" };
    const r = await pedidoDocs("arquivo=" + estado.mensagem + "&origem=mensagem");
    expect(r.status).toBe(404);
    expect(estado.assinar).not.toHaveBeenCalled();
  });

  it("PATCH pessoal 404 (mesmo contexto)", async () => {
    const r = await PATCH_DOCS(
      new Request("https://crm.example/api", {
        method: "PATCH",
        body: JSON.stringify({
          id: estado.mensagem,
          origem: "mensagem",
          categoria: "outro",
          participante_id: null,
        }),
      }) as NextRequest,
      { params: Promise.resolve({ id: estado.conversa }) },
    );
    expect(r.status).toBe(404);
    expect(requireRole).toHaveBeenCalled();
  });
});
