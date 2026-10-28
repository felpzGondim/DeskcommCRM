import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { executarFerramenta } from "./executar";
import {
  FERRAMENTAS_DO_PAINEL,
  NOMES_C_OU_S,
  ferramentaDoPainel,
} from "./registro";
import { nomesNoToolsetDoLoop } from "./loop";
import { ferramentasDoPainelLigadas } from "@/lib/painel/chave";
import { mascararPessoaNoTexto, temCpfCompleto } from "@/lib/painel/mascarar";
import type { ContextoDaFerramenta } from "./tipos";

const PROIBIDO_NO_NOME =
  /send_message|enviar_mensagem|enviar_ao_cliente|criar_boleto|gerar_boleto|alterar_boleto|enviar_boleto|escrever_super|gravar_super|update_super|delete_super|write_super/;

const ctxAgente: ContextoDaFerramenta = {
  orgId: "o",
  conversationId: "c",
  contactId: "p",
  userId: "u",
  requestId: "r",
  dbSessao: {} as never,
  admin: {} as never,
  settings: {},
  idioma: "pt-BR",
  origem: "agente",
};

describe("registro único do painel", () => {
  it("não tem ferramenta de escrita na Superlógica nem de envio ao cliente", () => {
    const sujas = FERRAMENTAS_DO_PAINEL.filter((f) => PROIBIDO_NO_NOME.test(f.nome));
    expect(sujas).toEqual([]);
    expect(FERRAMENTAS_DO_PAINEL.every((f) => f.nivel === "L" || f.nivel === "C" || f.nivel === "S")).toBe(true);
  });

  it("C e S existem no registro mas o loop do modelo não as coloca no ToolSet", () => {
    expect(NOMES_C_OU_S.sort()).toEqual([
      "aprovar_relatorio",
      "confirmar_cobranca_fc",
      "confirmar_contrato",
      "confirmar_renda",
      "iniciar_analise",
      "registrar_manual_fc",
      "registrar_manual_seguro",
      "revelar_cpf_manual",
    ]);
    const noLoop = nomesNoToolsetDoLoop();
    expect(noLoop).toContain("propor_acao");
    expect(noLoop).toContain("buscar_boletos");
    expect(noLoop).not.toContain("iniciar_analise");
    expect(noLoop).not.toContain("confirmar_contrato");
    expect(noLoop).not.toContain("confirmar_renda");
    expect(noLoop).not.toContain("analisar_renda");
    expect(noLoop).not.toContain("analisar_seguro");
    expect(noLoop).not.toContain("analisar_fc");
    expect(noLoop).not.toContain("confirmar_cobranca_fc");
    for (const nome of NOMES_C_OU_S) expect(noLoop).not.toContain(nome);
  });

  it("chave locacao.analise.renda desligada: analisar_renda some; ligada: entra no ToolSet mas confirmar_renda não", () => {
    expect(nomesNoToolsetDoLoop({})).not.toContain("analisar_renda");
    const ligada = nomesNoToolsetDoLoop({
      locacao: { processos_habilitado: true, analise: { renda: true } },
    });
    expect(ligada).toContain("analisar_renda");
    expect(ligada).not.toContain("confirmar_renda");
    expect(ligada).not.toContain("analisar_seguro");
  });

  it("chave locacao.analise.seguro desligada: analisar_seguro some; ligada: entra no ToolSet (L)", () => {
    expect(nomesNoToolsetDoLoop({})).not.toContain("analisar_seguro");
    expect(nomesNoToolsetDoLoop({})).not.toContain("status_seguro");
    const ligada = nomesNoToolsetDoLoop({
      locacao: { processos_habilitado: true, analise: { seguro: true } },
    });
    expect(ligada).toContain("analisar_seguro");
    expect(ligada).toContain("status_seguro");
    expect(ligada).not.toContain("iniciar_analise");
    expect(ligada).not.toContain("analisar_fc");
  });

  it("chave locacao.analise.fc desligada: analisar_fc some; ligada: L entra no ToolSet, confirmar não", () => {
    expect(nomesNoToolsetDoLoop({})).not.toContain("analisar_fc");
    expect(nomesNoToolsetDoLoop({})).not.toContain("status_fc");
    const ligada = nomesNoToolsetDoLoop({
      locacao: { processos_habilitado: true, analise: { fc: true } },
    });
    expect(ligada).toContain("analisar_fc");
    expect(ligada).toContain("status_fc");
    expect(ligada).not.toContain("confirmar_cobranca_fc");
    expect(ligada).not.toContain("analisar_seguro");
  });

  it("chave locacao.analise.manual desligada: preparar_manual some; ligada: L entra, S não", () => {
    expect(nomesNoToolsetDoLoop({})).not.toContain("preparar_manual");
    expect(nomesNoToolsetDoLoop({})).not.toContain("revelar_cpf_manual");
    const ligada = nomesNoToolsetDoLoop({
      locacao: { processos_habilitado: true, analise: { manual: true } },
    });
    expect(ligada).toContain("preparar_manual");
    expect(ligada).not.toContain("revelar_cpf_manual");
    expect(ligada).not.toContain("registrar_manual_fc");
    expect(ligada).not.toContain("registrar_manual_seguro");
  });

  it("chave locacao.analise.relatorio desligada: gerar_relatorio some; ligada: L entra, S não", () => {
    expect(nomesNoToolsetDoLoop({})).not.toContain("gerar_relatorio");
    expect(nomesNoToolsetDoLoop({})).not.toContain("aprovar_relatorio");
    const ligada = nomesNoToolsetDoLoop({
      locacao: { processos_habilitado: true, analise: { relatorio: true } },
    });
    expect(ligada).toContain("gerar_relatorio");
    expect(ligada).not.toContain("aprovar_relatorio");
  });

  it("o loop recusa executar C/S mesmo se alguém chamar a porta com origem agente", async () => {
    const r = await executarFerramenta("iniciar_analise", ctxAgente, {
      pedidoId: "00000000-0000-4000-8000-000000000001",
      previaToken: "x",
    });
    expect(r.ok).toBe(false);
    expect(r.texto).toMatch(/exige clique/);
    const s = await executarFerramenta("confirmar_contrato", ctxAgente, { token: "abc" });
    expect(s.ok).toBe(false);
    expect(s.texto).toMatch(/exige clique/);
    const fc = await executarFerramenta("confirmar_cobranca_fc", {
      ...ctxAgente,
      settings: { locacao: { processos_habilitado: true, analise: { fc: true } } },
    }, {});
    expect(fc.ok).toBe(false);
    expect(fc.texto).toMatch(/exige clique/);
  });

  it("confirmar_renda só com clique; chave desligada recusa analisar_renda sem chamar modelo", async () => {
    const off = await executarFerramenta("analisar_renda", ctxAgente, {});
    expect(off.ok).toBe(false);
    expect(off.texto).toMatch(/não está ligada/);
    const ctxChave: typeof ctxAgente = {
      ...ctxAgente,
      settings: { locacao: { processos_habilitado: true, analise: { renda: true } } },
    };
    const clique = await executarFerramenta("confirmar_renda", ctxChave, {});
    expect(clique.ok).toBe(false);
    expect(clique.texto).toMatch(/exige clique/);
    const ctxRel: typeof ctxAgente = {
      ...ctxAgente,
      settings: { locacao: { processos_habilitado: true, analise: { relatorio: true } } },
    };
    const aprovar = await executarFerramenta("aprovar_relatorio", ctxRel, {});
    expect(aprovar.ok).toBe(false);
    expect(aprovar.texto).toMatch(/exige clique/);
    const offRel = await executarFerramenta("gerar_relatorio", ctxAgente, {});
    expect(offRel.ok).toBe(false);
    expect(offRel.texto).toMatch(/não está ligada/);
  });

  it("botão e agente compartilham a mesma entrada do registro", () => {
    expect(ferramentaDoPainel("buscar_boletos")?.acaoDoBotao).toBe("boletos");
    expect(ferramentaDoPainel("consultar_contrato")?.acaoDoBotao).toBe("contrato");
    expect(ferramentaDoPainel("consultar_ficha")?.acaoDoBotao).toBe("ficha");
    expect(ferramentaDoPainel("resumir_conversa")?.acaoDoBotao).toBe("resumir");
    expect(ferramentaDoPainel("sugerir_resposta")?.acaoDoBotao).toBe("sugerir");
    expect(ferramentaDoPainel("iniciar_analise")?.acaoDoBotao).toBe("analise_confirmar");
    expect(ferramentaDoPainel("confirmar_contrato")?.acaoDoBotao).toBe("contrato_confirmar");
    expect(ferramentaDoPainel("analisar_renda")?.acaoDoBotao).toBe("analisar_renda");
    expect(ferramentaDoPainel("confirmar_renda")?.acaoDoBotao).toBe("confirmar_renda");
    expect(ferramentaDoPainel("analisar_renda")?.nivel).toBe("L");
    expect(ferramentaDoPainel("confirmar_renda")?.nivel).toBe("S");
    expect(ferramentaDoPainel("analisar_seguro")?.acaoDoBotao).toBe("analisar_seguro");
    expect(ferramentaDoPainel("status_seguro")?.acaoDoBotao).toBe("status_seguro");
    expect(ferramentaDoPainel("analisar_seguro")?.nivel).toBe("L");
    expect(ferramentaDoPainel("status_seguro")?.nivel).toBe("L");
    expect(ferramentaDoPainel("analisar_seguro")?.exigeChaveAnalise).toBe("seguro");
    expect(ferramentaDoPainel("analisar_fc")?.acaoDoBotao).toBe("analisar_fc");
    expect(ferramentaDoPainel("status_fc")?.acaoDoBotao).toBe("status_fc");
    expect(ferramentaDoPainel("confirmar_cobranca_fc")?.acaoDoBotao).toBe("confirmar_cobranca_fc");
    expect(ferramentaDoPainel("analisar_fc")?.nivel).toBe("L");
    expect(ferramentaDoPainel("status_fc")?.nivel).toBe("L");
    expect(ferramentaDoPainel("confirmar_cobranca_fc")?.nivel).toBe("S");
    expect(ferramentaDoPainel("analisar_fc")?.exigeChaveAnalise).toBe("fc");
    expect(ferramentaDoPainel("preparar_manual")?.acaoDoBotao).toBe("preparar_manual");
    expect(ferramentaDoPainel("revelar_cpf_manual")?.nivel).toBe("S");
    expect(ferramentaDoPainel("registrar_manual_fc")?.nivel).toBe("S");
    expect(ferramentaDoPainel("registrar_manual_seguro")?.nivel).toBe("S");
    expect(ferramentaDoPainel("preparar_manual")?.exigeChaveAnalise).toBe("manual");
    expect(ferramentaDoPainel("gerar_relatorio")?.acaoDoBotao).toBe("gerar_relatorio");
    expect(ferramentaDoPainel("aprovar_relatorio")?.acaoDoBotao).toBe("aprovar_relatorio");
    expect(ferramentaDoPainel("gerar_relatorio")?.nivel).toBe("L");
    expect(ferramentaDoPainel("aprovar_relatorio")?.nivel).toBe("S");
    expect(ferramentaDoPainel("gerar_relatorio")?.exigeChaveAnalise).toBe("relatorio");
    const seguroRota = readFileSync(
      "app/api/v1/conversations/[id]/painel-agente/seguro/route.ts",
      "utf8",
    );
    expect(seguroRota).toContain('executarFerramenta(ferramenta');
    expect(seguroRota).toContain('origem: "botao"');
    expect(seguroRota).not.toMatch(/["']Contratar["']/);
    expect(seguroRota).not.toMatch(/acao:\s*"fc_salvar"/);
    const fcRota = readFileSync(
      "app/api/v1/conversations/[id]/painel-agente/fc/route.ts",
      "utf8",
    );
    expect(fcRota).toContain('executarFerramenta(ferramenta');
    expect(fcRota).toContain('origem: "botao"');
    expect(fcRota).toContain("confirmar_cobranca_fc");
    expect(fcRota).not.toMatch(/valor_exibido/);
    expect(fcRota).not.toMatch(/R\$/);
    const rendaRota = readFileSync(
      "app/api/v1/conversations/[id]/painel-agente/renda/route.ts",
      "utf8",
    );
    expect(rendaRota).toContain('executarFerramenta("analisar_renda"');
    expect(rendaRota).toContain('executarFerramenta("confirmar_renda"');
    expect(rendaRota).toContain('origem: "botao"');
    const manualRota = readFileSync(
      "app/api/v1/conversations/[id]/painel-agente/manual/route.ts",
      "utf8",
    );
    expect(manualRota).toContain('executarFerramenta(ferramenta');
    expect(manualRota).toContain('origem: "botao"');
    expect(manualRota).toContain("revelar_cpf");
    expect(manualRota).not.toMatch(/confirmar-cobranca-fc|valor_exibido|R\$/);
    expect(manualRota).not.toMatch(/["']Contratar["']/);
    const relatorioRota = readFileSync(
      "app/api/v1/conversations/[id]/painel-agente/relatorio/route.ts",
      "utf8",
    );
    expect(relatorioRota).toContain('executarFerramenta("gerar_relatorio"');
    expect(relatorioRota).toContain('executarFerramenta("aprovar_relatorio"');
    expect(relatorioRota).toContain('origem: "botao"');
    expect(relatorioRota).not.toMatch(/alugue|Contratar|valor_exibido/);
    const acoes = appApiAcoes();
    expect(acoes).toContain("executarFerramenta");
    expect(acoes).toMatch(/boletos:\s*"buscar_boletos"/);
    expect(acoes).toContain('executarFerramenta("iniciar_analise"');
    expect(acoes).toContain('origem: "botao"');
  });

  it("chave desligada por padrão; a migration não liga nada", () => {
    expect(ferramentasDoPainelLigadas(undefined)).toBe(false);
    expect(ferramentasDoPainelLigadas({})).toBe(false);
    expect(ferramentasDoPainelLigadas({ painel_agente: {} })).toBe(false);
    expect(ferramentasDoPainelLigadas({ painel_agente: { ferramentas_habilitado: true } })).toBe(true);
    const mig = readFileSync("supabase/migrations/20261028150000_0769_agent_panel_query_log.sql", "utf8");
    expect(mig).not.toMatch(/ferramentas_habilitado['"]?\s*[:=]\s*true/);
    expect(mig).toMatch(/NÃO é ligada|NÃO liga/i);
  });

  it("máscara de CPF nunca deixa o número completo na saída", () => {
    const texto = mascararPessoaNoTexto("CPF 529.982.247-25 e 52998224725");
    expect(temCpfCompleto(texto)).toBe(false);
    expect(texto).not.toContain("529");
    const comEmail = mascararPessoaNoTexto("fale com ana@imobiliaria.com");
    expect(comEmail).not.toContain("ana@");
    expect(comEmail).toContain("[email]");
  });
});

function appApiAcoes(): string {
  return readFileSync("app/api/v1/conversations/[id]/painel-agente/acoes/route.ts", "utf8");
}
