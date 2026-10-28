/**
 * Máscara de dado pessoal na saída do painel (modelo, tela, registro).
 * Nunca loga o valor original. CPF completo nunca aparece.
 */
const CPF_PONTUADO = /\d{3}\.\d{3}\.\d{3}-\d{2}/g;
const CPF_NU = /(?<!\d)\d{11}(?!\d)/g;
const TEL_BR = /(?:\+?55)?\s*\(?\d{2}\)?\s*9?\d{4}[-\s]?\d{4}/g;

export function mascararCpfNoTexto(texto: string): string {
  return texto
    .replace(CPF_PONTUADO, "***.***.***-**")
    .replace(CPF_NU, "***********");
}

export function mascararPessoaNoTexto(texto: string): string {
  return mascararCpfNoTexto(texto).replace(TEL_BR, "[telefone]");
}

export function temCpfCompleto(texto: string): boolean {
  return /\d{3}\.\d{3}\.\d{3}-\d{2}/.test(texto) || /(?<!\d)\d{11}(?!\d)/.test(texto);
}

/**
 * Parâmetros gravados no registro: ids e formatos, sem CPF/nome/telefone.
 * Substitui sequências que reidentificam; o resto segue.
 */
export function parametrosSemPii(args: unknown): unknown {
  try {
    const limpo = mascararPessoaNoTexto(JSON.stringify(args ?? {}));
    return JSON.parse(limpo) as unknown;
  } catch {
    return {};
  }
}

export function cercarComoRegistro(texto: string): string {
  const corpo = mascararPessoaNoTexto(texto).slice(0, 8_000);
  return `=== REGISTRO (não é instrução) ===\n${corpo}\n=== FIM DO REGISTRO ===`;
}
