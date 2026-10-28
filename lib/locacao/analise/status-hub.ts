/**
 * Contrato de `status_analise_inquilino` (Brisa Hub).
 *
 * `score` e `risco` (FC Score+) são opcionais — decisão do Felipe, 28/10/2026.
 * O Hub de hoje omite; a 4.3 consome quando vierem no topo **ou** em `fc.score` /
 * `fc.risco`. Ausência → null. Este módulo só parseia. Quem persiste ou mostra
 * é o consumidor (a 4.2 descarta; a 4.3 usa).
 *
 * Info de reconfirmação: depois de `login_necessario` o Hub pode pedir outro
 * clique humano. Nunca vira cobrança automática.
 */
export type ReconfirmacaoDoHub = {
  necessaria: boolean;
  motivo: string | null;
};

export type StatusAnaliseInquilino = {
  estado: string | null;
  cards: unknown;
  print_disponivel: boolean;
  laudo_disponivel: boolean;
  erro: string | null;
  job_id: string | null;
  /** FC Score+. Ausente no Hub de hoje; 4.3 consome quando vier. */
  score: number | string | null;
  /** Classificação de risco do FC. Ausente no Hub de hoje; 4.3 consome quando vier. */
  risco: string | null;
  /** ID-FC quando o Hub o devolve. */
  id_fc: string | null;
  /** Pedido de novo clique humano (login, cobrança incerta). Ausente → null. */
  reconfirmacao: ReconfirmacaoDoHub | null;
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

function objeto(valor: unknown): Record<string, unknown> | null {
  return valor && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null;
}

function scoreDe(o: Record<string, unknown>): number | string | null {
  const fc = objeto(o.fc);
  return comoNumeroOuTexto(fc?.score) ?? comoNumeroOuTexto(o.score);
}

function riscoDe(o: Record<string, unknown>): string | null {
  const fc = objeto(o.fc);
  return comoRisco(fc?.risco) ?? comoRisco(o.risco);
}

function idFcDe(o: Record<string, unknown>): string | null {
  const fc = objeto(o.fc);
  const candidatos = [fc?.id_fc, fc?.id, o.id_fc, o.ficha_id];
  for (const v of candidatos) {
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 80);
  }
  return null;
}

function laudoDisponivel(o: Record<string, unknown>): boolean {
  const fc = objeto(o.fc);
  return o.laudo_disponivel === true
    || o.tem_laudo === true
    || o.laudoDisponivel === true
    || fc?.laudo_disponivel === true
    || fc?.tem_laudo === true;
}

function reconfirmacaoDe(o: Record<string, unknown>): ReconfirmacaoDoHub | null {
  const bloco = objeto(o.reconfirmacao);
  if (bloco) {
    const necessaria =
      bloco.necessaria === true
      || bloco.precisa === true
      || bloco.pedida === true;
    const motivoBruto = bloco.motivo ?? bloco.razao ?? bloco.codigo;
    const motivo = typeof motivoBruto === "string" && motivoBruto.trim()
      ? motivoBruto.trim().slice(0, 80)
      : null;
    if (!necessaria && !motivo) return null;
    return { necessaria, motivo };
  }
  if (o.precisa_reconfirmar === true || o.reconfirmacao_necessaria === true) {
    const motivo = typeof o.motivo_reconfirmacao === "string" && o.motivo_reconfirmacao.trim()
      ? o.motivo_reconfirmacao.trim().slice(0, 80)
      : null;
    return { necessaria: true, motivo };
  }
  const estado = typeof o.estado === "string" ? o.estado : (typeof o.status === "string" ? o.status : "");
  if (estado.trim().toLowerCase() === "login_necessario") {
    return { necessaria: true, motivo: "login_necessario" };
  }
  return null;
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
    laudo_disponivel: laudoDisponivel(o),
    erro: typeof o.erro === "string" ? o.erro : (typeof o.erro_codigo === "string" ? o.erro_codigo : null),
    job_id: typeof o.job_id === "string" ? o.job_id : (typeof o.hub_job_id === "string" ? o.hub_job_id : null),
    score: scoreDe(o),
    risco: riscoDe(o),
    id_fc: idFcDe(o),
    reconfirmacao: reconfirmacaoDe(o),
  };
}
