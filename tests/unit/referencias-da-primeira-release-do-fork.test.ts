import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function preparar(propria: string, original = "v1.88.0", repo = "felpzGondim/DeskcommCRM") {
  const dir = mkdtempSync(join(tmpdir(), "refs-fork-"));
  const envFile = join(dir, "env");
  const gitFile = join(dir, "git-chamadas");
  writeFileSync(envFile, "");
  writeFileSync(gitFile, "");
  writeFileSync(
    join(dir, "git"),
    `#!/usr/bin/env bash
if [[ "$1" == rev-parse ]]; then echo false; exit 0; fi
printf '%s\\n' "$*" >> "$GIT_CHAMADAS"
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(dir, "gh"),
    `#!/usr/bin/env bash
case "$*" in
  *melgarafael/DeskcommCRM*) [[ -n "$ORIGINAL" ]] || exit 1; echo "$ORIGINAL" ;;
  *) [[ -n "$PROPRIA" ]] || exit 1; echo "$PROPRIA" ;;
esac
`,
    { mode: 0o755 },
  );
  try {
    const r = spawnSync("bash", ["scripts/preparar-referencias-do-fork.sh"], {
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        GITHUB_REPOSITORY: repo,
        GITHUB_ENV: envFile,
        GIT_CHAMADAS: gitFile,
        PROPRIA: propria,
        ORIGINAL: original,
      },
      encoding: "utf8",
      timeout: 5000,
    });
    return {
      status: r.status,
      env: readFileSync(envFile, "utf8"),
      git: readFileSync(gitFile, "utf8"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("referências da primeira release do fork", () => {
  it("sem release própria, testa o kit publicado original e o kit legado", () => {
    const r = preparar("");
    expect(r.status).toBe(0);
    expect(r.env).toBe("CONFERENCIA_KIT_RELEASE=v1.88.0\n");
    expect(r.git).toContain("refs/tags/v1.63.0:refs/tags/v1.63.0");
    expect(r.git).toContain("refs/tags/v1.88.0:refs/tags/v1.88.0");
    expect(r.git).not.toContain("push");
  });

  it("com release própria, usa a do fork e só busca a referência histórica original", () => {
    const r = preparar("v1.88.0-felpz.1");
    expect(r.status).toBe(0);
    expect(r.env).toBe("CONFERENCIA_KIT_RELEASE=v1.88.0-felpz.1\n");
    expect(r.git.trim().split("\n")).toHaveLength(1);
    expect(r.git).toContain("refs/tags/v1.63.0:refs/tags/v1.63.0");
  });

  it("sem nenhuma release acessível, reprova sem exportar uma referência falsa", () => {
    const r = preparar("", "");
    expect(r.status).not.toBe(0);
    expect(r.env).toBe("");
  });

  it("não altera o CI de outro repositório", () => {
    expect(preparar("", "", "melgarafael/DeskcommCRM")).toEqual({ status: 0, env: "", git: "" });
  });
});
