"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

export function AcoesDoProcesso({
  processoId, status, podeAprovar,
}: {
  processoId: string;
  status: string;
  podeAprovar: boolean;
}) {
  const t = useT();
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const final = ["contrato_assinado", "reprovado", "cancelado"].includes(status);

  async function agir(acao: string) {
    if (ocupado) return;
    setOcupado(true);
    setErro(null);
    try {
      await apiClient.patch(`/api/v1/locacao/processos/${processoId}`, {
        acao, motivo: motivo.trim() || undefined,
      });
      window.location.reload();
    } catch (e) {
      setErro(e instanceof Error && e.message ? e.message : t("Não foi possível alterar o processo."));
    } finally {
      setOcupado(false);
    }
  }

  if (final) return <p className="text-sm text-text-muted">{t("Processo encerrado.")}</p>;

  return (
    <div className="space-y-2">
      <label className="block text-sm">
        {t("Motivo da decisão")}
        <input className="mt-1 w-full rounded-md border border-border px-2 py-1 text-sm"
          value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={180} />
      </label>
      {status === "lead" || status === "documentos" ? (
        <Button size="sm" variant="outline" disabled={ocupado} onClick={() => void agir("avancar")}>
          {t("Avançar etapa")}
        </Button>
      ) : null}
      {podeAprovar ? (
        <Button size="sm" disabled={ocupado} onClick={() => void agir("aprovar")}>{t("Aprovar processo")}</Button>
      ) : null}
      <Button size="sm" variant="outline" disabled={ocupado} onClick={() => void agir("reprovar")}>
        {t("Reprovar processo")}
      </Button>
      <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => void agir("cancelar")}>
        {t("Cancelar processo")}
      </Button>
      {erro ? <p className="text-sm text-destructive" role="alert">{erro}</p> : null}
    </div>
  );
}
