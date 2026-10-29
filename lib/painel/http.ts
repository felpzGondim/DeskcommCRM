import { fail, ok } from "@/lib/api/wrappers";

import type { ResultadoDaFerramenta } from "@/lib/painel/ferramentas/tipos";

function statusDoCodigo(codigo: string): number {
  if (codigo === "internal_error") return 500;
  if (codigo === "idempotency_conflict" || codigo === "idempotency_in_progress") return 409;
  if (
    codigo === "tool_unavailable" ||
    codigo === "hub_contract_error" ||
    codigo === "validation_error" ||
    codigo === "reply_context_unavailable" ||
    codigo === "saida_truncada" ||
    codigo === "invalid_format"
  ) {
    return 422;
  }
  return 502;
}

export function respostaDaFerramenta(
  r: ResultadoDaFerramenta,
  t: (s: string) => string,
  requestId: string,
  extra: Record<string, unknown> = {},
) {
  if (r.ok) {
    return ok(
      {
        resumo: r.texto,
        sugestao: r.sugestao,
        links: r.links,
        previaToken: r.previaToken ?? null,
        pronto: r.pronto,
        avisos: r.avisos,
        ...r.extra,
        ...extra,
      },
      { requestId },
    );
  }
  const codigo = r.codigo ?? "hub_unavailable";
  return fail(codigo, t(r.texto), statusDoCodigo(codigo), { requestId });
}
