import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { locacaoSettingsSchema } from "@/lib/locacao/chaves";
import { ESTADOS_DA_ANALISE_SEGURO } from "@/lib/locacao/vocabulario";

describe("acesso mínimo da análise (4.0, sem tela)", () => {
  it("o repositório tem as funções da cotação e não menciona Contratar", () => {
    const src = readFileSync(join(process.cwd(), "lib/locacao/repositorio.ts"), "utf8");
    expect(src).toContain("export async function abrirAnaliseSeguro");
    expect(src).toContain("export async function seguroEmAndamento");
    expect(src).toContain("export async function confirmarRendaDoProcesso");
    expect(src).toContain("export async function gravarRascunhoRelatorio");
    expect(src.toLowerCase()).not.toContain("contratar");
  });

  it("a migration 0770 não liga chave nem grava preço", () => {
    const src = readFileSync(
      join(process.cwd(), "supabase/migrations/20261028180000_0770_locacao_analises_fase4.sql"),
      "utf8",
    );
    expect(src).toContain("locacao_analises_seguro");
    expect(src).not.toMatch(/analise.*true/i);
    expect(src).not.toContain("fc_preco");
    expect(src).toContain("trg_locacao_limpar_contato_excluido");
    const i = src.lastIndexOf(
      "create or replace function public.fn_locacao_limpar_contato_anonimizado",
    );
    expect(i).toBeGreaterThan(0);
    const cabeca = src.slice(i, i + 600);
    expect(cabeca).toMatch(/security definer/);
    expect(cabeca).not.toMatch(/security invoker/);
    expect(src).toContain(
      "revoke all on function public.fn_locacao_limpar_contato_anonimizado() from public, anon, authenticated",
    );
  });

  it("o apêndice do baseline instala a mesma DEFINER antes da varredura de anon", () => {
    const baseline = readFileSync(join(process.cwd(), "supabase/baseline.sql"), "utf8");
    const i = baseline.lastIndexOf(
      "create or replace function public.fn_locacao_limpar_contato_anonimizado",
    );
    const varredura = baseline.indexOf("-- ---- VARREDURA anon:");
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(varredura);
    const cabeca = baseline.slice(i, i + 600);
    expect(cabeca).toMatch(/security definer/);
    expect(cabeca).not.toMatch(/security invoker/);
  });

  it("settings recusa preço e aceita as cinco chaves desligadas", () => {
    const lido = locacaoSettingsSchema.parse({ analise: { renda: false, fc_preco: 2530 } });
    expect(lido.analise.renda).toBe(false);
    expect(lido.analise).not.toHaveProperty("fc_preco");
    expect(ESTADOS_DA_ANALISE_SEGURO).toContain("cotando");
  });
});
