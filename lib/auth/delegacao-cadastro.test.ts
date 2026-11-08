import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  revogarVinculoSessaoEmpresarial,
  vincularSessaoContaEmpresarial,
} from "./delegacao-cadastro";

type Linha = Record<string, unknown>;

function mockDb(opts: {
  conta?: Linha | null;
  sessao?: Linha | null;
  insertError?: unknown;
  updateError?: unknown;
}) {
  const chamadas: Array<{ tabela: string; op: string; row?: Linha }> = [];
  return {
    chamadas,
    from(tabela: string) {
      const self: Record<string, unknown> = {};
      const chain = () => self;
      self.select = chain;
      self.eq = chain;
      self.is = chain;
      self.maybeSingle = async () => {
        if (tabela === "delegacao_contas_empresariais") {
          return { data: opts.conta ?? null, error: null };
        }
        if (tabela === "channel_sessions") {
          return { data: opts.sessao ?? null, error: null };
        }
        return { data: { ok: true }, error: opts.updateError ?? null };
      };
      self.insert = async (row: Linha) => {
        chamadas.push({ tabela, op: "insert", row });
        return { error: opts.insertError ?? null };
      };
      self.update = (row: Linha) => {
        chamadas.push({ tabela, op: "update", row });
        return self;
      };
      return self;
    },
  };
}

const ids = {
  organizationId: "aaaaaaaa-0000-4000-8000-000000000001",
  sessionId: "bbbbbbbb-0000-4000-8000-000000000001",
  contaId: "cccccccc-0000-4000-8000-000000000001",
};

describe("vincularSessaoContaEmpresarial", () => {
  it("recusa conta ausente/revogada sem gravar vínculo", async () => {
    const db = mockDb({ conta: null, sessao: { id: ids.sessionId } });
    const r = await vincularSessaoContaEmpresarial(db, ids);
    expect(r).toEqual({ ok: false, motivo: "conta_ausente" });
    expect(db.chamadas.filter((c) => c.op === "insert")).toEqual([]);
  });

  it("recusa sessão de outra org", async () => {
    const db = mockDb({ conta: { id: ids.contaId }, sessao: null });
    const r = await vincularSessaoContaEmpresarial(db, ids);
    expect(r).toEqual({ ok: false, motivo: "sessao_ausente" });
  });

  it("inclusão: insert do vínculo com o conta_id, sem telefone", async () => {
    const db = mockDb({ conta: { id: ids.contaId }, sessao: { id: ids.sessionId } });
    const r = await vincularSessaoContaEmpresarial(db, ids);
    expect(r).toEqual({ ok: true });
    expect(db.chamadas[0]).toMatchObject({
      tabela: "delegacao_sessoes_empresariais",
      op: "insert",
      row: {
        channel_session_id: ids.sessionId,
        organization_id: ids.organizationId,
        conta_empresarial_id: ids.contaId,
        revoked_at: null,
      },
    });
    expect(JSON.stringify(db.chamadas)).not.toMatch(/phone|telefone|e164/i);
  });

  it("substituição: conflito no insert atualiza o mesmo conta_id", async () => {
    const db = mockDb({
      conta: { id: ids.contaId },
      sessao: { id: ids.sessionId },
      insertError: { code: "23505" },
    });
    const r = await vincularSessaoContaEmpresarial(db, ids);
    expect(r).toEqual({ ok: true });
    expect(db.chamadas.some((c) => c.op === "update")).toBe(true);
  });

  it("ids vazios não consultam o banco", async () => {
    const db = mockDb({});
    const r = await vincularSessaoContaEmpresarial(db, {
      organizationId: " ",
      sessionId: ids.sessionId,
      contaId: ids.contaId,
    });
    expect(r).toEqual({ ok: false, motivo: "erro" });
    expect(db.chamadas).toEqual([]);
  });
});

describe("revogarVinculoSessaoEmpresarial", () => {
  it("marca revoked_at; grant individual não é tocado", async () => {
    const db = mockDb({});
    const r = await revogarVinculoSessaoEmpresarial(db, {
      organizationId: ids.organizationId,
      sessionId: ids.sessionId,
    });
    expect(r).toEqual({ ok: true });
    const upd = db.chamadas.find((c) => c.op === "update");
    expect(upd?.tabela).toBe("delegacao_sessoes_empresariais");
    expect(upd?.row).toHaveProperty("revoked_at");
    expect(db.chamadas.some((c) => c.tabela === "delegacao_visibilidade_corporativa")).toBe(
      false,
    );
  });
});

describe("POST de conexão não classifica", () => {
  it("connect-waha e POST /channel-sessions não gravam o vínculo", () => {
    const waha = readFileSync("lib/channels/connect-waha.ts", "utf8");
    const rota = readFileSync("app/api/v1/channel-sessions/route.ts", "utf8");
    expect(waha).not.toMatch(/delegacao_sessoes_empresariais|vincularSessaoContaEmpresarial/);
    expect(rota).not.toMatch(/delegacao_sessoes_empresariais|vincularSessaoContaEmpresarial/);
  });
});
