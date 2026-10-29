import { describe, expect, it } from "vitest";

import { lerStatusDoHub, type StatusAnaliseInquilino } from "@/lib/locacao/analise/status-hub";

function chavesDoStatus(s: StatusAnaliseInquilino) {
  return Object.keys(s).sort();
}

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
    expect(chavesDoStatus(s)).toEqual([
      "cards",
      "erro",
      "estado",
      "job_id",
      "print_disponivel",
      "risco",
      "score",
    ]);
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
      { fc: { score: 900, risco: "alto" } },
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
      erro: null,
      job_id: null,
      score: null,
      risco: null,
    });
  });
});
