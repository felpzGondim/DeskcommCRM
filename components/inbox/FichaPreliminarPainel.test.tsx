import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  CAMPOS_DA_ABA_DADOS,
  ROTULOS_DO_PACOTE_NA_FICHA,
  valorNoCaminhoDaFicha,
} from "@/lib/locacao/campos-da-aba-dados";
import { completarFicha } from "@/lib/locacao/ficha-schema";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));

const ficha = completarFicha({
  imovel: {
    logradouro: "Rua das Flores",
    numero: "100",
    complemento: "ap 12",
    bairro: "Centro",
    cep: "01310-100",
    cidade: "São Paulo",
    uf: "SP",
    tipo: "residencial",
    codigo_fc: "Flores12",
    aluguel: 2100,
    condominio: 350,
    iptu: 120,
    seguro_incendio: 85,
  },
  vigencia: { inicio: "2026-11-10", fim: "2029-05-10" },
  garantia: { tipo: "seguro_fianca", valor_mensal: 99 },
  contrato: { indice_reajuste: "IGPM", taxa_adm: 8, taxa_locacao: 50, observacao: "reajuste anual" },
});

vi.mock("@/hooks/inbox/useFichaPreliminar", () => ({
  useFichaPreliminar: () => ({
    ficha,
    setFicha: vi.fn(),
    relatorio: "relatório fictício",
    setRelatorio: vi.fn(),
    versao: 1,
    historico: [],
    somenteLeitura: false,
    setSomenteLeitura: vi.fn(),
    carregando: null,
    gerando: false,
    erro: null,
    gerar: vi.fn(),
    salvar: vi.fn(),
    verVersao: vi.fn(),
  }),
}));

import { FichaPreliminarPainel } from "@/components/inbox/FichaPreliminarPainel";

function valorExibido(bruto: unknown): string {
  if (bruto && typeof bruto === "object" && "valor" in bruto) {
    const v = (bruto as { valor: unknown }).valor;
    return v == null ? "" : String(v);
  }
  return bruto == null ? "" : String(bruto);
}

const CAMPOS_DA_FICHA = CAMPOS_DA_ABA_DADOS.filter((c) => c.superficie === "ficha");

describe("FichaPreliminarPainel — aba Dados", () => {
  it.each([...CAMPOS_DA_FICHA])("mostra $tela com o valor vindo da conversa", (campo) => {
    render(
      <FichaPreliminarPainel conversationId="conv-ficticia" senhasPdf={[]} />,
    );
    const esperado = valorExibido(valorNoCaminhoDaFicha(ficha, campo.path));
    if (campo.tipo === "enum") {
      const rotulo = { residencial: "Residencial", comercial: "Comercial", seguro_fianca: "Seguro fiança" }[esperado] ?? esperado;
      expect(screen.getByDisplayValue(rotulo)).toBeTruthy();
      return;
    }
    expect(screen.getByLabelText(campo.tela)).toHaveValue(esperado);
  });

  it("não duplica o pacote na ficha — aluguel e demais ficam no bloco com origem", () => {
    render(
      <FichaPreliminarPainel conversationId="conv-ficticia" senhasPdf={[]} />,
    );
    for (const rotulo of ROTULOS_DO_PACOTE_NA_FICHA) {
      expect(screen.queryByLabelText(rotulo)).toBeNull();
    }
    expect(screen.queryByTestId("campos-imovel-processo")).toBeNull();
  });

  it("mostra garantia e contrato extraídos da conversa", () => {
    render(
      <FichaPreliminarPainel conversationId="conv-ficticia" senhasPdf={[]} />,
    );
    expect(screen.getByDisplayValue("Seguro fiança")).toBeTruthy();
    expect(screen.getByLabelText("Valor mensal da garantia (R$)")).toHaveValue("99");
    expect(screen.getByLabelText("Índice de reajuste")).toHaveValue("IGPM");
    expect(screen.getByLabelText("Taxa de administração (%)")).toHaveValue("8");
    expect(screen.getByLabelText("Taxa de locação (%)")).toHaveValue("50");
    expect(screen.getByLabelText("Observação")).toHaveValue("reajuste anual");
  });
});
