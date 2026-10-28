/**
 * O código de locação NUNCA manda arquivo do Drive para a lixeira nem apaga.
 * A conta de serviço é Administradora de conteúdo — o Google deixaria — e por
 * isso a recusa mora aqui, não no papel. Este teste falha se os verbos da API
 * aparecerem no código de produção da cópia.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();

const PASTAS = [
  "lib/locacao",
  "app/api/v1/cron/locacao-drive-copia",
  "app/api/v1/locacao",
] as const;

const PROIBIDO = [
  { nome: "files.delete", re: /files\.delete/i },
  { nome: "emptyTrash", re: /emptyTrash/ },
  { nome: "trashed=true", re: /trashed\s*=\s*true/i },
  { nome: "trashed: true", re: /["']trashed["']\s*:\s*true/ },
] as const;

function arquivosTs(dir: string): string[] {
  const abs = join(RAIZ, dir);
  try {
    if (!statSync(abs).isDirectory()) return [];
  } catch {
    return [];
  }
  return readdirSync(abs, { withFileTypes: true }).flatMap((ent) => {
    const rel = join(dir, ent.name);
    if (ent.isDirectory()) return arquivosTs(rel);
    if (!ent.name.endsWith(".ts") && !ent.name.endsWith(".tsx")) return [];
    if (ent.name.endsWith(".test.ts") || ent.name.endsWith(".test.tsx")) return [];
    return [rel];
  });
}

describe("Drive da locação nunca apaga", () => {
  const arquivos = PASTAS.flatMap(arquivosTs);

  it("alcança o cliente e o cron da cópia (guarda de vacuidade)", () => {
    expect(arquivos.some((f) => f.replaceAll("\\", "/").endsWith("lib/locacao/drive.ts"))).toBe(true);
    expect(arquivos.some((f) => f.replaceAll("\\", "/").includes("locacao-drive-copia"))).toBe(true);
    expect(arquivos.length).toBeGreaterThan(3);
  });

  it("nenhum arquivo de produção traz files.delete, trashed=true ou emptyTrash", () => {
    const achados: string[] = [];
    for (const arquivo of arquivos) {
      const fonte = readFileSync(join(RAIZ, arquivo), "utf8");
      for (const regra of PROIBIDO) {
        if (regra.re.test(fonte)) achados.push(`${arquivo}: ${regra.nome}`);
      }
    }
    expect(achados, "o código de locação não pode apagar nem mandar para a lixeira no Drive").toEqual([]);
  });
});
