import { describe, expect, it, vi } from "vitest";

import {
  autorizarDelegacaoEmpresarial,
  type PedidoDelegado,
} from "./delegacao-empresarial";
import {
  entradaDelegadaExternaSchema,
  executarLeituraDelegada,
  pedidoDelegadoDesligado,
} from "./delegacao-empresarial-leitura";

const ORG = "11111111-1111-4111-8111-111111111111";
const CONV = "aaaaaaaa-1111-4111-8111-111111111111";
const USER = "dddddddd-1111-4111-8111-111111111111";

function base(parcial: Partial<PedidoDelegado> = {}): PedidoDelegado {
  return {
    ativacao: { ativa: true, contratoAprovado: true },
    ator: { type: "user", id: USER },
    clienteEhServiceRole: false,
    organizationIdDoAtor: ORG,
    organizationIdDoRecurso: ORG,
    conversaAutorizadaParaOUsuario: true,
    contatoEhPessoal: false,
    classificacaoDaSessao: "corporativa",
    efeito: "baixar",
    anexo: { conversaIdDoPedido: CONV, conversaIdDoAnexo: CONV },
    ...parcial,
  };
}

describe("executarLeituraDelegada não toca storage/provedor na recusa", () => {
  it("ativação desligada não busca, não lê, não assina", async () => {
    const buscar = vi.fn(async () => [{ id: CONV }]);
    const ler = vi.fn(async () => ({ body: "segredo" }));
    const baixarAssinar = vi.fn(async () => ({ url: "https://storage.example/x" }));
    const baixarProvedor = vi.fn(async () => ({ bytes: 1 }));
    const r = await executarLeituraDelegada(pedidoDelegadoDesligado(base()), {
      buscar,
      ler,
      baixarAssinar,
      baixarProvedor,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("integracao_nao_ativada");
    expect(buscar).not.toHaveBeenCalled();
    expect(ler).not.toHaveBeenCalled();
    expect(baixarAssinar).not.toHaveBeenCalled();
    expect(baixarProvedor).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).not.toMatch(/segredo|storage\.example/i);
  });

  it("contato pessoal não assina nem busca no provedor", async () => {
    const baixarAssinar = vi.fn(async () => ({ url: "https://storage.example/x" }));
    const baixarProvedor = vi.fn(async () => ({ bytes: 1 }));
    const r = await executarLeituraDelegada(base({ contatoEhPessoal: true }), {
      baixarAssinar,
      baixarProvedor,
    });
    expect(r).toMatchObject({ ok: false, motivo: "contato_pessoal" });
    expect(baixarAssinar).not.toHaveBeenCalled();
    expect(baixarProvedor).not.toHaveBeenCalled();
  });

  it("sessão não classificada não assina", async () => {
    const baixarAssinar = vi.fn(async () => ({ url: "https://storage.example/x" }));
    const r = await executarLeituraDelegada(
      base({ classificacaoDaSessao: "nao_classificada" }),
      { baixarAssinar },
    );
    expect(r).toMatchObject({ ok: false, motivo: "sessao_nao_classificada" });
    expect(baixarAssinar).not.toHaveBeenCalled();
  });

  it("anexo de outra conversa não assina", async () => {
    const baixarAssinar = vi.fn(async () => ({ url: "https://storage.example/x" }));
    const r = await executarLeituraDelegada(
      base({
        anexo: {
          conversaIdDoPedido: CONV,
          conversaIdDoAnexo: "aaaaaaaa-9999-4111-8111-111111111111",
        },
      }),
      { baixarAssinar },
    );
    expect(r).toMatchObject({ ok: false, motivo: "anexo_fora_do_recurso" });
    expect(baixarAssinar).not.toHaveBeenCalled();
  });

  it("caso corporativo autorizado chama só o efeito pedido", async () => {
    const buscar = vi.fn(async () => [{ id: CONV }]);
    const ler = vi.fn(async () => ({ id: CONV }));
    const baixarAssinar = vi.fn(async () => ({ url: "https://storage.test/ok" }));
    const r = await executarLeituraDelegada(base({ efeito: "baixar" }), {
      buscar,
      ler,
      baixarAssinar,
    });
    expect(r).toMatchObject({ ok: true, efeito: "baixar" });
    expect(baixarAssinar).toHaveBeenCalledTimes(1);
    expect(buscar).not.toHaveBeenCalled();
    expect(ler).not.toHaveBeenCalled();
  });
});

describe("entrada externa", () => {
  it("Zod recusa efeito de escrita", () => {
    expect(
      entradaDelegadaExternaSchema.safeParse({
        conversation_id: CONV,
        efeito: "enviar",
      }).success,
    ).toBe(false);
  });

  it("pedido desligado usa o guarda e recusa", () => {
    const d = autorizarDelegacaoEmpresarial(
      pedidoDelegadoDesligado({
        ator: { type: "user", id: USER },
        clienteEhServiceRole: false,
        organizationIdDoAtor: ORG,
        organizationIdDoRecurso: ORG,
        conversaAutorizadaParaOUsuario: true,
        contatoEhPessoal: false,
        efeito: "ler",
      }),
    );
    expect(d).toEqual({ ok: false, motivo: "integracao_nao_ativada" });
  });
});
