import { describe, expect, it } from "vitest";

import {
  aplicarEdicaoManual,
  campoFoiManual,
  categoriaPeloTextoDerivado,
  classificacaoPrecisaPersistir,
  classificarAnexoDaConversa,
  locatarioPrincipal,
  participanteDaPessoa,
  sinaisDaFicha,
  unicoCandidato,
  type ParticipanteParaClassificar,
} from "./classificar-documento";
import { fichaVazia, pessoaVazia, type FichaPreliminar } from "./ficha-schema";

const MSG_RENDA = "11111111-1111-4111-8111-111111111111";
const MSG_RG = "22222222-2222-4222-8222-222222222222";
const MSG_CPF = "33333333-3333-4333-8333-333333333333";
const MSG_OUTRO = "44444444-4444-4444-8444-444444444444";
const LOC = "55555555-5555-4555-8555-555555555555";
const FIADOR = "66666666-6666-4666-8666-666666666666";
const CONTATO = "77777777-7777-4777-8777-777777777777";

const locatario: ParticipanteParaClassificar = {
  id: LOC, papel: "locatario", principal: true, cpf_hash: "hash-loc",
};
const fiador: ParticipanteParaClassificar = {
  id: FIADOR, papel: "fiador", principal: false, cpf_hash: "hash-fia",
};
const contato: ParticipanteParaClassificar = {
  id: CONTATO, papel: "contato", principal: false,
};

function fichaCom(sinais: {
  renda?: string;
  rg?: string;
  cpf?: string;
  encontrado?: { tipo: string; fonte?: string | null; message_id: string };
  rendaDaPessoa?: string;
}): FichaPreliminar {
  const ficha = fichaVazia();
  const inquilino = {
    ...pessoaVazia("inquilino"),
    principal: true,
    cpf: { ...pessoaVazia().cpf, message_id: sinais.cpf ?? null },
    rg: { ...pessoaVazia().rg, message_id: sinais.rg ?? null },
    renda_individual: {
      ...pessoaVazia().renda_individual,
      message_id: sinais.rendaDaPessoa ?? null,
    },
  };
  return {
    ...ficha,
    pessoas: [inquilino],
    renda: {
      ...ficha.renda,
      documentos: sinais.renda
        ? [{
          fonte: "M1", tipo: "holerite" as const, periodo: null, resumo: "folha",
          valor_comprovado: null, message_id: sinais.renda,
        }]
        : [],
    },
    documentos: {
      encontrados: sinais.encontrado ? [{ fonte: null, ...sinais.encontrado }] : [],
      faltantes: [],
    },
  };
}

describe("único candidato e locatário principal", () => {
  it("ignora quem só conversa e escolhe o único candidato", () => {
    expect(unicoCandidato([contato, locatario])).toBe(LOC);
    expect(unicoCandidato([contato])).toBe(CONTATO);
    expect(unicoCandidato([locatario, fiador])).toBeNull();
  });

  it("renda sem dono cai no locatário principal", () => {
    expect(locatarioPrincipal([contato, locatario, fiador])).toBe(LOC);
    expect(locatarioPrincipal([fiador])).toBe(FIADOR);
  });
});

describe("sinais da ficha sem dado pessoal", () => {
  it("arquivo da análise de renda vira comprovante do locatário", () => {
    const sinais = sinaisDaFicha(fichaCom({ renda: MSG_RENDA }), [contato, locatario]);
    expect(sinais).toEqual([{
      message_id: MSG_RENDA,
      categoria: "comprovante_renda",
      participante_id: LOC,
    }]);
  });

  it("CPF ou RG extraídos viram documento pessoal daquela pessoa", () => {
    const sinais = sinaisDaFicha(fichaCom({ cpf: MSG_CPF, rg: MSG_RG }), [locatario]);
    expect(sinais).toEqual(expect.arrayContaining([
      { message_id: MSG_CPF, categoria: "documento_pessoal", participante_id: LOC },
      { message_id: MSG_RG, categoria: "documento_pessoal", participante_id: LOC },
    ]));
  });

  it("renda vence identificação no mesmo arquivo", () => {
    const sinais = sinaisDaFicha(fichaCom({ renda: MSG_RENDA, cpf: MSG_RENDA }), [locatario]);
    expect(sinais).toEqual([{
      message_id: MSG_RENDA,
      categoria: "comprovante_renda",
      participante_id: LOC,
    }]);
  });

  it("casa a pessoa pelo hash, não pelo papel solto", () => {
    expect(participanteDaPessoa(
      { ...pessoaVazia("inquilino"), principal: true, cpf_hash: "hash-fia" },
      [locatario, fiador],
    )).toBe(FIADOR);
  });

  it("encontrado do tipo extrato entra como renda do locatário", () => {
    const sinais = sinaisDaFicha(
      fichaCom({ encontrado: { tipo: "extrato", message_id: MSG_OUTRO } }),
      [locatario],
    );
    expect(sinais).toEqual([{
      message_id: MSG_OUTRO,
      categoria: "comprovante_renda",
      participante_id: LOC,
    }]);
  });
});

describe("casa pessoa ao participante sem valor de documento", () => {
  it("inquilino principal casa com locatário principal", () => {
    expect(participanteDaPessoa(pessoaVazia("inquilino"), [contato, locatario, fiador])).toBe(LOC);
  });

  it("fiador casa com o fiador", () => {
    expect(participanteDaPessoa(pessoaVazia("fiador"), [locatario, fiador])).toBe(FIADOR);
  });
});

describe("texto já extraído, sem chamada nova", () => {
  it("holerite e extrato são renda; RG/CNH são documento pessoal", () => {
    expect(categoriaPeloTextoDerivado("folha.pdf", "HOLERITE competencia")).toBe("comprovante_renda");
    expect(categoriaPeloTextoDerivado("banco.pdf", "EXTRATO conta corrente")).toBe("comprovante_renda");
    expect(categoriaPeloTextoDerivado("foto.jpg", "REGISTRO GERAL")).toBe("documento_pessoal");
    expect(categoriaPeloTextoDerivado("cnh.png", "CARTEIRA NACIONAL DE HABILITACAO")).toBe("documento_pessoal");
  });

  it("renda vence quando o mesmo texto cita os dois", () => {
    expect(categoriaPeloTextoDerivado("folha.pdf", "HOLERITE e registro geral")).toBe("comprovante_renda");
  });

  it("não classifica descrição genérica nem o nome solto de um campo", () => {
    expect(categoriaPeloTextoDerivado("foto.jpg", "parece um documento")).toBeNull();
    expect(categoriaPeloTextoDerivado("anexo.pdf", "")).toBeNull();
  });
});

describe("classificar e preservar escolha humana", () => {
  it("grava renda e o único candidato quando não há escolha", () => {
    const sinais = sinaisDaFicha(fichaCom({ renda: MSG_RENDA }), [locatario]);
    expect(classificarAnexoDaConversa({
      messageId: MSG_RENDA, salva: null, sinais, participantes: [locatario],
    })).toMatchObject({
      categoria: "comprovante_renda",
      participante_id: LOC,
      categoria_origem: "automatico",
      participante_origem: "automatico",
    });
  });

  it("com um só candidato, seleciona mesmo sem categoria", () => {
    expect(classificarAnexoDaConversa({
      messageId: MSG_OUTRO, salva: null, sinais: [], participantes: [locatario],
    })).toMatchObject({
      categoria: "outro",
      participante_id: LOC,
      participante_origem: "automatico",
    });
  });

  it("com dois candidatos e sem sinal, não inventa participante", () => {
    expect(classificarAnexoDaConversa({
      messageId: MSG_OUTRO, salva: null, sinais: [], participantes: [locatario, fiador],
    })).toMatchObject({
      categoria: "outro",
      participante_id: null,
    });
  });

  it("texto derivado preenche categoria sem apagar o único candidato", () => {
    expect(classificarAnexoDaConversa({
      messageId: MSG_OUTRO, salva: null, sinais: [], participantes: [locatario],
      categoriaDoTexto: "documento_pessoal",
    })).toMatchObject({
      categoria: "documento_pessoal",
      participante_id: LOC,
      categoria_origem: "automatico",
    });
  });

  it("não sobrescreve categoria nem participante manuais", () => {
    const sinais = sinaisDaFicha(fichaCom({ renda: MSG_RENDA }), [locatario]);
    expect(classificarAnexoDaConversa({
      messageId: MSG_RENDA,
      salva: {
        categoria: "outro",
        participante_id: null,
        categoria_origem: "manual",
        participante_origem: "manual",
      },
      sinais,
      participantes: [locatario],
    })).toMatchObject({
      categoria: "outro",
      participante_id: null,
      categoria_origem: "manual",
      participante_origem: "manual",
    });
  });

  it("legado sem origem conta como manual", () => {
    expect(campoFoiManual({ categoria: "outro", participante_id: null }, "categoria")).toBe(true);
    expect(campoFoiManual({ categoria: "outro", participante_id: null }, "participante")).toBe(true);
    expect(classificarAnexoDaConversa({
      messageId: MSG_RENDA,
      salva: { categoria: "outro", participante_id: FIADOR },
      sinais: sinaisDaFicha(fichaCom({ renda: MSG_RENDA }), [locatario, fiador]),
      participantes: [locatario, fiador],
    })).toMatchObject({
      categoria: "outro",
      participante_id: FIADOR,
      categoria_origem: "manual",
      participante_origem: "manual",
    });
  });

  it("edição humana marca só o campo que mudou", () => {
    const atual = classificarAnexoDaConversa({
      messageId: MSG_RENDA,
      salva: null,
      sinais: sinaisDaFicha(fichaCom({ renda: MSG_RENDA }), [locatario]),
      participantes: [locatario],
    });
    expect(aplicarEdicaoManual(atual, {
      categoria: "documento_pessoal",
      participante_id: LOC,
    })).toMatchObject({
      categoria: "documento_pessoal",
      participante_id: LOC,
      categoria_origem: "manual",
      participante_origem: "automatico",
    });
  });

  it("não regrava quando o automático já está salvo", () => {
    const nova = classificarAnexoDaConversa({
      messageId: MSG_RENDA,
      salva: {
        categoria: "comprovante_renda",
        participante_id: LOC,
        categoria_origem: "automatico",
        participante_origem: "automatico",
      },
      sinais: sinaisDaFicha(fichaCom({ renda: MSG_RENDA }), [locatario]),
      participantes: [locatario],
    });
    expect(classificacaoPrecisaPersistir({
      categoria: "comprovante_renda",
      participante_id: LOC,
      categoria_origem: "automatico",
      participante_origem: "automatico",
    }, nova)).toBe(false);
  });

  it("grava quando o automático preenche o que estava vazio", () => {
    const nova = classificarAnexoDaConversa({
      messageId: MSG_RENDA,
      salva: null,
      sinais: sinaisDaFicha(fichaCom({ renda: MSG_RENDA }), [locatario]),
      participantes: [locatario],
    });
    expect(classificacaoPrecisaPersistir(null, nova)).toBe(true);
  });

  it("reabrir a lista não apaga o automático que o modelo já gravou", () => {
    expect(classificarAnexoDaConversa({
      messageId: MSG_OUTRO,
      salva: {
        categoria: "documento_pessoal",
        participante_id: LOC,
        categoria_origem: "automatico",
        participante_origem: "automatico",
        tentou_modelo: true,
      },
      sinais: [],
      participantes: [locatario, fiador],
    })).toMatchObject({
      categoria: "documento_pessoal",
      participante_id: LOC,
      categoria_origem: "automatico",
      participante_origem: "automatico",
      tentou_modelo: true,
    });
  });

  it("sinal atual da ficha vence o automático antigo", () => {
    expect(classificarAnexoDaConversa({
      messageId: MSG_RENDA,
      salva: {
        categoria: "documento_pessoal",
        participante_id: FIADOR,
        categoria_origem: "automatico",
        participante_origem: "automatico",
      },
      sinais: sinaisDaFicha(fichaCom({ renda: MSG_RENDA }), [locatario, fiador]),
      participantes: [locatario, fiador],
    })).toMatchObject({
      categoria: "comprovante_renda",
      participante_id: LOC,
      categoria_origem: "automatico",
    });
  });
});
