/**
 * Contrato de `status_analise_inquilino` (Brisa Hub).
 *
 * `score` e `risco` (FC Score+) são opcionais — decisão do Felipe, 28/10/2026.
 * O Hub de hoje omite; a 4.3 passa a consumir quando vierem. Ausência → null.
 * Este módulo só parseia. Quem persiste ou mostra é o consumidor (a 4.2
 * descarta; a 4.3 usa).
 */
export type StatusAnaliseInquilino = {
  estado: string | null;
  cards: unknown;
  print_disponivel: boolean;
  erro: string | null;
  job_id: string | null;
  /** FC Score+. Ausente no Hub de hoje; 4.3 consome quando vier. */
  score: number | string | null;
  /** Classificação de risco do FC. Ausente no Hub de hoje; 4.3 consome quando vier. */
  risco: string | null;
};

function comoNumeroOuTexto(valor: unknown): number | string | null {
  if (typeof valor === "number" && Number.isFinite(valor)) return valor;
  if (typeof valor === "string" && valor.trim()) return valor.trim().slice(0, 40);
  return null;
}

function comoRisco(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const s = valor.trim();
  return s ? s.slice(0, 40) : null;
}

export function lerStatusDoHub(dados: unknown): StatusAnaliseInquilino {
  const o = dados && typeof dados === "object" ? (dados as Record<string, unknown>) : {};
  const print =
    o.print_disponivel === true
    || o.tem_print === true
    || o.printDisponivel === true;
  return {
    estado: typeof o.estado === "string" ? o.estado : (typeof o.status === "string" ? o.status : null),
    cards: o.cards ?? o.cotacoes ?? o.resultados ?? [],
    print_disponivel: print,
    erro: typeof o.erro === "string" ? o.erro : (typeof o.erro_codigo === "string" ? o.erro_codigo : null),
    job_id: typeof o.job_id === "string" ? o.job_id : (typeof o.hub_job_id === "string" ? o.hub_job_id : null),
    score: comoNumeroOuTexto(o.score),
    risco: comoRisco(o.risco),
  };
}
