import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { completarFicha } from "@/lib/locacao/ficha-schema";
import {
  TEXTO_BLOCO_RENDA_AUSENTE,
  aceitarBlocoDeRenda,
  lerBlocoDeRendaSalvo,
} from "@/lib/locacao/analise/bloco-de-renda";

describe("bloco de renda do relatório — só consome, não calcula", () => {
  it("declarada sozinha nunca vira comprovada", () => {
    const bloco = aceitarBlocoDeRenda({ declarada: 8000 });
    expect(bloco.comprovada).toBeNull();
    expect(bloco.declarada).toBe(8000);
    expect(bloco.comprovada).not.toBe(bloco.declarada);
    expect(bloco.motivo_nao_comprovacao).toBe(TEXTO_BLOCO_RENDA_AUSENTE);
    expect(bloco.tabela).toBeNull();
  });

  it("comprovada nula com declarada no mesmo objeto continua nula", () => {
    const bloco = aceitarBlocoDeRenda({
      comprovada: null,
      renda_declarada: 8000,
      tabela_mensal: "esta tabela não vale sem comprovada",
    });
    expect(bloco.comprovada).toBeNull();
    expect(bloco.declarada).toBe(8000);
    expect(bloco.comprovada).not.toBe(8000);
  });

  it("renda.mensal da ficha (preliminar ou 4.1) não conta como bloco calculado", () => {
    const ficha = completarFicha({
      renda: { mensal: { valor: 8000 }, proposta_fc: { valor: 8000 } },
    });
    const bloco = lerBlocoDeRendaSalvo(ficha);
    expect(bloco.comprovada).toBeNull();
    expect(bloco.comprovada).not.toBe(8000);
    expect(bloco.motivo_nao_comprovacao).toBe(TEXTO_BLOCO_RENDA_AUSENTE);
  });

  it("bloco com comprovada e tabela passa; declarada fica ao lado", () => {
    const bloco = aceitarBlocoDeRenda({
      comprovada: 4500,
      declarada: 8000,
      tabela: "Mês | Créditos brutos | Excluídos | Renda considerada\n2026-09 | 4500.00 | 0 | 4500.00",
      pacote: 2500,
      tres_vezes_pacote: 7500,
      abaixo_de_3x: true,
    });
    expect(bloco.comprovada).toBe(4500);
    expect(bloco.comprovada).not.toBe(8000);
    expect(bloco.declarada).toBe(8000);
    expect(bloco.tabela).toMatch(/4500/);
    expect(bloco.abaixo_de_3x).toBe(true);
    expect(bloco.motivo_nao_comprovacao).toBeNull();
  });

  it("este PR não traz motor nem prompt de renda", () => {
    expect(existsSync("lib/locacao/analise/renda-do-relatorio.ts")).toBe(false);
    expect(existsSync("lib/locacao/extrato")).toBe(false);
    const relatorio = readFileSync("lib/locacao/analise/relatorio.ts", "utf8");
    expect(relatorio).not.toMatch(/lancamentosDoTexto|PROMPT_RENDA|detectarExtrato|corrigirRendaDaFicha/);
    const bloco = readFileSync("lib/locacao/analise/bloco-de-renda.ts", "utf8");
    expect(bloco).not.toMatch(/comprovada\s*=\s*declarada|comprovada:\s*declarada|comprovada\s*\?\?\s*declarada/);
    expect(bloco).not.toMatch(/PROMPT_|lancamentosDoTexto|classeDoLancamento/);
    const preliminar = readFileSync("lib/agent-engine/agent/painel-relatorio-preliminar.ts", "utf8");
    expect(preliminar).not.toMatch(/PROMPT_RENDA_DO_RELATORIO|bloco-de-renda/);
  });
});
