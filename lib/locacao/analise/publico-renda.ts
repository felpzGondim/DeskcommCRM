/**
 * Recorte da execução de renda que a tela e o GET podem ver.
 * Senha de PDF nunca sai daqui.
 */
import type { LocacaoExecucaoRow } from "@/lib/locacao/tipos-banco";

export function publicoDaExecucaoDeRenda(row: LocacaoExecucaoRow): Record<string, unknown> {
  const bruto =
    row.resultado && typeof row.resultado === "object" && !Array.isArray(row.resultado)
      ? { ...(row.resultado as Record<string, unknown>) }
      : {};
  delete bruto.senhas;
  return {
    execucao_id: row.id,
    estado: row.estado,
    etapa_texto: row.etapa_texto,
    progresso_atual: row.progresso_atual,
    progresso_total: row.progresso_total,
    motivo: row.erro_motivo,
    entrada_hash: row.entrada_hash,
    ficha_versao: row.ficha_versao,
    origem: row.origem,
    iniciado_em: row.iniciado_em,
    terminado_em: row.terminado_em,
    ...bruto,
  };
}
