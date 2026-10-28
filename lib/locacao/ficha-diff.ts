/**
 * Lista só os CAMINHOS que mudaram. Os valores nunca saem daqui — o audit e o
 * histórico da tela leem esta lista.
 */
export function caminhosAlterados(antes: unknown, depois: unknown, prefixo = ""): string[] {
  if (Object.is(antes, depois)) return [];
  if (antes === null || depois === null || typeof antes !== "object" || typeof depois !== "object") {
    return prefixo ? [prefixo] : [];
  }
  if (Array.isArray(antes) || Array.isArray(depois)) {
    if (!Array.isArray(antes) || !Array.isArray(depois) || antes.length !== depois.length) {
      return prefixo ? [prefixo] : [];
    }
    const saida: string[] = [];
    for (let i = 0; i < antes.length; i += 1) {
      saida.push(...caminhosAlterados(antes[i], depois[i], `${prefixo}[${i}]`));
    }
    return saida;
  }
  const a = antes as Record<string, unknown>;
  const b = depois as Record<string, unknown>;
  const chaves = new Set([...Object.keys(a), ...Object.keys(b)]);
  const saida: string[] = [];
  for (const chave of [...chaves].sort()) {
    const caminho = prefixo ? `${prefixo}.${chave}` : chave;
    saida.push(...caminhosAlterados(a[chave], b[chave], caminho));
  }
  return saida;
}
