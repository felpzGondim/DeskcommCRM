import {beforeEach, describe, expect, it, vi} from "vitest";
import type {NextRequest} from "next/server";

const estado = vi.hoisted(() => ({
  org: "10000000-0000-4000-8000-000000000001",
  conversa: "20000000-0000-4000-8000-000000000001",
  mensagem: "30000000-0000-4000-8000-000000000001",
  processo: null as {id: string} | null,
  assinar: vi.fn(),
  linhas: [] as Array<Record<string, unknown>>,
}));
vi.mock("@/lib/auth/require-role", () => ({requireRole: vi.fn(async () => ({ok: true, org: {orgId: estado.org}, user: {id: "ator"}}))}));
vi.mock("@/lib/impersonate/support", () => ({requireSupportWrite: vi.fn(async () => null)}));
vi.mock("@/lib/audit", () => ({audit: vi.fn()}));
vi.mock("@/lib/api/wrappers", () => ({
  ok: (data: unknown) => Response.json({data}),
  fail: (code: string, message: string, status: number) => Response.json({error: {code, message}}, {status}),
}));
function query(tabela: string) {
  let rows: Array<Record<string, unknown>> = tabela === "conversations" ? [{id: estado.conversa, organization_id: estado.org}] : estado.linhas;
  const q = {
    select: () => q,
    eq: (k: string, v: unknown) => {rows = rows.filter((r) => r[k] === v); return q;},
    is: (k: string, v: unknown) => {rows = rows.filter((r) => (r[k] ?? null) === v); return q;},
    in: () => q, order: () => q, range: () => q,
    maybeSingle: async () => ({data: rows[0] ?? null, error: null}),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({data: rows, error: null}).then(resolve),
  };
  return q;
}
vi.mock("@/lib/supabase/server", () => ({createClient: async () => ({from: query})}));
vi.mock("@/lib/supabase/admin", () => ({createAdminClient: () => ({
  from: query,
  storage: {from: (bucket: string) => ({
    createSignedUrl: (path: string, ttl: number, opts?: unknown) => estado.assinar(bucket, path, ttl, opts),
  })},
})}));
vi.mock("@/lib/locacao/admin", () => ({tabelaLocacao: (_a: unknown, tabela: string) => query(tabela)}));
vi.mock("@/lib/locacao/ficha-compartilhada", () => ({processoAtivoDaConversa: vi.fn(async () => estado.processo)}));
vi.mock("@/lib/locacao/ficha-repositorio", () => ({lerFichaAtual: vi.fn(async () => null)}));

import {GET} from "@/app/api/v1/conversations/[id]/locacao/documentos/route";

function pedido(busca: string) {
  return GET(new Request("https://crm.example/api?" + busca) as NextRequest,
    {params: Promise.resolve({id: estado.conversa})});
}

describe("documentos no modal: autorização antes da URL privada", () => {
  beforeEach(() => {
    estado.processo = null;
    estado.assinar.mockReset().mockResolvedValue({data: {signedUrl: "https://storage.example/temporario"}, error: null});
    estado.linhas = [{id: estado.mensagem, organization_id: estado.org, conversation_id: estado.conversa,
      media_storage_path: estado.org + "/arquivo.pdf", revoked_at: null, type: "document", metadata: {}, sent_at: "2026-10-29T12:00:00Z"}];
  });
  it("assina por cinco minutos apenas o arquivo da organização e conversa", async () => {
    expect((await pedido("arquivo=" + estado.mensagem + "&origem=mensagem")).status).toBe(200);
    expect(estado.assinar).toHaveBeenCalledWith("whatsapp-media", estado.org + "/arquivo.pdf", 300, {download: false});
  });
  it("redireciona para a URL assinada no clique de Abrir", async () => {
    const r = await pedido("arquivo=" + estado.mensagem + "&origem=mensagem&redirect=1");
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe("https://storage.example/temporario");
    expect(estado.assinar).toHaveBeenCalledWith("whatsapp-media", estado.org + "/arquivo.pdf", 300, {download: false});
  });
  it("marca download na URL assinada sem mudar o isolamento", async () => {
    const r = await pedido("arquivo=" + estado.mensagem + "&origem=mensagem&redirect=1&download=1");
    expect(r.status).toBe(302);
    expect(estado.assinar).toHaveBeenCalledWith("whatsapp-media", estado.org + "/arquivo.pdf", 300, {download: true});
  });
  it("não assina arquivo de outra organização", async () => {
    estado.linhas[0]!.organization_id = "outra";
    expect((await pedido("arquivo=" + estado.mensagem + "&origem=mensagem")).status).toBe(404);
    expect(estado.assinar).not.toHaveBeenCalled();
  });
  it("não assina arquivo de outra conversa da mesma organização", async () => {
    estado.linhas[0]!.conversation_id = "outra";
    expect((await pedido("arquivo=" + estado.mensagem + "&origem=mensagem")).status).toBe(404);
    expect(estado.assinar).not.toHaveBeenCalled();
  });
  it("não assina arquivo revogado nem caminho de outro tenant", async () => {
    estado.linhas[0]!.revoked_at = "2026-10-29T12:00:00Z";
    expect((await pedido("arquivo=" + estado.mensagem + "&origem=mensagem")).status).toBe(404);
    estado.linhas[0]!.revoked_at = null; estado.linhas[0]!.media_storage_path = "outra/arquivo.pdf";
    expect((await pedido("arquivo=" + estado.mensagem + "&origem=mensagem")).status).toBe(404);
    expect(estado.assinar).not.toHaveBeenCalled();
  });
  it("não assina documento de processo de outra organização", async () => {
    const arquivo = "40000000-0000-4000-8000-000000000001";
    const processo = "50000000-0000-4000-8000-000000000001";
    estado.processo = {id: processo};
    estado.linhas = [{
      id: arquivo, organization_id: "outra", processo_id: processo,
      storage_path: "outra/processos/" + processo + "/laudo_fc/" + arquivo + ".pdf",
      removido_em: null,
    }];
    expect((await pedido("arquivo=" + arquivo + "&origem=processo")).status).toBe(404);
    expect(estado.assinar).not.toHaveBeenCalled();
  });
  it("assina documento do processo só na organização e no processo ativos", async () => {
    const arquivo = "40000000-0000-4000-8000-000000000001";
    const processo = "50000000-0000-4000-8000-000000000001";
    const path = estado.org + "/processos/" + processo + "/laudo_fc/" + arquivo + ".pdf";
    estado.processo = {id: processo};
    estado.linhas = [{
      id: arquivo, organization_id: estado.org, processo_id: processo,
      storage_path: path, removido_em: null,
    }];
    expect((await pedido("arquivo=" + arquivo + "&origem=processo&redirect=1")).status).toBe(302);
    expect(estado.assinar).toHaveBeenCalledWith("locacao-processos", path, 300, {download: false});
  });
});
