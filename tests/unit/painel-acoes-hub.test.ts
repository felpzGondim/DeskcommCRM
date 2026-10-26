import { describe, expect, it } from "vitest";
import { apresentarResultado, ferramentaDaAcao, leituraPermitida } from "@/lib/agent-engine/agent/painel-acoes-hub";

describe("mapeamento do painel para o Brisa Hub", () => {
  it("usa só ferramenta anunciada e aceita o nome alternativo", () => {
    expect(ferramentaDaAcao("boletos", [{ name: "buscar_boletos" }])?.name).toBe("buscar_boletos");
    expect(ferramentaDaAcao("boletos", [{ name: "status" }])).toBeNull();
    expect(ferramentaDaAcao("analise", [{ name: "brisa-hub-analise" }])?.name).toBe("brisa-hub-analise");
    expect(ferramentaDaAcao("analise", [{ name: "brisa_hub_analise" }])?.name).toBe("brisa_hub_analise");
    expect(leituraPermitida("boletos", { name: "segunda_via_boleto" })).toBe(true);
    expect(leituraPermitida("contrato", { name: "buscar_contrato" })).toBe(false);
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

  it("aceita JSON textual do Hub e devolve só links HTTPS de segunda via", () => {
    const r = apresentarResultado("boletos", { texto: JSON.stringify({
      instrucao: "CPF completo de Ana: 123.456.789-00",
      boletos: [
        { vencimento: "2026-11-05", valor: 123, situacao: "em aberto", link: "https://boletos.exemplo/segunda-via/1" },
        { vencimento: "2026-11-06", valor: 200, situacao: "vencido", link: "http://inseguro.exemplo/2" },
      ],
    }) });
    expect(r?.links).toEqual([{ rotulo: "Abrir 2ª via do boleto 1", url: "https://boletos.exemplo/segunda-via/1" }]);
    expect(r?.resumo).not.toMatch(/Ana|123\.456/);
  });

  it("gera sugestão somente com tipos de documento reconhecidos", () => {
    const r = apresentarResultado("ficha", { texto: "", dados: {
      documentos_faltantes: ["comprovante de renda", "Documento de Ana 11999999999"],
    } });
    expect(r?.sugestao).toContain("comprovante de renda");
    expect(r?.sugestao).not.toMatch(/Ana|99999999/);
  });
});
