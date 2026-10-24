import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/publish-image.yml", "utf8");
const job = workflow
  .split("\n  publicar-release-do-fork:\n")[1]
  ?.split("\n  # As imagens de FUNDO")[0];

function executar(tag: string, existente = false, falhar = false) {
  if (!job) throw new Error("Job de publicação do fork ausente");
  const bloco = job.split("        run: |\n")[1];
  if (!bloco) throw new Error("Script da publicação ausente");
  const script = bloco
    .split("\n")
    .map((linha) => linha.replace(/^ {10}/, ""))
    .join("\n");
  const dir = mkdtempSync(join(tmpdir(), "release-fork-"));
  const chamadas = join(dir, "chamadas");
  try {
    writeFileSync(
      join(dir, "gh"),
      `#!/usr/bin/env bash
set -euo pipefail
if [ "$1 $2" = "release view" ]; then
  [ "$EXISTENTE" = 1 ]; exit $?
fi
printf '%s\\n' "$@" > "$CHAMADAS"
[ "$FALHAR" = 0 ]
`,
      { mode: 0o755 },
    );
    const r = spawnSync("bash", ["-c", script], {
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        TAG: tag,
        EXISTENTE: existente ? "1" : "0",
        FALHAR: falhar ? "1" : "0",
        CHAMADAS: chamadas,
      },
      encoding: "utf8",
      timeout: 5000,
    });
    let args = "";
    try {
      args = readFileSync(chamadas, "utf8");
    } catch {
      /* sem publicação */
    }
    return { status: r.status, args };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("release personalizada só aparece depois das imagens", () => {
  it("depende da promoção estável, limita o dono e só aceita push de tag", () => {
    expect(job).toContain("needs: [promover-stable]");
    expect(job).toContain("github.repository == 'felpzGondim/DeskcommCRM'");
    expect(job).toContain("github.event_name == 'push'");
    expect(job).toContain("github.ref_type == 'tag'");
  });

  it("publica versão própria verificando a tag e tornando-a visível em releases/latest", () => {
    const r = executar("v1.66.1-felpz.1");
    expect(r.status).toBe(0);
    expect(r.args.split("\n")).toEqual(
      expect.arrayContaining([
        "release",
        "create",
        "v1.66.1-felpz.1",
        "--verify-tag",
        "--latest",
        "--prerelease=false",
      ]),
    );
  });

  it.each(["v1.66.1", "main", "v1.66.1-felpz.1;echo surpresa"])("não publica %s", (tag) => {
    expect(executar(tag)).toEqual({ status: 0, args: "" });
  });

  it("não altera uma release já existente", () => {
    expect(executar("v1.66.1-felpz.1", true)).toEqual({ status: 0, args: "" });
  });

  it("preserva a falha da API de criação", () => {
    expect(executar("v1.66.1-felpz.1", false, true).status).toBe(1);
  });
});
