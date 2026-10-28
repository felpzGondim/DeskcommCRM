import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const postMock = vi.fn();
const getMock = vi.fn();
vi.mock("@/lib/api/client", () => ({
  apiClient: {
    post: (...args: unknown[]) => postMock(...args) as Promise<unknown>,
    get: (...args: unknown[]) => getMock(...args) as Promise<unknown>,
  },
}));

import { PainelDoAgente } from "@/components/inbox/PainelDoAgente";

describe("Painel do agente (UI)", () => {
  beforeEach(() => {
    postMock.mockReset();
    getMock.mockReset();
    getMock.mockResolvedValue({ data: { atual: null, historico: [] } });
  });

  it("sugerir resposta → 'Usar como resposta' só preenche, não envia", async () => {
    postMock.mockResolvedValue({ data: { acao: "sugerir", resposta: "Olá! Posso ajudar?" } });
    const usar = vi.fn();
    render(<PainelDoAgente conversationId="c1" onUsarComoResposta={usar} />);
    fireEvent.click(screen.getByRole("button", { name: "Sugerir resposta" }));
    await screen.findByText("Olá! Posso ajudar?");
    expect(postMock).toHaveBeenCalledWith(
      "/api/v1/conversations/c1/painel-agente",
      expect.objectContaining({ acao: "sugerir", historico: [] }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Usar como resposta" }));
    expect(usar).toHaveBeenCalledWith("Olá! Posso ajudar?");
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it("resumo não oferece 'Usar como resposta'", async () => {
    postMock.mockResolvedValue({ data: { acao: "resumir", resposta: "Cliente quer alugar." } });
    render(<PainelDoAgente conversationId="c1" onUsarComoResposta={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Resumir conversa" }));
    await screen.findByText("Cliente quer alugar.");
    expect(screen.queryByRole("button", { name: "Usar como resposta" })).toBeNull();
  });

  it("erro aparece na tela", async () => {
    postMock.mockImplementation(async () => {
      throw new Error("Nenhum provedor de IA está configurado.");
    });
    render(<PainelDoAgente conversationId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Resumir conversa" }));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByRole("alert")).toHaveTextContent("Nenhum provedor");
  });

  it("só leitura desabilita os botões", () => {
    render(<PainelDoAgente conversationId="c1" desabilitado />);
    expect(screen.getByRole("button", { name: "Resumir conversa" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Buscar boletos" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Gerar contrato" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Gerar relatório preliminar" })).toBeDisabled();
  });

  it("oferece Gerar contrato no painel e abre a preparação sem gravar", () => {
    render(<PainelDoAgente conversationId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Gerar contrato" }));
    expect(screen.getByRole("dialog", { name: "Gerar contrato no SuperLógica" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Preparar locação" })).toBeVisible();
    expect(postMock).not.toHaveBeenCalled();
  });

  it("pede a senha do PDF protegido e reenvia só nesta sessão", async () => {
    postMock.mockResolvedValueOnce({ data: {
      resumo: "Há um PDF protegido.", previaToken: null, pronto: false,
      avisos: [{ tipo: "pdf_protegido", nome: "extrato.pdf", tentativas: 1 }],
    } }).mockResolvedValueOnce({ data: { resumo: "Prévia ok", previaToken: "token", pronto: true, avisos: [] } });
    render(<PainelDoAgente conversationId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Iniciar análise de inquilino" }));
    const senha = await screen.findByLabelText("Senha do PDF extrato.pdf");
    fireEvent.change(senha, { target: { value: "segredo-da-sessao" } });
    fireEvent.click(screen.getByRole("button", { name: "Ler de novo com a senha" }));
    await screen.findByText("Prévia ok");
    expect(postMock).toHaveBeenLastCalledWith(
      "/api/v1/conversations/c1/painel-agente/acoes",
      { acao: "analise", etapa: "preparar", senhasPdf: [{ nome: "extrato.pdf", senha: "segredo-da-sessao" }] },
    );
  });

  it("análise exige confirmação antes de chamar a rota", async () => {
    postMock.mockResolvedValueOnce({ data: { resumo: "Renda preliminar: R$ 4.000,00", previaToken: "token", pronto: true } })
      .mockResolvedValueOnce({ data: { resumo: "Pedido de análise enviado." } });
    render(<PainelDoAgente conversationId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Iniciar análise de inquilino" }));
    await screen.findByText("Renda preliminar: R$ 4.000,00");
    expect(postMock).toHaveBeenCalledWith("/api/v1/conversations/c1/painel-agente/acoes", { acao: "analise", etapa: "preparar" });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar análise" }));
    await screen.findByText("Pedido de análise enviado.");
    expect(postMock).toHaveBeenCalledWith(
      "/api/v1/conversations/c1/painel-agente/acoes",
      expect.objectContaining({ acao: "analise", etapa: "confirmar", confirmar: true, pedidoId: expect.any(String), previaToken: "token" }),
    );
  });

  it("pedido de documentos só preenche o Composer", async () => {
    postMock.mockResolvedValue({ data: { resumo: "Pendentes", sugestao: "Envie o RG, por favor." } });
    const preencher = vi.fn();
    render(<PainelDoAgente conversationId="c1" onUsarComoResposta={preencher} />);
    fireEvent.click(screen.getByRole("button", { name: "Ficha cadastral / pedir documentos" }));
    await screen.findByText("Envie o RG, por favor.");
    fireEvent.click(screen.getByRole("button", { name: "Usar como resposta" }));
    expect(preencher).toHaveBeenCalledWith("Envie o RG, por favor.");
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it("gera o relatório preliminar e deixa salvar a ficha sem enviar ao cliente", async () => {
    postMock.mockResolvedValue({ data: {
      versao: 1, origem: "preliminar_ia", relatorio: "Maria quer o apto 10.",
      ficha: {
        versao: "preliminar-v1",
        pessoas: [{
          papel: "inquilino", principal: true, relacao: null,
          nome: { valor: "Maria", fonte: "M1", trecho: "Maria", confianca: 0.9, message_id: null },
          cpf: { valor: null, fonte: null, trecho: null, confianca: null, message_id: null },
          email: { valor: null, fonte: null, trecho: null, confianca: null, message_id: null },
          celular: { valor: "11970001111", fonte: "M1", trecho: "11", confianca: 0.8, message_id: null },
          nascimento: { valor: null, fonte: null, trecho: null, confianca: null, message_id: null },
          rg: { valor: null, fonte: null, trecho: null, confianca: null, message_id: null },
          profissao: { valor: null, fonte: null, trecho: null, confianca: null, message_id: null },
          empregador: { valor: null, fonte: null, trecho: null, confianca: null, message_id: null },
          endereco: {
            logradouro: { valor: null, fonte: null, trecho: null, confianca: null, message_id: null },
            numero: { valor: null, fonte: null, trecho: null, confianca: null, message_id: null },
            complemento: { valor: null, fonte: null, trecho: null, confianca: null, message_id: null },
            bairro: { valor: null, fonte: null, trecho: null, confianca: null, message_id: null },
            cep: { valor: null, fonte: null, trecho: null, confianca: null, message_id: null },
            cidade: { valor: null, fonte: null, trecho: null, confianca: null, message_id: null },
            uf: { valor: null, fonte: null, trecho: null, confianca: null, message_id: null },
          },
          renda_individual: { valor: null, fonte: null, trecho: null, confianca: null, message_id: null },
        }],
        renda: { mensal: { valor: 4000, fonte: "M2", trecho: "4000", confianca: 0.7, message_id: null },
          proposta_fc: { valor: null, fonte: null, trecho: null, confianca: null, message_id: null },
          documentos: [], alertas: [] },
        imovel: {
          codigo_fc: { valor: "Rua10", fonte: "M1", trecho: "Rua", confianca: 0.5, message_id: null },
          tipo: "residencial",
          logradouro: { valor: "Rua das Flores", fonte: "M1", trecho: "Flores", confianca: 0.6, message_id: null },
          numero: { valor: "100", fonte: null, trecho: null, confianca: null, message_id: null },
          complemento: { valor: null, fonte: null, trecho: null, confianca: null, message_id: null },
          bairro: { valor: null, fonte: null, trecho: null, confianca: null, message_id: null },
          cep: { valor: null, fonte: null, trecho: null, confianca: null, message_id: null },
          cidade: { valor: null, fonte: null, trecho: null, confianca: null, message_id: null },
          uf: { valor: null, fonte: null, trecho: null, confianca: null, message_id: null },
          aluguel: { valor: 2500, fonte: "M1", trecho: "2500", confianca: 0.8, message_id: null },
          iptu: { valor: null, fonte: null, trecho: null, confianca: null, message_id: null },
          condominio: { valor: null, fonte: null, trecho: null, confianca: null, message_id: null },
        },
        garantia: {
          tipo: null,
          caucao_valor: { valor: null, fonte: null, trecho: null, confianca: null, message_id: null },
          seguradora_preferida: { valor: null, fonte: null, trecho: null, confianca: null, message_id: null },
          apolice: { valor: null, fonte: null, trecho: null, confianca: null, message_id: null },
          valor_mensal: { valor: null, fonte: null, trecho: null, confianca: null, message_id: null },
        },
        vigencia: {
          inicio: { valor: null, fonte: null, trecho: null, confianca: null, message_id: null },
          fim: { valor: null, fonte: null, trecho: null, confianca: null, message_id: null },
          prazo_meses: { valor: null, fonte: null, trecho: null, confianca: null, message_id: null },
          dia_vencimento: { valor: null, fonte: null, trecho: null, confianca: null, message_id: null },
        },
        contrato: {
          indice_reajuste: { valor: null, fonte: null, trecho: null, confianca: null, message_id: null },
          split: null,
          isencao_multa_meses: { valor: null, fonte: null, trecho: null, confianca: null, message_id: null },
          taxa_adm: { valor: null, fonte: null, trecho: null, confianca: null, message_id: null },
          taxa_locacao: { valor: null, fonte: null, trecho: null, confianca: null, message_id: null },
          observacao: { valor: null, fonte: null, trecho: null, confianca: null, message_id: null },
          iptu_mensal: { valor: null, fonte: null, trecho: null, confianca: null, message_id: null },
          seguro_fianca_mensal: { valor: null, fonte: null, trecho: null, confianca: null, message_id: null },
        },
        documentos: { encontrados: [], faltantes: ["comprovante de renda"] },
        pendencias: ["Falta holerite"],
      },
      historico: [{ versao: 1, origem: "preliminar_ia", campos_alterados: ["*"], alterado_em: "2026-10-28" }],
    } });
    const usar = vi.fn();
    render(<PainelDoAgente conversationId="c1" onUsarComoResposta={usar} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Gerar relatório preliminar" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Gerar relatório preliminar" }));
    await screen.findByDisplayValue("Maria quer o apto 10.");
    expect(postMock).toHaveBeenCalledWith(
      "/api/v1/conversations/c1/painel-agente/ficha",
      { etapa: "gerar" },
      expect.objectContaining({ timeoutMs: 120000 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Salvar ficha" }));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(2));
    expect(usar).not.toHaveBeenCalled();
    expect(postMock).toHaveBeenCalledWith(
      "/api/v1/conversations/c1/painel-agente/ficha",
      expect.objectContaining({ etapa: "salvar", base_versao: 1, relatorio: "Maria quer o apto 10." }),
    );
  });

  it("pergunta livre vira sugestão e Usar como resposta só preenche", async () => {
    postMock.mockResolvedValue({ data: { acao: "pergunta", resposta: "Aluguel 1.200.", sugestao: true, parou_por: "fim" } });
    const usar = vi.fn();
    render(<PainelDoAgente conversationId="c1" onUsarComoResposta={usar} />);
    fireEvent.change(screen.getByPlaceholderText("Pergunte algo sobre esta conversa…"), {
      target: { value: "qual o aluguel?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Perguntar" }));
    await screen.findByText("Aluguel 1.200.");
    expect(postMock).toHaveBeenCalledWith(
      "/api/v1/conversations/c1/painel-agente",
      expect.objectContaining({ acao: "pergunta", pergunta: "qual o aluguel?", consulta_id: expect.any(String) }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Usar como resposta" }));
    expect(usar).toHaveBeenCalledWith("Aluguel 1.200.");
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it("mostra o andamento pelo polling e Continuar reenvia a mesma pergunta", async () => {
    let resolverPost: ((v: unknown) => void) | undefined;
    postMock.mockImplementationOnce(() => new Promise((resolve) => { resolverPost = resolve; }))
      .mockResolvedValueOnce({ data: { acao: "pergunta", resposta: "Sigo.", sugestao: true, parou_por: "fim" } });
    getMock.mockImplementation(async (url: unknown) => {
      if (String(url).includes("consulta_id=")) {
        return { data: { etapa: "consultando Superlógica…", status: "rodando" } };
      }
      return { data: { atual: null, historico: [] } };
    });
    render(<PainelDoAgente conversationId="c1" onUsarComoResposta={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("Pergunte algo sobre esta conversa…"), {
      target: { value: "tem boleto atrasado?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Perguntar" }));
    await waitFor(() => {
      expect(getMock.mock.calls.some((c) => String(c[0]).includes("consulta_id="))).toBe(true);
    });
    await screen.findByText("consultando Superlógica…");
    resolverPost?.({ data: { acao: "pergunta", resposta: "Parei no limite.", sugestao: true, parou_por: "passos", modo: "normal" } });
    await screen.findByRole("button", { name: "Continuar" });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(2));
    expect(postMock.mock.calls[1]![1]).toEqual(expect.objectContaining({
      acao: "pergunta", pergunta: "tem boleto atrasado?", modo: "normal",
    }));
  });

  it("cartão de propor análise chama o mesmo fluxo do botão", async () => {
    postMock.mockResolvedValueOnce({ data: {
      acao: "pergunta", resposta: "Posso preparar a análise.", sugestao: true, parou_por: "fim",
      propostas: [{ ferramenta: "iniciar_analise", motivo: "Há holerite no anexo." }],
    } }).mockResolvedValueOnce({ data: { resumo: "Prévia ok", previaToken: "token", pronto: true } });
    render(<PainelDoAgente conversationId="c1" />);
    fireEvent.change(screen.getByPlaceholderText("Pergunte algo sobre esta conversa…"), {
      target: { value: "pode analisar o holerite?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Perguntar" }));
    await screen.findByText("Há holerite no anexo.");
    fireEvent.click(screen.getByRole("button", { name: "Preparar análise" }));
    await screen.findByText("Prévia ok");
    expect(postMock).toHaveBeenCalledWith(
      "/api/v1/conversations/c1/painel-agente/acoes",
      { acao: "analise", etapa: "preparar" },
    );
  });

  it("mostra link seguro da segunda via na consulta de boletos", async () => {
    postMock.mockResolvedValue({ data: { resumo: "1. Em aberto · 2026-11-05 · R$ 123.00", links: [
      { rotulo: "Abrir 2ª via do boleto 1", url: "https://boletos.exemplo/1" },
    ] } });
    render(<PainelDoAgente conversationId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Buscar boletos" }));
    const link = await screen.findByRole("link", { name: "Abrir 2ª via do boleto 1" });
    expect(link).toHaveAttribute("href", "https://boletos.exemplo/1");
  });
});
