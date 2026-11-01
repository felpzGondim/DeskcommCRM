import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { ActiveOrg } from "@/lib/auth/types";
import { podeAprovarLocacao } from "@/lib/locacao/api-gate";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function gate(role: ActiveOrg["role"], orgId = ORG_A) {
  return {
    orgId,
    org: { orgId, role, name: "Org" } satisfies Pick<ActiveOrg, "orgId" | "role" | "name">,
  };
}

describe("podeAprovarLocacao", () => {
  it("atendente da organização do processo pode aprovar", () => {
    expect(podeAprovarLocacao(gate("agent"), ORG_A)).toBe(true);
    expect(podeAprovarLocacao(gate("manager"), ORG_A)).toBe(true);
    expect(podeAprovarLocacao(gate("admin"), ORG_A)).toBe(true);
  });

  it("usuário de outra organização é negado", () => {
    expect(podeAprovarLocacao(gate("agent", ORG_B), ORG_A)).toBe(false);
    expect(podeAprovarLocacao(gate("admin", ORG_B), ORG_A)).toBe(false);
  });

  it("papel abaixo de atendente é recusado mesmo na própria org", () => {
    expect(podeAprovarLocacao(gate("viewer"), ORG_A)).toBe(false);
  });

  it("não depende de aprovador_user_ids — lista vazia não impede o atendente", () => {
    const ator = { ...gate("agent"), settings: { locacao: { aprovador_user_ids: [] } } };
    expect(podeAprovarLocacao(ator, ORG_A)).toBe(true);
  });

  it("aprovar e reabrir usam o predicado novo; vínculo e apagar documento ficam no legado", () => {
    const raiz = process.cwd();
    const rota = readFileSync(join(raiz, "app/api/v1/locacao/processos/[id]/route.ts"), "utf8");
    expect(rota).toContain("podeAprovarLocacao");
    expect(rota).not.toContain("podeAprovarProcesso");
    expect(rota).not.toContain("ehAprovador");

    const page = readFileSync(join(raiz, "app/app/locacao/[id]/page.tsx"), "utf8");
    expect(page).toContain("podeAprovarLocacao");
    expect(page).not.toContain("ehAprovador");

    const docs = readFileSync(
      join(raiz, "app/api/v1/locacao/processos/[id]/documentos/route.ts"),
      "utf8",
    );
    const exec = readFileSync(join(raiz, "app/api/v1/locacao/vinculos/execucoes/route.ts"), "utf8");
    const rev = readFileSync(join(raiz, "app/api/v1/locacao/vinculos/revisoes/route.ts"), "utf8");
    expect(docs).toContain("podeAprovarProcesso");
    expect(exec).toContain("podeAprovarProcesso");
    expect(rev).toContain("podeAprovarProcesso");
  });
});
