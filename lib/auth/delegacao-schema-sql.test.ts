import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const RAIZ = path.join(__dirname, "..", "..");
const MIGRATION = path.join(
  RAIZ,
  "supabase/migrations/20261108190000_0773_delegacao_visibilidade_corporativa.sql",
);

describe("0773 — contrato SQL (offline, sem aplicar)", () => {
  const sql = fs.readFileSync(MIGRATION, "utf8");
  const baseline = fs.readFileSync(path.join(RAIZ, "supabase/baseline.sql"), "utf8");

  it("cabeçalho -- manifest: e não semeia grant nem session id", () => {
    expect(sql.split("\n")[0]).toMatch(/^-- manifest: /);
    expect(sql).not.toMatch(/insert into public\.delegacao_visibilidade_corporativa/i);
    expect(sql).not.toMatch(/update public\.channel_sessions/i);
  });

  it("RLS explícita, revoke de public/anon, sem SECURITY DEFINER, sem user_metadata", () => {
    expect(sql).toMatch(/alter table public\.delegacao_visibilidade_corporativa enable row level security/);
    expect(sql).toMatch(/revoke all on public\.delegacao_visibilidade_corporativa from public, anon, authenticated/);
    expect(sql).toMatch(/grant select on public\.delegacao_visibilidade_corporativa to authenticated/);
    const codigo = sql
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(codigo).not.toMatch(/security definer/i);
    expect(codigo).not.toMatch(/user_metadata/);
    expect(codigo).not.toMatch(/app_metadata/);
  });

  it("Inbox cookie exige client_id nulo; extra OAuth exige grant vivo + classificação corporativa + is_personal false", () => {
    expect(sql).toMatch(/\(auth\.jwt\(\) ->> 'client_id'\) is null/);
    expect(sql).toMatch(/conversations_select_delegacao_oauth/);
    expect(sql).toMatch(/conversations_select_delegacao_restritiva/);
    expect(sql).toMatch(/classificacao_empresarial = 'corporativa'/);
    expect(sql).toMatch(/ct\.is_personal is false/);
    expect(sql).toMatch(/g\.revoked_at is null/);
    expect(sql).toMatch(/g\.expires_at > now\(\)/);
    expect(sql).toMatch(/as restrictive/);
    expect(sql).toMatch(/messages_select_delegacao_oauth/);
    expect(sql).toMatch(/conversations_agent_insert/);
    expect(sql).toMatch(/oauth_cookie_only/);
    expect(sql).toMatch(/oauth_delegacao_select on public\.contacts/);
    expect(sql).toMatch(/oauth_delegacao_select on public\.channel_sessions/);
  });

  it("apêndice do baseline contém o SQL da migration depois do cabeçalho manifest", () => {
    const corpo = sql
      .split("\n")
      .filter((l) => !l.startsWith("-- manifest:"))
      .join("\n")
      .trim();
    expect(baseline).toContain(corpo);
  });
});
