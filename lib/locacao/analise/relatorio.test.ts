import { describe, expect, it } from "vitest";

import { aceitarBlocoDeRenda } from "@/lib/locacao/analise/bloco-de-renda";
import { completarFicha } from "@/lib/locacao/ficha-schema";
import {
  FRASE_PROIBIDA,
  SECOES_DO_RELATORIO,
  TEXTO_SECAO_PENDENTE,
  classificarRisco,
  mascararRelatorio,
  montarRelatorioFinanceiro,
  recusarFraseDeAluguel,
} from "@/lib/locacao/analise/relatorio";

describe("relatório financeiro de 6 seções", () => {
  it("as 6 seções existem; bloco faltando fica pendente sem inventar número", () => {
    const r = montarRelatorioFinanceiro({
      ficha: null,
      relatorioPreliminar: null,
      rendaConfirmada: false,
      renda: null,
      fc: null,
      fcEstado: null,
      seguroCards: [],
      seguroEstado: null,
    });
    expect(r.secoes.map((s) => s.id)).toEqual([...SECOES_DO_RELATORIO]);
    expect(r.secoes.every((s) => s.pendente || s.texto.includes(TEXTO_SECAO_PENDENTE) || /pendente|não (foi |entra)/i.test(s.texto))).toBe(true);
    expect(r.texto).not.toMatch(/R\$ 1[0-9]/);
    expect(r.risco).toBeNull();
    expect(r.texto).not.toMatch(FRASE_PROIBIDA);
    expect(r.renda.comprovada).toBeNull();
  });

  it("declarada no bloco não aparece como comprovada e o risco não sai baixo", () => {
    const ficha = completarFicha({
      pessoas: [{
        papel: "inquilino",
        principal: true,
        nome: { valor: "Ana" },
        cpf: { valor: "529.982.247-25" },
        rg: { valor: "12.345.678-9" },
        celular: { valor: "11987654321" },
        email: { valor: "ana@imobiliaria.com" },
      }],
      imovel: { aluguel: { valor: 2000 }, condominio: { valor: 400 }, iptu: { valor: 100 } },
    });
    const soDeclarada = aceitarBlocoDeRenda({ declarada: 8000 });
    const pendente = montarRelatorioFinanceiro({
      ficha,
      relatorioPreliminar: "não alugue este candidato",
      rendaConfirmada: true,
      renda: soDeclarada,
      fc: { score: 710, risco: "baixo", id_fc: "FC-1", laudo_disponivel: false, reconfirmacao: null, cobranca: null },
      fcEstado: "concluida",
      seguroCards: [{ seguradora: "Porto", codigo: "C1" }],
      seguroEstado: "concluida",
    });
    expect(pendente.renda.comprovada).toBeNull();
    expect(pendente.renda.comprovada).not.toBe(8000);
    expect(pendente.risco).not.toBe("baixo");
    expect(pendente.texto).not.toMatch(/Renda comprovada \(extrato\): R\$ 8000/);
    expect(pendente.texto).not.toMatch(FRASE_PROIBIDA);
    expect(pendente.texto).not.toContain("529");
    expect(pendente.texto).not.toContain("ana@");
    expect(pendente.texto).not.toContain("987654321");
    expect(pendente.texto).not.toContain("12.345.678-9");
    expect(pendente.texto).toContain("[rg]");

    const comBloco = montarRelatorioFinanceiro({
      ficha,
      relatorioPreliminar: null,
      rendaConfirmada: true,
      renda: aceitarBlocoDeRenda({
        comprovada: 4500,
        declarada: 8000,
        tabela: "2026-09 | 4500.00 | 0 | 4500.00",
        abaixo_de_3x: true,
        tres_vezes_pacote: 7500,
      }),
      fc: { score: 710, risco: "moderado", id_fc: "FC-1", laudo_disponivel: false, reconfirmacao: null, cobranca: null },
      fcEstado: "concluida",
      seguroCards: [{ seguradora: "Porto", codigo: "C1" }],
      seguroEstado: "concluida",
    });
    expect(comBloco.renda.comprovada).toBe(4500);
    expect(comBloco.renda.comprovada).not.toBe(8000);
    expect(comBloco.risco).toBe("alto");
    expect(comBloco.texto).toMatch(/4500/);
    expect(comBloco.texto).toMatch(/aluguel \+ condomínio \+ IPTU \+ seguro-incêndio/);
  });

  it("risco só baixo/moderado/alto; sem comprovada não sai baixo", () => {
    expect(classificarRisco({
      fcRisco: null,
      renda: aceitarBlocoDeRenda({ declarada: 8000 }),
    })).toEqual({ risco: null, pendente: true });
    expect(classificarRisco({
      fcRisco: "baixo",
      renda: aceitarBlocoDeRenda({ declarada: 9000 }),
    }).risco).not.toBe("baixo");
    expect(classificarRisco({
      fcRisco: "baixo",
      renda: aceitarBlocoDeRenda({ comprovada: 9000, abaixo_de_3x: false }),
    }).risco).toBe("baixo");
  });

  it("máscara e recusa de alugue não deixam o texto original", () => {
    expect(mascararRelatorio("CPF 52998224725 RG 12.345.678-9")).not.toMatch(/529|12\.345/);
    expect(recusarFraseDeAluguel("não alugue agora")).not.toMatch(FRASE_PROIBIDA);
  });
});
