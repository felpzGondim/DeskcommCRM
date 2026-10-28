import { describe, expect, it } from "vitest";

import { lerStatusDoHub, type StatusAnaliseInquilino } from "@/lib/locacao/analise/status-hub";

function chavesDoStatus(s: StatusAnaliseInquilino) {
  return Object.keys(s).sort();
}

const CHAVES = [
  "cards",
  "erro",
  "estado",
  "id_fc",
  "job_id",
  "laudo_disponivel",
  "print_disponivel",
  "reconfirmacao",
  "risco",
  "score",
];

describe("contrato de status_analise_inquilino (score/risco opcionais)", () => {
  it("lê score e risco quando o Hub manda", () => {
    const s = lerStatusDoHub({
      estado: "concluida",
      cards: [],
      print_disponivel: false,
      score: 712,
      risco: "moderado",
    });
    expect(s.score).toBe(712);
    expect(s.risco).toBe("moderado");
    expect(chavesDoStatus(s)).toEqual(CHAVES);
  });

  it("lê fc.score e fc.risco aninhados (contrato da 4.3)", () => {
    const s = lerStatusDoHub({
      estado: "concluida",
      fc: { score: 900, risco: "alto", id_fc: "FC-1", laudo_disponivel: true },
    });
    expect(s.score).toBe(900);
    expect(s.risco).toBe("alto");
    expect(s.id_fc).toBe("FC-1");
    expect(s.laudo_disponivel).toBe(true);
  });

  it("fc.score aninhado vence o topo quando os dois vêm", () => {
    const s = lerStatusDoHub({ score: 1, risco: "baixo", fc: { score: 2, risco: "alto" } });
    expect(s.score).toBe(2);
    expect(s.risco).toBe("alto");
  });

  it("score texto curto também entra (Hub pode mandar string)", () => {
    expect(lerStatusDoHub({ score: " 712 " }).score).toBe("712");
  });

  it("score 0 é valor, não ausência", () => {
    expect(lerStatusDoHub({ score: 0 }).score).toBe(0);
  });

  it("ausência, null, vazio, NaN e tipo errado viram null — o Hub de hoje omite", () => {
    const ausentes: unknown[] = [
      undefined,
      null,
      {},
      { estado: "cotando" },
      { score: null, risco: null },
      { score: "", risco: "   " },
      { score: Number.NaN, risco: 3 },
      { score: Number.POSITIVE_INFINITY, risco: true },
      { score: { valor: 900 }, risco: { nivel: "alto" } },
    ];
    for (const bruto of ausentes) {
      const s = lerStatusDoHub(bruto);
      expect(s.score, JSON.stringify(bruto)).toBeNull();
      expect(s.risco, JSON.stringify(bruto)).toBeNull();
    }
  });

  it("payload sem JSON (undefined) ainda devolve o tipo completo", () => {
    const s = lerStatusDoHub(undefined);
    expect(s).toEqual({
      estado: null,
      cards: [],
      print_disponivel: false,
      laudo_disponivel: false,
      erro: null,
      job_id: null,
      score: null,
      risco: null,
      id_fc: null,
      reconfirmacao: null,
    });
  });

  it("lê info de reconfirmação quando o Hub pede outro clique", () => {
    const bloco = lerStatusDoHub({
      estado: "aguardando_cobranca_fc",
      reconfirmacao: { necessaria: true, motivo: "login_necessario" },
    });
    expect(bloco.reconfirmacao).toEqual({ necessaria: true, motivo: "login_necessario" });
    const flag = lerStatusDoHub({ precisa_reconfirmar: true, motivo_reconfirmacao: "sessao" });
    expect(flag.reconfirmacao).toEqual({ necessaria: true, motivo: "sessao" });
    const login = lerStatusDoHub({ estado: "login_necessario" });
    expect(login.reconfirmacao).toEqual({ necessaria: true, motivo: "login_necessario" });
  });
});
