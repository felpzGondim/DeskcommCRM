import { describe, expect, it } from "vitest";

import { publicoDaExecucaoDeRenda } from "@/lib/locacao/analise/publico-renda";
import type { LocacaoExecucaoRow } from "@/lib/locacao/tipos-banco";

describe("público da execução de renda", () => {
  it("tira a senha e deixa motivo, etapa e 3×", () => {
    const row = {
      id: "e1",
      aba: "renda",
      estado: "erro",
      etapa_texto: "leitura de imagem falhou",
      progresso_atual: 2,
      progresso_total: 10,
      erro_motivo: "leitura de imagem falhou",
      entrada_hash: "abc",
      ficha_versao: 1,
      origem: "botao",
      iniciado_em: null,
      terminado_em: null,
      resultado: {
        senhas: { "extrato.pdf": "segredo" },
        checklist: ["leitura de imagem falhou"],
        regra_3x: { frase: "A renda comprovada cobre 3× o pacote." },
      },
    } as unknown as LocacaoExecucaoRow;
    const publico = publicoDaExecucaoDeRenda(row);
    expect(publico.motivo).toBe("leitura de imagem falhou");
    expect(publico.checklist).toEqual(["leitura de imagem falhou"]);
    expect(publico.regra_3x).toEqual({ frase: "A renda comprovada cobre 3× o pacote." });
    expect(JSON.stringify(publico)).not.toMatch(/senhas|segredo/);
  });
});
