import { describe, expect, it } from "vitest";

import { fichaVazia } from "@/lib/locacao/ficha-schema";
import {
  DIAS_REUSO_FC,
  TETO_LAUDO_BYTES,
  decodificarLaudo,
  lerResultadoDaCobranca,
  mapearEstadoHubFc,
  montarArgumentosFc,
  papelExigeCliqueHumano,
  pendenciaDoPayloadFc,
  pessoaDaFichaParaFc,
  resultadoDaFc,
  sanitizarResultadoFc,
} from "@/lib/locacao/analise/fc";
import { lerStatusDoHub } from "@/lib/locacao/analise/status-hub";
import { hashCpfDoParticipante } from "@/lib/locacao/cpf";

function fichaPronta() {
  const f = fichaVazia();
  f.pessoas[0]!.nome.valor = "Inquilino Teste";
  f.pessoas[0]!.cpf.valor = "52998224725";
  f.pessoas[0]!.email.valor = "inquilino@exemplo.com";
  f.pessoas[0]!.celular.valor = "11987654321";
  f.imovel.logradouro.valor = "Rua das Flores";
  f.imovel.numero.valor = "100";
  f.imovel.aluguel.valor = 2500;
  f.renda.mensal.valor = 8000;
  f.renda.proposta_fc.valor = 7500;
  return f;
}

describe("mapeamento da análise FC Score+", () => {
  it("recusa ficha incompleta sem ecoar PII", () => {
    const vazia = fichaVazia();
    const motivo = pendenciaDoPayloadFc(vazia, vazia.pessoas[0] ?? null, null);
    expect(motivo).toMatch(/celular|locatário|nome/i);
    expect(JSON.stringify(motivo)).not.toMatch(/@|529|1198/);
  });

  it("monta payload com pedido_id próprio e sem acao (acao entra fora)", () => {
    const ficha = fichaPronta();
    const pessoa = pessoaDaFichaParaFc(ficha)!;
    const r = montarArgumentosFc({
      ficha,
      pessoa,
      pedidoId: "00000000-0000-4000-8000-000000000099",
      conversaId: "conv-1",
      orgId: "org-1",
      telefone: "11987654321",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.argumentos.pedido_id).toBe("00000000-0000-4000-8000-000000000099");
    expect(r.argumentos.renda.mensal).toBe(7500);
    expect(r.argumentos).not.toHaveProperty("acao");
    expect(JSON.stringify(r.argumentos.candidato.cpf)).toBe(JSON.stringify("52998224725"));
  });

  it("casa a pessoa da ficha pelo hash do CPF sem devolver o número", () => {
    const ficha = fichaPronta();
    const hash = hashCpfDoParticipante("52998224725");
    const pessoa = pessoaDaFichaParaFc(ficha, { cpfHash: hash });
    expect(pessoa?.nome.valor).toBe("Inquilino Teste");
    expect(hash).not.toMatch(/529/);
  });

  it("reuso é 90 dias", () => {
    expect(DIAS_REUSO_FC).toBe(90);
  });

  it("fiador e solidário exigem clique humano; locatário não", () => {
    expect(papelExigeCliqueHumano("fiador")).toBe(true);
    expect(papelExigeCliqueHumano("solidario")).toBe(true);
    expect(papelExigeCliqueHumano("locatario")).toBe(false);
    expect(papelExigeCliqueHumano("contato")).toBe(false);
  });

  it("estado do Hub da FC mapeia para o vocabulário do CRM", () => {
    expect(mapearEstadoHubFc("fc_salvo_pendente")).toBe("aguardando_cobranca");
    expect(mapearEstadoHubFc("aguardando_cobranca_fc")).toBe("aguardando_cobranca");
    expect(mapearEstadoHubFc("fc_processado")).toBe("cobrando");
    expect(mapearEstadoHubFc("concluido")).toBe("concluida");
    expect(mapearEstadoHubFc("login_necessario")).toBe("login_necessario");
    expect(mapearEstadoHubFc("algo_novo")).toBe("solicitada");
  });

  it("resultado persiste score/risco/id_fc e descarta PII", () => {
    const status = lerStatusDoHub({
      estado: "concluida",
      fc: { score: 712, risco: "moderado", id_fc: "FC-9", laudo_disponivel: true },
      cpf: "52998224725",
      nome: "Ana",
    });
    const resultado = resultadoDaFc(status);
    expect(resultado.score).toBe(712);
    expect(resultado.risco).toBe("moderado");
    expect(resultado.id_fc).toBe("FC-9");
    expect(JSON.stringify(resultado)).not.toMatch(/529|Ana|@/);
    const reuso = sanitizarResultadoFc({
      score: 712,
      risco: "moderado",
      cpf: "52998224725",
      email: "ana@exemplo.com",
      cobranca: "ja_cobrado",
    });
    expect(reuso.cobranca).toBe("ja_cobrado");
    expect(JSON.stringify(reuso)).not.toMatch(/529|ana@/);
  });

  it("laudo em base64 até 2 MB; acima disso recusa", () => {
    const ok = Buffer.from("%PDF-fake");
    const r = decodificarLaudo({ bytes_b64: ok.toString("base64"), mime: "application/pdf" });
    expect(r?.bytes.equals(ok)).toBe(true);
    expect(r?.ext).toBe("pdf");
    expect(decodificarLaudo({ url: "https://hub.exemplo/laudo.pdf" })).toBeNull();
    const grande = Buffer.alloc(TETO_LAUDO_BYTES + 1, 1);
    expect(decodificarLaudo({ laudo_b64: grande.toString("base64") })).toBeNull();
  });

  it("cobrança do Hub: ja_cobrado, cobranca_incerta e login_necessario", () => {
    expect(lerResultadoDaCobranca({ resultado: "ja_cobrado" }).tipo).toBe("ja_cobrado");
    expect(lerResultadoDaCobranca({ resultado: "cobranca_incerta" }).tipo).toBe("cobranca_incerta");
    expect(lerResultadoDaCobranca({ resultado: "login_necessario" }).tipo).toBe("login_necessario");
    expect(lerResultadoDaCobranca({ resultado: "aceito", job_id: "j1" })).toEqual({
      tipo: "ok",
      estado: "aceito",
      job_id: "j1",
    });
    expect(lerResultadoDaCobranca({ resultado: "nao" }).tipo).toBe("erro");
  });
});
