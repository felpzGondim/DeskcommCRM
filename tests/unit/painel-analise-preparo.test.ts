import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { abrirPrevia, fontesDaAnalise, hashDasFontes, lerPdfsOriginais, pendenciasDaPrevia, previaSchema, selarPrevia } from "@/lib/agent-engine/agent/painel-analise-preparo";

const previa = previaSchema.parse({
  candidato: { nome: { valor: "Maria", fonte: "M1", trecho: "Maria" }, cpf: { valor: "52998224725", fonte: "M1", trecho: "52998224725" },
    email: { valor: "maria@example.com", fonte: "M1", trecho: "maria@example.com" } },
  imovel: { codigo_fc: { valor: "A10", fonte: "M1", trecho: "A10" }, logradouro: { valor: null, fonte: null, trecho: null },
    apartamento: { valor: null, fonte: null, trecho: null }, aluguel: { valor: 1200, fonte: "M1", trecho: "1200" } },
  renda: { mensal: { valor: 4000, fonte: "M2", trecho: "4000" }, documentos: [
    { fonte: "M2", tipo: "holerite", periodo: "10/2026", resumo: "Renda líquida", valor_comprovado: 4000 },
  ] }, pendencias: [],
});

describe("prévia efêmera da análise", () => {
  it("só libera confirmação com valores presentes no texto legível", () => {
    const fontes = fontesDaAnalise([
      { type: "document", body: "", media_derived_status: "ready", media_derived_text: "holerite renda liquida 4000", original_completo: true },
      { type: "text", body: "Maria 52998224725 maria@example.com A10 aluguel 1200" },
    ]);
    expect(pendenciasDaPrevia(previa, fontes)).toEqual([]);
    expect(pendenciasDaPrevia({ ...previa, renda: { ...previa.renda, mensal: { valor: 9000, fonte: "M2", trecho: "9000" } } }, fontes))
      .toContain("Renda mensal sem comprovante legível e origem verificável.");
    expect(pendenciasDaPrevia({ ...previa, renda: { ...previa.renda, mensal: { valor: 9000, fonte: "M2", trecho: "4000" } } }, fontes))
      .toContain("Renda mensal sem comprovante legível e origem verificável.");
  });

  it("PDF truncado ou imagem descritiva exige leitura original", () => {
    const fontes = fontesDaAnalise([{ type: "document", media_derived_status: "ready", media_derived_text: "X".repeat(8000) },
      { type: "image", media_derived_status: "ready", media_derived_text: "Parece um extrato" }]);
    expect(fontes.every((f) => !f.legivel)).toBe(true);
    expect(pendenciasDaPrevia(previa, fontes)).toContain("Há anexos sem leitura completa (imagem, PDF escaneado ou arquivo extenso). Confira os originais antes de confirmar.");
  });

  it("cifra a prévia e a prende a organização, conversa, usuário e prazo", () => {
    const hash = hashDasFontes(fontesDaAnalise([{ type: "text", body: "dados" }]));
    const token = selarPrevia({ previa, hash, expira: Date.now() + 60_000 }, "segredo", "org:conversa:usuario");
    expect(token).not.toContain("52998224725");
    expect(abrirPrevia(token, "segredo", "org:conversa:usuario")?.hash).toBe(hash);
    expect(abrirPrevia(token, "segredo", "outra-org:conversa:usuario")).toBeNull();
    expect(abrirPrevia(selarPrevia({ previa, hash, expira: Date.now() - 1 }, "segredo", "escopo"), "segredo", "escopo")).toBeNull();
  });

  it("reabre apenas PDF do caminho desta organização e conversa", async () => {
    const pdf = readFileSync("tests/fixtures/sample-text.pdf");
    let downloads = 0;
    const admin = { storage: { from: () => ({ download: async () => {
      downloads++;
      return { data: new Blob([new Uint8Array(pdf)]), error: null };
    } }) } };
    const linhas = await lerPdfsOriginais([
      { type: "document", media_mime: "application/pdf", media_storage_path: "outra-org/conversa/segredo.pdf", media_size_bytes: pdf.length },
      { type: "document", media_mime: "application/pdf", media_storage_path: "org/conversa/extrato.pdf", media_size_bytes: pdf.length },
    ], "org", "conversa", admin as never);
    expect(downloads).toBe(1);
    expect(linhas[0]?.original_completo).toBeUndefined();
    expect(linhas[1]?.original_completo).toBe(true);
    expect(typeof linhas[1]?.media_derived_text).toBe("string");
    expect(fontesDaAnalise(linhas)[0]?.legivel).toBe(true);
  });
});
