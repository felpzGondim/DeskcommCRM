import { describe, expect, it } from "vitest";

import fs from "node:fs";
import path from "node:path";

import { allTools } from "@/lib/mcp/tools";
import { TOOL_CATALOG } from "@/lib/mcp/tools/catalog";

import {
  ATIVACAO_DELEGADA_PADRAO,
  ENTITLEMENTS_VISIBILIDADE_CONCEDIDOS,
  ENTITLEMENT_VISIBILIDADE_PADRAO,
  FERRAMENTAS_DELEGADAS_PROPOSTAS,
  VISIBILIDADE_CONVERSA_ALVO,
  autorizarDelegacaoEmpresarial,
  classificacaoDeSessaoNaoDisponivel,
  reciboAuditoriaDelegada,
  type PedidoDelegado,
} from "./delegacao-empresarial";

const ORG = "11111111-1111-4111-8111-111111111111";
const OUTRA = "22222222-2222-4222-8222-222222222222";
const CONV = "aaaaaaaa-1111-4111-8111-111111111111";
const OUTRA_CONV = "aaaaaaaa-2222-4222-8222-222222222222";
const PROC = "cccccccc-1111-4111-8111-111111111111";
const USER = "dddddddd-1111-4111-8111-111111111111";

function corporativo(parcial: Partial<PedidoDelegado> = {}): PedidoDelegado {
  return {
    ativacao: { ativa: true, contratoAprovado: true },
    ator: { type: "user", id: USER },
    clienteEhServiceRole: false,
    organizationIdDoAtor: ORG,
    organizationIdDoRecurso: ORG,
    visibilidadeDaConversa: VISIBILIDADE_CONVERSA_ALVO,
    entitlementDeVisibilidade: ENTITLEMENT_VISIBILIDADE_PADRAO,
    conversaAutorizadaParaOUsuario: true,
    contatoEhPessoal: false,
    classificacaoDaSessao: "corporativa",
    chatPrivadoDoBot: false,
    efeito: "ler",
    anexo: {
      conversaIdDoPedido: CONV,
      conversaIdDoAnexo: CONV,
      processoIdDoPedido: PROC,
      processoIdDoAnexo: PROC,
    },
    ...parcial,
  };
}

describe("autorizarDelegacaoEmpresarial — fail closed", () => {
  it("alvo D3/D5 preenchido ainda recusa: entitlement corporativo não está concedido", () => {
    expect(VISIBILIDADE_CONVERSA_ALVO).toBe("todas_conversas_corporativas_da_org");
    expect(ENTITLEMENTS_VISIBILIDADE_CONCEDIDOS).toEqual([]);
    const r = autorizarDelegacaoEmpresarial(corporativo({ efeito: "buscar" }));
    expect(r).toEqual({ ok: false, motivo: "visibilidade_nao_ativada" });
    const baixar = autorizarDelegacaoEmpresarial(corporativo({ efeito: "baixar" }));
    expect(baixar).toEqual({ ok: false, motivo: "visibilidade_nao_ativada" });
  });

  it("ativação padrão recusa mesmo com o resto perfeito", () => {
    const r = autorizarDelegacaoEmpresarial(corporativo({ ativacao: ATIVACAO_DELEGADA_PADRAO }));
    expect(r).toEqual({ ok: false, motivo: "integracao_nao_ativada" });
  });

  it("contrato não aprovado recusa", () => {
    const r = autorizarDelegacaoEmpresarial(
      corporativo({ ativacao: { ativa: true, contratoAprovado: false } }),
    );
    expect(r).toEqual({ ok: false, motivo: "integracao_nao_ativada" });
  });

  it("token de organização não prova identidade individual", () => {
    const r = autorizarDelegacaoEmpresarial(
      corporativo({ ator: { type: "api_token", id: "tok" } }),
    );
    expect(r).toEqual({ ok: false, motivo: "identidade_nao_provada" });
  });

  it("cliente administrative (service role) não substitui a pessoa", () => {
    const r = autorizarDelegacaoEmpresarial(corporativo({ clienteEhServiceRole: true }));
    expect(r).toEqual({ ok: false, motivo: "identidade_nao_provada" });
  });

  it("usuário sem id recusa", () => {
    const r = autorizarDelegacaoEmpresarial(corporativo({ ator: { type: "user", id: "  " } }));
    expect(r).toEqual({ ok: false, motivo: "identidade_nao_provada" });
  });

  it("organização errada recusa", () => {
    const r = autorizarDelegacaoEmpresarial(corporativo({ organizationIdDoAtor: OUTRA }));
    expect(r).toEqual({ ok: false, motivo: "org_nao_autorizada" });
  });

  it("conversa fora da autorização individual recusa", () => {
    const r = autorizarDelegacaoEmpresarial(
      corporativo({ conversaAutorizadaParaOUsuario: false }),
    );
    expect(r).toEqual({ ok: false, motivo: "conversa_nao_autorizada" });
  });

  it("contato pessoal recusa", () => {
    const r = autorizarDelegacaoEmpresarial(corporativo({ contatoEhPessoal: true }));
    expect(r).toEqual({ ok: false, motivo: "contato_pessoal" });
  });

  it("sessão pessoal recusa", () => {
    const r = autorizarDelegacaoEmpresarial(
      corporativo({ classificacaoDaSessao: "pessoal" }),
    );
    expect(r).toEqual({ ok: false, motivo: "sessao_pessoal" });
  });

  it("sessão não classificada recusa — não assume corporativa", () => {
    expect(classificacaoDeSessaoNaoDisponivel()).toBe("nao_classificada");
    const r = autorizarDelegacaoEmpresarial(
      corporativo({ classificacaoDaSessao: classificacaoDeSessaoNaoDisponivel() }),
    );
    expect(r).toEqual({ ok: false, motivo: "sessao_nao_classificada" });
  });

  it("mídia de outra conversa recusa no download", () => {
    const r = autorizarDelegacaoEmpresarial(
      corporativo({
        efeito: "baixar",
        anexo: {
          conversaIdDoPedido: CONV,
          conversaIdDoAnexo: OUTRA_CONV,
        },
      }),
    );
    expect(r).toEqual({ ok: false, motivo: "anexo_fora_do_recurso" });
  });

  it("documento de outro processo recusa no download", () => {
    const r = autorizarDelegacaoEmpresarial(
      corporativo({
        efeito: "baixar",
        anexo: {
          conversaIdDoPedido: CONV,
          conversaIdDoAnexo: CONV,
          processoIdDoPedido: PROC,
          processoIdDoAnexo: "ffffffff-1111-4111-8111-111111111111",
        },
      }),
    );
    expect(r).toEqual({ ok: false, motivo: "anexo_fora_do_recurso" });
  });

  it("chat privado do bot recusa, inclusive quando não provado", () => {
    expect(
      autorizarDelegacaoEmpresarial(corporativo({ chatPrivadoDoBot: true })),
    ).toEqual({ ok: false, motivo: "chat_privado_do_bot" });
    expect(
      autorizarDelegacaoEmpresarial(corporativo({ chatPrivadoDoBot: "nao_provado" })),
    ).toEqual({ ok: false, motivo: "chat_privado_do_bot" });
  });

  it("escrever ou enviar não é efeito da integração", () => {
    expect(autorizarDelegacaoEmpresarial(corporativo({ efeito: "enviar" }))).toEqual({
      ok: false,
      motivo: "efeito_nao_permitido",
    });
    expect(autorizarDelegacaoEmpresarial(corporativo({ efeito: "escrever" }))).toEqual({
      ok: false,
      motivo: "efeito_nao_permitido",
    });
  });
});

describe("auditoria delegada não leva conteúdo", () => {
  it("descarta corpo, preview, path e URL", () => {
    const r = reciboAuditoriaDelegada({
      motivo: "contato_pessoal",
      efeito: "baixar",
      organization_id: ORG,
      conversation_id: CONV,
      body: "RG do candidato",
      last_message_preview: "segue o comprovante",
      media_storage_path: `${ORG}/segredo.pdf`,
      signedUrl: "https://storage.example/x",
      phone: "11999999999",
    });
    expect(r).toEqual({
      motivo: "contato_pessoal",
      efeito: "baixar",
      organization_id: ORG,
      conversation_id: CONV,
    });
    expect(JSON.stringify(r)).not.toMatch(/comprovante|segredo|signedUrl|11999/i);
  });
});

describe("ferramentas propostas não estão no MCP servido", () => {
  it("nenhum nome candidato está em allTools nem no catálogo", () => {
    const servidas = new Set(allTools.map((t) => t.name));
    const catalogo = new Set(TOOL_CATALOG.map((t) => t.name));
    expect(FERRAMENTAS_DELEGADAS_PROPOSTAS).toEqual([
      "crm_search_corporate_conversations",
      "crm_read_corporate_conversation",
      "crm_download_corporate_attachment",
    ]);
    for (const nome of FERRAMENTAS_DELEGADAS_PROPOSTAS) {
      expect(servidas.has(nome)).toBe(false);
      expect(catalogo.has(nome)).toBe(false);
    }
  });

  it("histórico MCP sem contato do turno não ganha bypass delegado", () => {
    const fonte = fs.readFileSync(
      path.join(process.cwd(), "lib", "mcp", "tools", "conversations.ts"),
      "utf8",
    );
    expect(fonte).toMatch(/crmGetConversationHistory/);
    expect(fonte).not.toMatch(/autorizarDelegacaoEmpresarial/);
    expect(fonte).toMatch(/if \(ctx\.contatoDoTurno\)/);
    const historico = allTools.find((t) => t.name === "crm_get_conversation_history");
    expect(historico?.requiresScope).toBe("mcp:read");
    expect(historico?.requiresRole).toBe("agent");
  });
});
