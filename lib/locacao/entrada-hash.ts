/**
 * Hash estável da entrada de uma aba do modal. Sem Node-only: o inbox também
 * compara. Não é prova criptográfica — só detecta "o dado mudou". Sem PII no
 * valor de retorno (só hex).
 */
import type { AbaDaExecucao } from "@/lib/locacao/vocabulario";

export const ABAS_QUE_DEPENDEM_DA_FICHA = [
  "dados",
  "renda",
  "fc",
  "migra",
  "relatorio",
  "contrato",
] as const satisfies readonly AbaDaExecucao[];

export function canonicoDaEntrada(valor: unknown): string {
  return JSON.stringify(ordenar(valor));
}

/** FNV-1a 64 bits em hex (16 caracteres). Mesma entrada ⇒ mesmo hash. */
export function hashDaEntrada(valor: unknown): string {
  const texto = canonicoDaEntrada(valor);
  let h = 0xcbf29ce484222325n;
  const primo = 0x100000001b3n;
  const mascara = 0xffffffffffffffffn;
  for (let i = 0; i < texto.length; i += 1) {
    h ^= BigInt(texto.charCodeAt(i));
    h = (h * primo) & mascara;
  }
  return h.toString(16).padStart(16, "0");
}

export function entradaDaAba(
  aba: AbaDaExecucao,
  ctx: { fichaVersao: number; ficha?: unknown; valoresImovel?: unknown },
): { aba: AbaDaExecucao; ficha_versao: number; ficha: unknown; valores: unknown } {
  return {
    aba,
    ficha_versao: ctx.fichaVersao,
    ficha: ctx.ficha ?? null,
    valores: ctx.valoresImovel ?? null,
  };
}

function ordenar(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(ordenar);
  if (!valor || typeof valor !== "object") return valor ?? null;
  const obj = valor as Record<string, unknown>;
  const saida: Record<string, unknown> = {};
  for (const chave of Object.keys(obj).sort()) {
    saida[chave] = ordenar(obj[chave]);
  }
  return saida;
}
