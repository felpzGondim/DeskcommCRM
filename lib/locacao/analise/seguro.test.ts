import { describe, expect, it } from "vitest";

import {
  TETO_PRINT_BYTES,
  decodificarPrint,
  lerStatusDoHub,
  mapearEstadoHub,
  montarArgumentosSeguro,
  pendenciaDoPayloadSeguro,
  resultadoDaCotacao,
  sanitizarCards,
} from "@/lib/locacao/analise/seguro";
import { fichaVazia } from "@/lib/locacao/ficha-schema";
import { valoresVazios, type ValoresDoImovel } from "@/lib/locacao/valores-imovel";

function valoresProntos(): ValoresDoImovel {
  const v = valoresVazios();
  v.aluguel = { valor: 2000, origem: "conversa", editado_por: null, editado_em: null };
  v.condominio = { valor: 500, origem: "conversa", editado_por: null, editado_em: null };
  v.iptu = { valor: 200, origem: "conversa", editado_por: null, editado_em: null };
  v.seguro_incendio = { valor: 80, origem: "conversa", editado_por: null, editado_em: null };
  return v;
}

function fichaPronta() {
  const f = fichaVazia();
  f.pessoas[0]!.nome.valor = "Inquilino Teste";
  f.pessoas[0]!.cpf.valor = "52998224725";
  f.pessoas[0]!.email.valor = "inquilino@exemplo.com";
  f.pessoas[0]!.celular.valor = "11987654321";
  f.imovel.logradouro.valor = "Rua das Flores";
  f.imovel.numero.valor = "100";
  f.imovel.complemento.valor = "ap 12";
  f.imovel.aluguel.valor = 2500;
  f.renda.mensal.valor = 8000;
  f.renda.proposta_fc.valor = 7500; // legado ignorado se RENDA mensal já estiver preenchida
  return f;
}

describe("mapeamento da cotação de seguro-fiança", () => {
  it("recusa ficha incompleta sem ecoar PII", () => {
    const vazia = fichaVazia();
    const motivo = pendenciaDoPayloadSeguro(vazia, null, valoresVazios());
    expect(motivo).toMatch(/celular/);
    expect(JSON.stringify(motivo)).not.toMatch(/@|529|1198/);
  });

  it("monta payload com acao de fora e pedido_id próprio", () => {
    const ficha = fichaPronta();
    const r = montarArgumentosSeguro({
      ficha,
      pedidoId: "00000000-0000-4000-8000-000000000099",
      conversaId: "conv-1",
      orgId: "org-1",
      telefone: "11987654321",
      valores: valoresProntos(),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.argumentos.pedido_id).toBe("00000000-0000-4000-8000-000000000099");
    expect(r.argumentos.renda.mensal).toBe(8000);
    expect(r.argumentos).not.toHaveProperty("acao");
    expect(r.argumentos).not.toHaveProperty("vigencia");
    expect(r.argumentos).not.toHaveProperty("solidarios");
  });

  it("recusa sem IPTU apontando o campo; fiança ausente não bloqueia", () => {
    const ficha = fichaPronta();
    const valores = valoresProntos();
    valores.iptu = { valor: null, origem: null, editado_por: null, editado_em: null };
    const motivo = pendenciaDoPayloadSeguro(ficha, "11987654321", valores);
    expect(motivo).toMatch(/IPTU/);
    valores.iptu = { valor: 200, origem: "conversa", editado_por: null, editado_em: null };
    valores.seguro_fianca = { valor: null, origem: null, editado_por: null, editado_em: null };
    const ok = montarArgumentosSeguro({
      ficha,
      pedidoId: "00000000-0000-4000-8000-000000000099",
      conversaId: "conv-1",
      orgId: "org-1",
      telefone: "11987654321",
      valores,
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.argumentos.imovel.aluguel).toBe(2000);
  });

  it("sem renda comprovada recusa e não inventa valor", () => {
    const ficha = fichaPronta();
    ficha.renda.mensal.valor = null;
    ficha.renda.proposta_fc.valor = null;
    const motivo = pendenciaDoPayloadSeguro(ficha, "11987654321", valoresProntos());
    expect(motivo).toMatch(/renda/i);
    const r = montarArgumentosSeguro({
      ficha,
      pedidoId: "00000000-0000-4000-8000-000000000099",
      conversaId: "conv-1",
      orgId: "org-1",
      telefone: "11987654321",
      valores: valoresProntos(),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toMatch(/renda/i);
  });

  it("estado desconhecido do Hub permanece cotando", () => {
    expect(mapearEstadoHub("migra_cotando")).toBe("cotando");
    expect(mapearEstadoHub("concluido")).toBe("concluida");
    expect(mapearEstadoHub("login_necessario")).toBe("login_necessario");
    expect(mapearEstadoHub("algo_novo")).toBe("cotando");
    expect(mapearEstadoHub(null)).toBe("cotando");
  });

  it("resultado da cotação e cards descartam score/risco mesmo quando o status os tem", () => {
    const status = lerStatusDoHub({
      estado: "concluida",
      cards: [{ seguradora: "X", score: 800, risco: "alto", cpf: "52998224725", nome: "Ana" }],
      print_disponivel: true,
      job_id: "job-1",
      score: 712,
      risco: "moderado",
    });
    expect(status.score).toBe(712);
    expect(status.risco).toBe("moderado");
    const cards = sanitizarCards(status.cards);
    expect(JSON.stringify(cards)).not.toMatch(/score|risco|529|Ana/);
    const resultado = resultadoDaCotacao(status);
    expect(resultado).not.toHaveProperty("score");
    expect(resultado).not.toHaveProperty("risco");
  });

  it("print em base64 até 2 MB; acima disso recusa", () => {
    const ok = Buffer.from("png-fake");
    const r = decodificarPrint({ bytes_b64: ok.toString("base64"), mime: "image/png" });
    expect(r?.bytes.equals(ok)).toBe(true);
    expect(r?.ext).toBe("png");
    expect(decodificarPrint({ url: "https://hub.exemplo/print.png" })).toBeNull();
    const grande = Buffer.alloc(TETO_PRINT_BYTES + 1, 1);
    expect(decodificarPrint({ print_b64: grande.toString("base64") })).toBeNull();
  });
});
