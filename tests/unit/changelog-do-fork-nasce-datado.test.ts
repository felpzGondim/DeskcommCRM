/**
 * Um PR que vira release deste fork já traz a data no CHANGELOG.
 * `não publicada` era o motivo do PR extra da felpz.9/felpz.10 (~22 min de CI).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();
const changelog = readFileSync(join(RAIZ, "CHANGELOG.md"), "utf8");
const agents = readFileSync(join(RAIZ, "AGENTS.md"), "utf8");
const deployFork = readFileSync(join(RAIZ, "docs/deploy-fork.md"), "utf8");
const lp = readFileSync(join(RAIZ, "tests/unit/release-chega-na-lp.test.ts"), "utf8");

const CABECALHO_FORK_DATADO = /^## \[\d+\.\d+\.\d+-felpz\.\d+\]\s*[—–-]\s*\d{4}-\d{2}-\d{2}\s*$/;

describe("CHANGELOG do fork nasce datado no PR da feature", () => {
  it("nenhuma seção felpz aceita `não publicada`", () => {
    const felpz = changelog.split("\n").filter((l) => /^-{0,0}## \[\d+\.\d+\.\d+-felpz\.\d+\]/.test(l));
    expect(felpz.length, "não achei cabeçalho felpz no CHANGELOG").toBeGreaterThan(0);
    const semData = felpz.filter((l) => !CABECALHO_FORK_DATADO.test(l));
    expect(semData, "cabeçalho felpz sem YYYY-MM-DD — o PR da feature tem de datar").toEqual([]);
    expect(changelog).not.toMatch(/não publicada/);
  });

  it("a cerca da LP também recusa `não publicada` — as duas não podem divergir", () => {
    expect(lp).toContain(String.raw`\d{4}-\d{2}-\d{2}`);
    expect(lp).not.toMatch(/não publicada/);
  });

  it("AGENTS.md e o runbook do fork descrevem o processo (sem PR extra de CHANGELOG)", () => {
    expect(agents).toMatch(/CHANGELOG.*PR da feature|PR da feature.*CHANGELOG/s);
    expect(agents).toMatch(/um PR de banco por vez/i);
    expect(deployFork).toMatch(/PR da feature/);
    expect(deployFork).toMatch(/sem PR extra/);
  });
});
