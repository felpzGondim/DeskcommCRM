import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  CAMPOS_DA_ABA_DADOS,
  ROTULOS_DO_PACOTE_NA_FICHA,
  valorNoCaminhoDaFicha,
} from "@/lib/locacao/campos-da-aba-dados";
import { completarFicha } from "@/lib/locacao/ficha-schema";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));

vi.mock("@/lib/api/client", () => ({
  apiClient: {
    get: async () => ({ data: { processos: [] } }),
    patch: async () => ({ data: {} }),
  },
}));

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
  locador: { nome: "Maria Locadora", documento: "52998224725", contato: "11987654321" },
  pendencias: ["Aluguel diverge: ficha R$ 2.100,00 × Superlógica R$ 2.400,00."],
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
    expect(screen.getAllByTestId("campos-imovel-processo")).toHaveLength(1);
    expect(screen.getByLabelText("Aluguel (R$/mês)")).toHaveValue("2100");
    expect(screen.getAllByText(/Origem/).length).toBeGreaterThan(0);
  });

  it("mostra divergência de aluguel no bloco único do pacote, sem trocar o valor da ficha", () => {
    render(
      <FichaPreliminarPainel conversationId="conv-ficticia" senhasPdf={[]} />,
    );
    const bloco = screen.getByTestId("campos-imovel-processo");
    expect(within(bloco).getByLabelText("Aluguel (R$/mês)")).toHaveValue("2100");
    expect(within(bloco).getByText(/Aluguel diverge: ficha R\$ 2.100,00 × Superlógica R\$ 2.400,00/)).toBeTruthy();
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

  it("mostra o locador mascarado e o relatório recolhido no fim", () => {
    const { container } = render(
      <FichaPreliminarPainel conversationId="conv-ficticia" senhasPdf={[]} />,
    );
    expect(screen.getByTestId("campos-locador")).toBeTruthy();
    expect(screen.getByLabelText("Nome do locador")).toHaveValue("Maria Locadora");
    expect(screen.getByLabelText("CPF/CNPJ do locador")).toHaveValue("***.***.**7-25");
    expect(screen.getByLabelText("Contato do locador")).toHaveValue("(11) *****-4321");
    const pessoas = container.querySelector("h4")?.textContent;
    expect(pessoas).toBe("Pessoas");
    const recolhido = screen.getByTestId("relatorio-preliminar-recolhido");
    expect(recolhido.tagName.toLowerCase()).toBe("details");
    expect(recolhido).not.toHaveAttribute("open");
    expect(screen.getAllByTestId("selo-origem").length).toBeGreaterThan(3);
    expect(
      within(screen.getByTestId("campos-imovel-processo")).getByText(
        /Aluguel diverge: ficha R\$ 2.100,00 × Superlógica R\$ 2.400,00/,
      ),
    ).toBeTruthy();
  });
});
