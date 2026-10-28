/**
 * URLs assinadas de curta duração para o job de análise no Hub.
 * Só entram no tools/call se a ferramenta anunciar `arquivos` ou `anexos`.
 * Sem path interno, sem bytes, sem PII no log.
 */
import { isMediaPathOwnedBy } from "@/lib/messaging/media/upload-validation";
import { createAdminClient } from "@/lib/supabase/admin";
import type { FerramentaRemota } from "@/lib/mcp/servidor-externo/chamada";
import { LIMITES_ANEXOS_PADRAO } from "@/lib/agent-engine/agent/painel-anexos-limites";
import { nomeDoAnexo } from "@/lib/agent-engine/agent/painel-leitura-anexos";

export type ArquivoParaHub = {
  nome: string;
  mime: string;
  bytes: number | null;
  url: string;
};

export function ferramentaAceitaArquivos(ferramenta: FerramentaRemota): boolean {
  const props = ferramenta.inputSchema?.properties ?? {};
  return "arquivos" in props || "anexos" in props;
}

export function chaveDosArquivos(ferramenta: FerramentaRemota): "arquivos" | "anexos" {
  const props = ferramenta.inputSchema?.properties ?? {};
  return "arquivos" in props ? "arquivos" : "anexos";
}

export async function assinarAnexosParaOHub(
  linhas: readonly Record<string, unknown>[],
  orgId: string,
  conversaId: string,
  admin = createAdminClient(),
  ttlSegundos = LIMITES_ANEXOS_PADRAO.url_assinada_segundos,
): Promise<ArquivoParaHub[]> {
  const saida: ArquivoParaHub[] = [];
  for (const linha of linhas) {
    if (linha.revoked_at || linha.direction === "outbound") continue;
    const tipo = typeof linha.type === "string" ? linha.type : "";
    if (!["document", "image"].includes(tipo)) continue;
    const path = linha.media_storage_path;
    if (typeof path !== "string" || !isMediaPathOwnedBy(path, orgId, conversaId)) continue;
    const { data, error } = await admin.storage.from("whatsapp-media").createSignedUrl(path, ttlSegundos);
    if (error || !data?.signedUrl) continue;
    saida.push({
      nome: nomeDoAnexo(linha),
      mime: typeof linha.media_mime === "string" ? linha.media_mime.slice(0, 80) : "",
      bytes: typeof linha.media_size_bytes === "number" ? linha.media_size_bytes : null,
      url: data.signedUrl,
    });
  }
  return saida;
}
