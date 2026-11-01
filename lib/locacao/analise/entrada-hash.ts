/**
 * Hash da entrada da análise de renda. Base para marcar desatualizado depois.
 * Não inclui senha nem texto de documento — só identidade do que foi usado.
 */
import { createHash } from "node:crypto";

export type EntradaDaRendaParaHash = {
  processoId: string;
  conversationId: string;
  fichaVersao: number | null;
  mensagens: readonly {
    id?: unknown;
    media_storage_path?: unknown;
    media_size_bytes?: unknown;
  }[];
  senhaNomes?: readonly string[];
};

function idsDasMensagens(mensagens: EntradaDaRendaParaHash["mensagens"]): string[] {
  const saida: string[] = [];
  for (const m of mensagens) {
    const id = typeof m.id === "string" ? m.id : "";
    const path = typeof m.media_storage_path === "string" ? m.media_storage_path : "";
    const tamanho = typeof m.media_size_bytes === "number" ? String(m.media_size_bytes) : "";
    if (id || path) saida.push(`${id}|${path}|${tamanho}`);
  }
  return saida.sort();
}

/** SHA-256 hex estável da entrada usada na execução. */
export function hashDaEntradaDaRenda(entrada: EntradaDaRendaParaHash): string {
  const corpo = JSON.stringify({
    processo_id: entrada.processoId,
    conversation_id: entrada.conversationId,
    ficha_versao: entrada.fichaVersao,
    mensagens: idsDasMensagens(entrada.mensagens),
    senhas: [...(entrada.senhaNomes ?? [])].map((n) => n.trim()).filter(Boolean).sort(),
  });
  return createHash("sha256").update(corpo).digest("hex");
}
