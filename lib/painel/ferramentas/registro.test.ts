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
    expect(NOMES_C_OU_S.sort()).toEqual(["confirmar_contrato", "iniciar_analise"]);
    const noLoop = nomesNoToolsetDoLoop();
    expect(noLoop).toContain("propor_acao");
    expect(noLoop).toContain("buscar_boletos");
    expect(noLoop).not.toContain("iniciar_analise");
    expect(noLoop).not.toContain("confirmar_contrato");
    for (const nome of NOMES_C_OU_S) expect(noLoop).not.toContain(nome);
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
  });

  it("botão e agente compartilham a mesma entrada do registro", () => {
    expect(ferramentaDoPainel("buscar_boletos")?.acaoDoBotao).toBe("boletos");
    expect(ferramentaDoPainel("consultar_contrato")?.acaoDoBotao).toBe("contrato");
    expect(ferramentaDoPainel("consultar_ficha")?.acaoDoBotao).toBe("ficha");
    expect(ferramentaDoPainel("resumir_conversa")?.acaoDoBotao).toBe("resumir");
    expect(ferramentaDoPainel("sugerir_resposta")?.acaoDoBotao).toBe("sugerir");
    expect(ferramentaDoPainel("iniciar_analise")?.acaoDoBotao).toBe("analise_confirmar");
    expect(ferramentaDoPainel("confirmar_contrato")?.acaoDoBotao).toBe("contrato_confirmar");
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
  });
});

function appApiAcoes(): string {
  return readFileSync("app/api/v1/conversations/[id]/painel-agente/acoes/route.ts", "utf8");
}
