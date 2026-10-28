/**
 * A tag reusa o manifesto que a main já publicou no mesmo SHA, ou cai no
 * build atual. Nenhuma checagem existente some: a trava de procedência, o
 * smoke e o `promover-stable` continuam iguais.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();
const publish = readFileSync(join(RAIZ, ".github/workflows/publish-image.yml"), "utf8");

function job(yml: string, nome: string): string {
  const linhas = yml.split("\n");
  const iJobs = linhas.findIndex((l) => /^jobs:\s*$/.test(l));
  if (iJobs === -1) return "";
  const i = linhas.findIndex((l, n) => n > iJobs && l === `  ${nome}:`);
  if (i === -1) return "";
  const fim = linhas.findIndex((l, n) => n > i && /^ {2}[A-Za-z0-9_-]+:\s*$/.test(l));
  return linhas.slice(i, fim === -1 ? undefined : fim).join("\n");
}

function corpo(nome: string): string {
  const t = job(publish, nome);
  expect(t, `o job \`${nome}\` sumiu de publish-image.yml`).not.toBe("");
  return t
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
}

describe("a tag reusa o SHA que a main publicou", () => {
  it("o instrumento está vivo: enxerga os jobs do retag e do build", () => {
    expect(job(publish, "esperar-sha-da-main")).not.toBe("");
    expect(job(publish, "build-and-push")).toContain("docker/build-push-action");
    expect(job(publish, "a-tag-veio-da-main")).toContain("identical|behind");
  });

  it("main e juntar emitem a tag imutável sha-<commit> (format=long)", () => {
    expect(corpo("build-and-push")).toMatch(/type=sha,format=long/);
    expect(corpo("juntar-manifestos")).toMatch(/type=sha,format=long/);
  });

  it("esperar-sha-da-main NÃO tem if: de job — pulado, o build-and-push some junto", () => {
    const t = job(publish, "esperar-sha-da-main");
    expect(t.split("\n").filter((l) => /^ {4}if:/.test(l))).toEqual([]);
  });

  it("build-and-push depende da trava E da espera — senão publica sem os dois", () => {
    const needs = /needs:\s*\[([^\]]*)\]/.exec(corpo("build-and-push"))?.[1];
    expect(needs?.split(",").map((s) => s.trim()).sort()).toEqual([
      "a-tag-veio-da-main",
      "esperar-sha-da-main",
    ]);
  });

  it("o retag só roda quando reusar=sim; o build atual fica como fallback", () => {
    const t = corpo("build-and-push");
    expect(t).toMatch(/if:\s*needs\.esperar-sha-da-main\.outputs\.reusar == 'sim'/);
    expect(t).toMatch(/if:\s*needs\.esperar-sha-da-main\.outputs\.reusar != 'sim'/);
    expect(t).toContain("imagetools create");
    expect(t).toContain("docker/build-push-action");
    expect(t).toContain(":sha-${SHA}-${ARCH}");
  });

  it("a imagem do app NÃO entra no retag — APP_VERSION tem de ser o número da release", () => {
    // rollbackDesmentidoPeloApp compara APP_VERSION (assado no build) com
    // to_version. A main assa o SHA curto; se a tag retaggeasse o app, um
    // update.sh --force da mesma versão não desmentiria o rollback.
    const t = job(publish, "build-and-push");
    expect(t).toMatch(
      /reusar != 'sim' \|\| matrix\.name == 'deskcommcrm'/,
    );
    expect(t).toMatch(
      /reusar == 'sim' && matrix\.name != 'deskcommcrm'/,
    );
    expect(t).toContain("rollbackDesmentidoPeloApp");
  });

  it("o smoke da tag NÃO espera o retag — promove stable só depois dele", () => {
    expect(corpo("imagem-do-app-sobe")).not.toContain("esperar-sha-da-main");
    expect(corpo("imagens-de-fundo-sobem")).not.toContain("esperar-sha-da-main");
    const needs = /needs:\s*\[([^\]]*)\]/.exec(corpo("promover-stable"))?.[1];
    expect(needs?.split(",").map((s) => s.trim()).sort()).toEqual([
      "build-and-push",
      "imagem-do-app-sobe",
      "imagens-de-fundo-sobem",
      "juntar-manifestos",
    ]);
  });

  it("imagens-ok não passou a aceitar pulo do job novo — a matriz de desfechos não muda", () => {
    const t = corpo("imagens-ok");
    expect(t).not.toContain("esperar-sha-da-main");
    const needs = /needs:\s*\[([^\]]*)\]/.exec(t)?.[1];
    expect(needs?.split(",").map((s) => s.trim()).sort()).toEqual([
      "a-tag-veio-da-main",
      "build-and-push",
      "imagem-do-app-sobe",
      "imagens-de-fundo-sobem",
      "juntar-manifestos",
    ]);
  });

  it("a espera consulta o script, não uma sonda improvisada no YAML", () => {
    expect(corpo("esperar-sha-da-main")).toContain("scripts/retag-se-a-main-publicou.sh");
    expect(corpo("esperar-sha-da-main")).toContain("GITHUB_SHA");
  });
});
