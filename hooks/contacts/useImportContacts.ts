/**
 * useImportContacts — POST multipart do CSV para /api/v1/contacts/import.
 *
 * Usa fetch cru (não o apiClient) porque o client serializa body como JSON e
 * não fala FormData — mesmo padrão de hooks/ai/useSkills.ts. Erro é sempre
 * ApiError para o diálogo mostrar `message` direto no toast.
 */
import { ApiError } from "@/lib/api/types";
import type { ApiErrorBody } from "@/lib/api/types";
import type { ConflitoDeNome } from "@/lib/contacts/atualizar-nome-na-importacao";
import { randomId } from "@/lib/random-id";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export type { ConflitoDeNome };

export interface ImportContactsResult {
  total_linhas: number;
  imported: number;
  updated: number;
  skipped_duplicates: number;
  conflicts: ConflitoDeNome[];
  errors: Array<{ linha: number; motivo: string }>;
}

export interface PedidoDeImportacao {
  file: File;
  atualizarExistentes?: boolean;
  substituirContactIds?: string[];
}

async function importarCsv(pedido: PedidoDeImportacao): Promise<ImportContactsResult> {
  const form = new FormData();
  form.append("file", pedido.file);
  if (pedido.atualizarExistentes) form.append("atualizar_existentes", "true");
  if (pedido.substituirContactIds && pedido.substituirContactIds.length > 0) {
    form.append("substituir_contact_ids", JSON.stringify(pedido.substituirContactIds));
  }
  const res = await fetch("/api/v1/contacts/import", {
    method: "POST",
    headers: { "Idempotency-Key": randomId() },
    body: form,
    credentials: "same-origin",
  });
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const errBody = parsed as ApiErrorBody | null;
    const e = errBody?.error;
    throw new ApiError(
      res.status,
      e?.code ?? "unknown_error",
      e?.details,
      e?.request_id ?? randomId(),
      e?.message,
    );
  }
  return (parsed as { data: ImportContactsResult }).data;
}

export function useImportContacts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: importarCsv,
    onSuccess: () => {
      // A lista pode ter crescido em qualquer página/filtro — invalida tudo.
      qc.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
}
