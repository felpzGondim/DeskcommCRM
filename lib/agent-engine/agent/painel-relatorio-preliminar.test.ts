import { describe, expect, it, vi } from "vitest";

vi.mock("../edge/llm/run-model-call", () => ({
  runModelCall: vi.fn(),
}));

import { runModelCall } from "../edge/llm/run-model-call";
import {
  AVISO_FICHA_CORTADA,
  FRASE_DECLARADO_ANULADO,
  FRASE_PACOTE_AUSENTE,
  aplicarRegrasDoRelatorioPreliminar,
  blocoDasFontesDaFicha,
  fontesDaFicha,
  gerarRelatorioPreliminarNoPainel,
  prepararFontesDoRelatorio,
  SYSTEM_DO_RELATORIO_PRELIMINAR,
} from "@/lib/agent-engine/agent/painel-relatorio-preliminar";
import { fichaVazia } from "@/lib/locacao/ficha-schema";
import { EXTRATO_STONE_SINTETICO } from "@/lib/locacao/extrato/texto-sintetico";

describe("fontes da ficha preliminar", () => {
  it("numera a janela e leva o id da mensagem sem path de storage", () => {
    const fontes = fontesDaFicha([
      {
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        type: "text",
        body: "sou o fiador",
        direction: "inbound",
      },
      {
        id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        type: "document",
        body: "holerite",
        media_derived_status: "ready",
        media_derived_text: "liquido 4000",
        metadata: { media_filename: "holerite.pdf" },
        media_storage_path: "org/conv/secreto.pdf",
      },
    ]);
    expect(fontes[0]?.id).toBe("M1");
    expect(fontes[0]?.message_id).toBe("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    expect(blocoDasFontesDaFicha(fontes)).toContain("holerite.pdf");
    expect(blocoDasFontesDaFicha(fontes)).not.toContain("org/conv/secreto.pdf");
  });

  it("o prompt proíbe FC paga, contrato e alugue/não alugue", () => {
    expect(SYSTEM_DO_RELATORIO_PRELIMINAR).toMatch(/Nunca envie mensagem/);
    expect(SYSTEM_DO_RELATORIO_PRELIMINAR).toMatch(/FC Score\+/);
    expect(SYSTEM_DO_RELATORIO_PRELIMINAR).toMatch(/\/contrato\/confirmar/);
    expect(SYSTEM_DO_RELATORIO_PRELIMINAR).toMatch(/alugue/);
  });

  it("monta a ficha a partir do JSON do modelo, sem chamar provedor real", async () => {
    vi.mocked(runModelCall).mockResolvedValue({
      result: {
        text: '{"relatorio":"Maria quer o apto 10.","ficha":{"pessoas":[{"papel":"inquilino","principal":true,"nome":{"valor":"Maria"}}]}}',
      },
      callId: "call-1",
    } as never);
    const { saida } = await gerarRelatorioPreliminarNoPainel({} as never, {} as never, {
      tenantId: "org",
      contactId: "contato",
      fontes: "[M1] cliente text Maria",
    });
    expect(saida.relatorio).toContain("Maria");
    expect(saida.ficha.pessoas[0]?.papel).toBe("inquilino");
    expect(saida.ficha.pessoas[0]?.celular.valor).toBeNull();
    expect(runModelCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        purpose: "painel_atendente",
        system: SYSTEM_DO_RELATORIO_PRELIMINAR,
        maxOutputTokens: 16384,
      }),
      expect.anything(),
    );
  });

  it("o prompt pede trecho curto e omite o esqueleto de nulos", () => {
    expect(SYSTEM_DO_RELATORIO_PRELIMINAR).toMatch(/~80 caracteres/);
    expect(SYSTEM_DO_RELATORIO_PRELIMINAR).toMatch(/omita o campo/);
    expect(SYSTEM_DO_RELATORIO_PRELIMINAR).not.toMatch(/"valor":null/);
    expect(SYSTEM_DO_RELATORIO_PRELIMINAR).toMatch(/texto foi cortado/);
  });

  it("saída truncada pelo teto de tokens vira saida_truncada", async () => {
    vi.mocked(runModelCall).mockResolvedValue({
      result: { text: '{"relatorio":"incompleto"', finishReason: "length" },
      callId: "call-2",
    } as never);
    await expect(
      gerarRelatorioPreliminarNoPainel({} as never, {} as never, {
        tenantId: "org",
        contactId: "contato",
        fontes: "[M1] cliente text Maria",
      }),
    ).rejects.toThrow("saida_truncada");
  });

  it("marca fonte no teto de derivação e não infere ausência", () => {
    const fontes = fontesDaFicha([
      {
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        type: "document",
        body: "",
        direction: "inbound",
        media_derived_status: "ready",
        media_derived_text: "débito ".repeat(2000).slice(0, 8000),
        metadata: { media_filename: "extrato.pdf" },
      },
    ]);
    expect(fontes[0]?.truncado).toBe(true);
    expect(blocoDasFontesDaFicha(fontes)).toMatch(/TEXTO CORTADO NO TETO DE DERIVAÇÃO/);
    expect(blocoDasFontesDaFicha(fontes)).toMatch(/Não conclua ausência de créditos/);
  });

  it("PDF reaberto por completo não leva o aviso de corte", () => {
    const fontes = fontesDaFicha([
      {
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        type: "document",
        body: "",
        direction: "inbound",
        media_derived_status: "ready",
        media_derived_text: `${"crédito 1000\n".repeat(900)}`.slice(0, 12000),
        original_completo: true,
        metadata: { media_filename: "extrato.pdf" },
      },
    ]);
    expect(fontes[0]?.truncado).toBe(false);
    expect(blocoDasFontesDaFicha(fontes)).not.toMatch(/TEXTO CORTADO NO TETO DE DERIVAÇÃO/);
  });

  it("fonte acima do limite da ficha gera aviso e pendência", () => {
    const fontes = fontesDaFicha(
      [
        {
          id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          type: "document",
          body: "",
          direction: "inbound",
          media_derived_status: "ready",
          media_derived_text: "contrato " + "x".repeat(25_000),
          original_completo: true,
          metadata: { media_filename: "contrato.pdf" },
        },
      ],
      { charsPorAnexo: 20_000 },
    );
    expect(fontes[0]?.cortadoNaFicha).toBe(true);
    expect(blocoDasFontesDaFicha(fontes)).toContain(AVISO_FICHA_CORTADA);
    const preparado = prepararFontesDoRelatorio(fontes);
    expect(preparado.pendencias.join(" ")).toMatch(/cortado no teto da ficha/);
  });

  it("extrato longo vira tabela calculada, não o texto bruto", () => {
    const fontes = fontesDaFicha([
      {
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        type: "document",
        body: "",
        direction: "inbound",
        media_derived_status: "ready",
        media_derived_text: EXTRATO_STONE_SINTETICO,
        original_completo: true,
        pdf_paginas: 2,
        metadata: { media_filename: "extrato.pdf" },
      },
    ]);
    const preparado = prepararFontesDoRelatorio(fontes);
    expect(preparado.fontes[0]?.texto).toMatch(/TABELA MENSAL CALCULADA/);
    expect(preparado.fontes[0]?.texto).not.toContain("529.982.247-25");
    expect(preparado.analises[0]?.rendaComprovadaCentavos).toBe(530_000);
    expect(blocoDasFontesDaFicha(preparado.fontes)).toMatch(/paginas=2/);
  });

  it("o prompt contém as regras de renda e as 6 seções, sem limite de 8 linhas", () => {
    expect(SYSTEM_DO_RELATORIO_PRELIMINAR).toMatch(/CRÉDITOS DO EXTRATO/);
    expect(SYSTEM_DO_RELATORIO_PRELIMINAR).toMatch(/NUNCA é renda comprovada/);
    expect(SYSTEM_DO_RELATORIO_PRELIMINAR).toMatch(/## Identificação/);
    expect(SYSTEM_DO_RELATORIO_PRELIMINAR).toMatch(/## Renda comprovada/);
    expect(SYSTEM_DO_RELATORIO_PRELIMINAR).toMatch(/## Comparação com declarado e 3x pacote/);
    expect(SYSTEM_DO_RELATORIO_PRELIMINAR).toMatch(/## Documentos/);
    expect(SYSTEM_DO_RELATORIO_PRELIMINAR).toMatch(/## Alertas/);
    expect(SYSTEM_DO_RELATORIO_PRELIMINAR).toMatch(/## Risco/);
    expect(SYSTEM_DO_RELATORIO_PRELIMINAR).toContain(FRASE_PACOTE_AUSENTE);
    expect(SYSTEM_DO_RELATORIO_PRELIMINAR).not.toMatch(/até 8 linhas/);
    expect(SYSTEM_DO_RELATORIO_PRELIMINAR).toMatch(
      /sem renda comprovada o risco não pode ser baixo/i,
    );
  });

  it("declarado como comprovado é anulado", async () => {
    vi.mocked(runModelCall).mockResolvedValue({
      result: {
        text: JSON.stringify({
          relatorio: "## Identificação\nAna\n## Risco\nmoderado",
          ficha: { renda: { mensal: { valor: 5000, fonte: "M1", trecho: "renda 5000" } } },
        }),
      },
      callId: "call-3",
    } as never);
    const { saida } = await gerarRelatorioPreliminarNoPainel({} as never, {} as never, {
      tenantId: "org",
      contactId: "contato",
      fontes: "[M1] cliente text renda 5000",
      rendaDeclaradaCentavos: 500_000,
    });
    expect(saida.ficha.renda.mensal.valor).toBeNull();
    expect(saida.ficha.renda.alertas.join(" ")).toContain(FRASE_DECLARADO_ANULADO);
    expect(saida.relatorio).toMatch(/Renda comprovada/);
  });

  it("não sai risco baixo sem prova de renda", async () => {
    vi.mocked(runModelCall).mockResolvedValue({
      result: {
        text: JSON.stringify({
          relatorio: "## Identificação\nAna\n## Risco\nbaixo",
          ficha: { renda: { mensal: { valor: null } } },
        }),
      },
      callId: "call-4",
    } as never);
    const { saida } = await gerarRelatorioPreliminarNoPainel({} as never, {} as never, {
      tenantId: "org",
      contactId: "contato",
      fontes: "[M1] cliente text Ana",
    });
    expect(saida.relatorio).not.toMatch(/## Risco\nbaixo/i);
    expect(saida.relatorio).toMatch(/## Risco\nmoderado/i);
    expect(saida.ficha.renda.alertas.join(" ")).toMatch(/não pode ser baixo/);
  });

  it("a seção de renda e o tipo extrato vêm do código, não do modelo", () => {
    const fontes = fontesDaFicha([
      {
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        type: "document",
        media_derived_status: "ready",
        media_derived_text: EXTRATO_STONE_SINTETICO,
        original_completo: true,
        metadata: { media_filename: "extrato.pdf" },
      },
    ]);
    const preparado = prepararFontesDoRelatorio(fontes);
    const ficha = fichaVazia();
    ficha.renda.documentos = [
      {
        fonte: "M1",
        tipo: "outro",
        periodo: null,
        resumo: "parece documento",
        valor_comprovado: null,
        message_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
    ];
    ficha.imovel.aluguel.valor = 1000;
    const saida = aplicarRegrasDoRelatorioPreliminar(
      { relatorio: "## Identificação\nAna\n## Risco\nbaixo", ficha },
      { analises: preparado.analises, pendencias: [], rendaDeclaradaCentavos: 500_000 },
    );
    expect(saida.relatorio).toMatch(/TABELA MENSAL CALCULADA|renda considerada/i);
    expect(saida.ficha.renda.documentos[0]?.tipo).toBe("extrato");
    expect(saida.ficha.renda.documentos[0]?.valor_comprovado).toBe(5300);
    expect(saida.ficha.renda.mensal.valor).toBe(5300);
    expect(saida.relatorio).toMatch(/3x o pacote/);
    expect(saida.relatorio).toMatch(/## Risco\nbaixo/);
  });

  it("sem pacote a comparação usa a frase fixa", () => {
    const saida = aplicarRegrasDoRelatorioPreliminar(
      { relatorio: "Ana", ficha: fichaVazia() },
      { analises: [], pendencias: [], rendaDeclaradaCentavos: null },
    );
    expect(saida.relatorio).toContain(FRASE_PACOTE_AUSENTE);
  });
});
