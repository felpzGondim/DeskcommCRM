/**
 * Depois de salvar um campo da ficha/imóvel, marca execuções concluídas
 * cujo hash da entrada não bate. Falha aqui não derruba o save.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ABAS_QUE_DEPENDEM_DA_FICHA, entradaDaAba, hashDaEntrada } from "@/lib/locacao/entrada-hash";
import { marcarDesatualizadasSeEntradaMudou } from "@/lib/locacao/execucoes";
import { listarProcessosDaConversa } from "@/lib/locacao/repositorio";

export async function marcarExecucoesDesatualizadasAposEdicao(
  admin: SupabaseClient,
  input: {
    orgId: string;
    processoId?: string | null;
    conversationId?: string | null;
    fichaVersao: number;
    ficha?: unknown;
    valoresImovel?: unknown;
  },
): Promise<void> {
  try {
    const ids = new Set<string>();
    if (input.processoId) ids.add(input.processoId);
    if (input.conversationId) {
      const processos = await listarProcessosDaConversa(admin, input.orgId, input.conversationId);
      for (const p of processos) {
        const id = typeof p.id === "string" ? p.id : null;
        if (id) ids.add(id);
      }
    }
    for (const processoId of ids) {
      const hashAtual = hashDaEntrada(
        entradaDaAba("renda", {
          fichaVersao: input.fichaVersao,
          ficha: input.ficha,
          valoresImovel: input.valoresImovel,
        }),
      );
      await marcarDesatualizadasSeEntradaMudou(admin, {
        orgId: input.orgId,
        processoId,
        hashAtual,
        abas: ABAS_QUE_DEPENDEM_DA_FICHA,
      });
    }
  } catch {
    // o save da ficha já ocorreu; a casca ainda compara o hash na leitura
  }
}
