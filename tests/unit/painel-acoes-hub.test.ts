import { describe, expect, it } from "vitest";
import { apresentarResultado, ferramentaDaAcao, leituraPermitida, montarFichaTemporaria, tresDigitosDoCliente } from "@/lib/agent-engine/agent/painel-acoes-hub";

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

  it("explica a exigência atual do Hub e sugere pedir só os dígitos ao cliente", () => {
    const r = apresentarResultado("boletos", { texto: "", dados: {
      resultado: "precisa_cpf", instrucao: "Peça os três dígitos ao cliente",
    } });
    expect(r?.resumo).toContain("cliente precisa informar");
    expect(r?.sugestao).toContain("Não envie o CPF completo");
  });

  it("aceita só uma mensagem recente composta exatamente por três dígitos", () => {
    const agora = Date.parse("2026-10-26T17:00:00Z");
    expect(tresDigitosDoCliente(" 123 ", "2026-10-26T16:59:00Z", agora)).toBe("123");
    expect(tresDigitosDoCliente("CPF 123", "2026-10-26T16:59:00Z", agora)).toBeNull();
    expect(tresDigitosDoCliente("12345678900", "2026-10-26T16:59:00Z", agora)).toBeNull();
    expect(tresDigitosDoCliente("123", "2026-10-26T16:00:00Z", agora)).toBeNull();
  });

  it("aceita valor e situação no formato real retornado pelo serviço de boletos", () => {
    const r = apresentarResultado("boletos", { texto: "", dados: {
      resultado: "ok", boletos: [{ vencimento: "05/11/2026", valor: "R$ 1.200,50", situacao: "a vencer", link: "https://boletos.exemplo/1" }],
    } });
    expect(r?.resumo).toContain("a vencer · 05/11/2026 · R$ 1.200,50");
  });

  it("gera sugestão somente com tipos de documento reconhecidos", () => {
    const r = apresentarResultado("ficha", { texto: "", dados: {
      documentos_faltantes: ["comprovante de renda", "Documento de Ana 11999999999"],
    } });
    expect(r?.sugestao).toContain("comprovante de renda");
    expect(r?.sugestao).not.toMatch(/Ana|99999999/);
  });

  it("monta JSON temporário apenas com pistas dos anexos recebidos", () => {
    const ficha = montarFichaTemporaria([
      { type: "document", body: "Meu RG", media_mime: "image/png", metadata: { media_filename: "rg.png", media_url: "https://secreto.test" } },
      { type: "text", body: "CPF 12345678900" },
      { type: "image", body: "extrato bancário", media_mime: "image/jpeg", metadata: { media_filename: "foto.jpg" }, revoked_at: "2026-10-27" },
    ]);
    expect(ficha).toEqual({ anexos: [{ nome: "rg.png", mime: "image/png", legenda: "Meu RG", conteudo: "" }] });
    expect(JSON.stringify(ficha)).not.toMatch(/12345678900|secreto/);
  });

  it("mostra o dia real de vencimento sem confundir com o fim do contrato", () => {
    const r = apresentarResultado("contrato", { texto: "", dados: {
      resultado: "ok", contrato: { imovel: "Rua A", valor: "R$ 1.200,50", dia_vencimento: "10", situacao: "ativo" },
      inquilino_situacao: "ativo",
    } });
    expect(r?.resumo).toContain("Vencimento: dia 10");
    expect(r?.extra).toEqual({ status: "ok", encontrado: true });
  });

  it("encontrado:false nunca é sucesso nem sugere texto ao cliente", () => {
    const r = apresentarResultado("contrato", { texto: "", dados: {
      resultado: "ok", encontrado: false, status: "ok",
      contrato: { imovel: "Rua que não deveria aparecer" },
    } });
    expect(r?.extra).toEqual({ status: "nao_encontrado", encontrado: false });
    expect(r?.resumo).not.toContain("Rua que não deveria aparecer");
    expect(r?.sugestao).toBeUndefined();
    expect(r?.resumo).toMatch(/não prova que o cliente não tem contrato/i);
  });

  it.each(["nao_encontrado", "indisponivel"] as const)(
    "status %s não vira sugestão nem afirma ausência de contrato",
    (status) => {
      const r = apresentarResultado("contrato", {
        texto: "",
        dados: { resultado: status, encontrado: false, status },
      });
      expect(r?.extra?.encontrado).toBe(false);
      expect(r?.extra?.status).toBe(status);
      expect(r?.sugestao).toBeUndefined();
      expect(r?.resumo.length).toBeGreaterThan(20);
    },
  );
});
