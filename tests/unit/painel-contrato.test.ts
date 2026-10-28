import { beforeEach, describe, expect, it, vi } from "vitest";

const saida = vi.hoisted(() => vi.fn());
vi.mock("@/lib/mcp/servidor-externo/chamada", () => ({ fetchDeSaida: () => saida }));

import {
  abrirContrato, chamarApiContrato, codigoErroContrato, dadosContratoSchema, ErroApiContrato,
  extrairMensagemErroHub, normalizarPendencias, preparoContratoSchema, resultadoContratoSchema,
  selarContrato, textoDaPendencia,
} from "@/lib/agent-engine/agent/painel-contrato";

const preview = "ab".repeat(18);
const segredo = "segredo-para-os-testes";
const servidor = { endpoint: "https://hub.example/mcp", chave: "chave-privada" };

describe("locação pelo painel", () => {
  beforeEach(() => { vi.useRealTimers(); saida.mockReset(); });

  it("prende prévia e chave idempotente à organização, conversa, pessoa e servidor", () => {
    const token = selarContrato(preview, 1800, segredo, "org:conversa:pessoa:hub");
    const recibo = abrirContrato(token, segredo, "org:conversa:pessoa:hub");
    expect(recibo?.preview).toBe(preview);
    expect(abrirContrato(token, segredo, "org:conversa:pessoa:hub")?.chave).toBe(recibo?.chave);
    for (const escopo of ["outra:conversa:pessoa:hub", "org:outra:pessoa:hub", "org:conversa:outra:hub", "org:conversa:pessoa:outro"]) {
      expect(abrirContrato(token, segredo, escopo)).toBeNull();
    }
    expect(abrirContrato(token + "x", segredo, "org:conversa:pessoa:hub")).toBeNull();
    expect(abrirContrato(token, "outro-segredo", "org:conversa:pessoa:hub")).toBeNull();
  });

  it("expira a prévia conforme o prazo do Hub, limitado a 30 minutos", () => {
    vi.useFakeTimers();
    const token = selarContrato(preview, 10, segredo, "escopo");
    vi.advanceTimersByTime(10_001);
    expect(abrirContrato(token, segredo, "escopo")).toBeNull();
    const limitado = selarContrato(preview, 86400, segredo, "escopo");
    vi.advanceTimersByTime(1800_001);
    expect(abrirContrato(limitado, segredo, "escopo")).toBeNull();
    vi.useRealTimers();
  });

  it("aceita o identificador hexadecimal real do Hub e o resumo completo", () => {
    expect(preparoContratoSchema.parse({ pronto: true, preview_id: preview, pendencias: [],
      resumo: { texto: "Locação ativa; taxas e condições completas." }, validade_s: 1800 }).preview_id).toBe(preview);
    expect(resultadoContratoSchema.parse({ gravado: true, completo: false, id_contrato: "358", situacao: "ATIVO",
      acoes_manuais: ["Pausar pela tela"], divergencias: ["IPTU pendente"] })).toMatchObject({ completo: false, id_contrato: "358" });
  });

  it("aceita pendências como string ou como {campo, pergunta}", () => {
    expect(normalizarPendencias(["Falta IPTU"])).toEqual([{ campo: "", pergunta: "Falta IPTU" }]);
    expect(normalizarPendencias([{ campo: "iptu", pergunta: "Qual o valor mensal do IPTU?" }]))
      .toEqual([{ campo: "iptu", pergunta: "Qual o valor mensal do IPTU?" }]);
    expect(preparoContratoSchema.parse({
      pronto: false, pendencias: [{ campo: "iptu", pergunta: "Qual o valor mensal do IPTU?" }],
      resumo: { texto: "Falta o IPTU." },
    }).pendencias).toEqual([{ campo: "iptu", pergunta: "Qual o valor mensal do IPTU?" }]);
    expect(textoDaPendencia({ campo: "iptu", pergunta: "Qual o valor mensal do IPTU?" }))
      .toBe("iptu: Qual o valor mensal do IPTU?");
  });

  it("aceita pendência com chaves extras do Hub (ex.: contrato não encerrado)", () => {
    const previa = preparoContratoSchema.parse({
      pronto: false, resumo: { texto: "Prévia", itens: [] }, divergencias: [], split_pendente: false,
      pendencias: [
        { campo: "imovel", pergunta: "O imóvel tem contrato não encerrado. Encerrar antes?", tipo: "bloqueio", id_contrato: "123" },
        { campo: "iptu", pergunta: "Qual o valor mensal do IPTU?" },
      ],
    });
    expect(previa.pendencias).toEqual([
      { campo: "imovel", pergunta: "O imóvel tem contrato não encerrado. Encerrar antes?" },
      { campo: "iptu", pergunta: "Qual o valor mensal do IPTU?" },
    ]);
  });

  it("recusa resposta 200 fora do formato (sem resumo ou pendência sem pergunta)", () => {
    expect(preparoContratoSchema.safeParse({ pronto: false, pendencias: [] }).success).toBe(false);
    expect(preparoContratoSchema.safeParse({ pronto: false, resumo: { texto: "x" }, pendencias: [{ campo: "iptu" }] }).success).toBe(false);
  });

  it("exige split e isencao_multa_meses no pedido do painel", () => {
    const base = { imovel: { endereco: "Rua teste" }, locatarios: [{ cpf: "52998224725" }],
      aluguel: 1200, data_inicio: "2026-12-01", dia_vencimento: 10, tipo: "residencial" as const,
      indice_reajuste: "IPCA" as const, garantia: "nenhuma" as const };
    expect(dadosContratoSchema.safeParse(base).success).toBe(false);
    expect(dadosContratoSchema.parse({ ...base, split: false, isencao_multa_meses: 0 }))
      .toMatchObject({ split: false, isencao_multa_meses: 0 });
  });

  it("id_imovel e participante_id são opcionais; o id do imóvel aceita número ou dígitos", () => {
    const base = { imovel: { endereco: "Rua teste" }, locatarios: [{ cpf: "52998224725" }],
      aluguel: 1200, data_inicio: "2026-12-01", dia_vencimento: 10, tipo: "residencial" as const,
      indice_reajuste: "IPCA" as const, garantia: "nenhuma" as const, split: false, isencao_multa_meses: 0 };
    expect(dadosContratoSchema.parse(base).id_imovel).toBeUndefined();
    expect(dadosContratoSchema.parse({ ...base, id_imovel: 42 }).id_imovel).toBe(42);
    expect(dadosContratoSchema.parse({ ...base, id_imovel: "42" }).id_imovel).toBe("42");
    expect(dadosContratoSchema.parse({
      ...base,
      locatarios: [{ cpf: "52998224725", participante_id: "00000000-0000-4000-8000-000000000001" }],
    }).locatarios[0]?.participante_id).toBe("00000000-0000-4000-8000-000000000001");
  });

  it("lê o JSON de erro do Hub e recusa CPF ou token", () => {
    expect(extrairMensagemErroHub({ message: "contrato não configurado" })).toBe("contrato não configurado");
    expect(extrairMensagemErroHub({ error: { detail: "chave sem permissão de escrita" } })).toBe("chave sem permissão de escrita");
    expect(extrairMensagemErroHub({ mensagem: "CPF 52998224725 inválido" })).toBeUndefined();
    expect(extrairMensagemErroHub({ message: "Bearer dsk_abc123" })).toBeUndefined();
    expect(codigoErroContrato(503)).toBe("hub_contract_unconfigured");
    expect(codigoErroContrato(403)).toBe("hub_contract_permission");
  });

  it("usa exclusivamente a origem e credencial cadastradas e não vaza erros remotos", async () => {
    saida.mockResolvedValueOnce({ ok: true, json: async () => ({ pronto: false }) });
    await expect(chamarApiContrato(servidor, "preparar", { aluguel: 1000 })).resolves.toEqual({ pronto: false });
    expect(saida).toHaveBeenCalledWith("https://hub.example/contrato/preparar", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer chave-privada" }), body: '{"aluguel":1000}',
    }));
    saida.mockResolvedValueOnce({ ok: false, status: 401, json: () => { throw new Error("CPF e segredo"); } });
    await expect(chamarApiContrato(servidor, "confirmar", {})).rejects.toMatchObject({
      name: "ErroApiContrato", codigo: "hub_contract_permission",
    });
    saida.mockResolvedValueOnce({
      ok: false, status: 503, json: async () => ({ message: "contrato não configurado" }),
    });
    await expect(chamarApiContrato(servidor, "preparar", {})).rejects.toEqual(expect.objectContaining({
      name: "ErroApiContrato", codigo: "hub_contract_unconfigured", detalhe: "contrato não configurado",
    }));
    await expect(chamarApiContrato({ ...servidor, endpoint: "https://hub.example/qualquer" }, "preparar", {}))
      .rejects.toBeInstanceOf(ErroApiContrato);
    expect(saida).toHaveBeenCalledTimes(3);
  });
});
