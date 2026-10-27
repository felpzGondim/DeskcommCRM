import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { tetoDoAgente } from "@/lib/release/cabe-na-tela";
import { extractChangelogRange } from "@/lib/system/changelog";

const raw = fs.readFileSync(path.join(process.cwd(), "CHANGELOG.md"), "utf8");
const agente = fs.readFileSync(path.join(process.cwd(), "hostgator-setup-kit/agent.sh"), "utf8");
const recebido = Buffer.from(raw).subarray(0, tetoDoAgente(agente)).toString("utf8");

describe("notas da revisão personalizada chegam à tela de atualização", () => {
  it("alcança a revisão anterior dentro do corte real do agente", () => {
    const faixa = extractChangelogRange(recebido, "v1.88.0-felpz.6", "v1.88.0-felpz.5");
    expect(faixa.completa).toBe(true);
    expect(faixa.secoes.map((s) => s.version)).toEqual(["1.88.0-felpz.6"]);
  });

  it("mostra a pergunta do Hub e o recado quando o serviço recusa", () => {
    const faixa = extractChangelogRange(recebido, "v1.88.0-felpz.6", "v1.88.0-felpz.5");
    expect(faixa.secoes[0]?.body).toContain("pergunta do Hub");
    expect(faixa.secoes[0]?.body).toContain("recado");
    expect(faixa.secoes[0]?.body).toContain("/contrato/preparar");
  });
});
