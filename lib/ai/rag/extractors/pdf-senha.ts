/** Detecta PDF protegido sem logar senha, nome de arquivo ou conteúdo. */
export function ehErroDeSenhaDePdf(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const o = err as { name?: unknown; message?: unknown; code?: unknown; motivo?: unknown };
  if (o.motivo === "protegido") return true;
  if (o.name === "PasswordException") return true;
  if (o.code === 1 || o.code === 2) return true;
  const mensagem = typeof o.message === "string" ? o.message : "";
  return /password/i.test(mensagem) && !/DOMMatrix|canvas/i.test(mensagem);
}
