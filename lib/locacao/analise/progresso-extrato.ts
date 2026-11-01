/**
 * Leitura do extrato em blocos, sem teto de páginas.
 * A frase de progresso é a que a execução grava (ex.: "lendo extrato pág. 12 de 43").
 */
export const LOTE_OCR_PADRAO = 5;

export function textoDoProgressoDeExtrato(atual: number, total: number): string {
  const n = Math.max(1, Math.trunc(atual));
  const t = Math.max(n, Math.trunc(total));
  return `lendo extrato pág. ${n} de ${t}`;
}

export type PaginaDoExtrato = {
  pagina: number;
  texto: string;
};

export type ProgressoDeExtrato = {
  atual: number;
  total: number;
  etapa: string;
};

/**
 * Junta o texto de todas as páginas, lote a lote. Sem corte em 30.
 * O callback recebe a última página do lote (12 de 43, não o índice do lote).
 */
export async function lerExtratoEmBlocos(
  paginas: readonly PaginaDoExtrato[],
  lote: number = LOTE_OCR_PADRAO,
  onProgresso?: (p: ProgressoDeExtrato) => void | Promise<void>,
): Promise<{ texto: string; progressos: string[] }> {
  const tamanho = Math.max(1, Math.trunc(lote));
  const total = paginas.length;
  const partes: string[] = [];
  const progressos: string[] = [];
  if (total === 0) return { texto: "", progressos };
  for (let i = 0; i < paginas.length; i += tamanho) {
    const grupo = paginas.slice(i, i + tamanho);
    for (const p of grupo) {
      if (p.texto.trim()) partes.push(p.texto.trim());
    }
    const ultima = grupo[grupo.length - 1]?.pagina ?? i + grupo.length;
    const etapa = textoDoProgressoDeExtrato(ultima, total);
    progressos.push(etapa);
    await onProgresso?.({ atual: ultima, total, etapa });
  }
  return { texto: partes.join("\n\n"), progressos };
}
