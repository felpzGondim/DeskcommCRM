import { describe, expect, it } from "vitest";
import { apresentarResultado, ferramentaDaAcao } from "@/lib/agent-engine/agent/painel-acoes-hub";

describe("mapeamento do painel para o Brisa Hub", () => {
  it("usa só ferramenta anunciada e aceita o nome alternativo", () => {
    expect(ferramentaDaAcao("boletos", [{ name: "buscar_boletos" }])?.name).toBe("buscar_boletos");
    expect(ferramentaDaAcao("boletos", [{ name: "status" }])).toBeNull();
    expect(ferramentaDaAcao("analise", [{ name: "brisa_hub_analise" }])?.name).toBe("brisa_hub_analise");
  });

  it("não exibe texto livre nem campos pessoais não pedidos", () => {
    const r = apresentarResultado("boletos", {
      texto: "Ana 11999999999 CPF 123.456.789-00",
      dados: { boletos: [{ situacao: "em aberto", vencimento: "2026-11-05", valor: 123, cpf: "123.456.789-00" }] },
    });
    expect(r?.resumo).toContain("R$ 123.00");
    expect(r?.resumo).not.toMatch(/Ana|99999999|123\.456/);
    expect(apresentarResultado("boletos", { texto: "sem estrutura" })).toBeNull();
  });

  it("gera sugestão somente com tipos de documento reconhecidos", () => {
    const r = apresentarResultado("ficha", { texto: "", dados: {
      documentos_faltantes: ["comprovante de renda", "Documento de Ana 11999999999"],
    } });
    expect(r?.sugestao).toContain("comprovante de renda");
    expect(r?.sugestao).not.toMatch(/Ana|99999999/);
  });
});
