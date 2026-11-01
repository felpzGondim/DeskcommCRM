"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

type AcaoComConfirmacao = "aprovar" | "reabrir";

export function AcoesDoProcesso({
  processoId,
  status,
  podeAprovar,
}: {
  processoId: string;
  status: string;
  podeAprovar: boolean;
}) {
  const t = useT();
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [pendente, setPendente] = useState<AcaoComConfirmacao | null>(null);
  const assinado = status === "contrato_assinado";
  const reabre = status === "reprovado" || status === "cancelado";

  async function agir(acao: string, confirmado?: boolean) {
    if (ocupado) return;
    setOcupado(true);
    setErro(null);
    try {
      await apiClient.patch(`/api/v1/locacao/processos/${processoId}`, {
        acao,
        motivo: motivo.trim() || undefined,
        ...(confirmado ? { confirmado: true } : {}),
      });
      window.location.reload();
    } catch (e) {
      setErro(
        e instanceof Error && e.message ? e.message : t("Não foi possível alterar o processo."),
      );
    } finally {
      setOcupado(false);
    }
  }

  if (assinado) return <p className="text-sm text-text-muted">{t("Processo encerrado.")}</p>;

  if (reabre) {
    if (!podeAprovar) return <p className="text-sm text-text-muted">{t("Processo encerrado.")}</p>;
    return (
      <div className="space-y-2">
        <Button size="sm" disabled={ocupado} onClick={() => setPendente("reabrir")}>
          {t("Reabrir processo")}
        </Button>
        {erro ? (
          <p className="text-sm text-destructive" role="alert">
            {erro}
          </p>
        ) : null}
        <DialogoDeConfirmacao
          aberto={pendente === "reabrir"}
          ocupado={ocupado}
          titulo={t("Reabrir este processo?")}
          descricao={t("O processo volta para a etapa de documentos.")}
          confirmar={t("Reabrir processo")}
          cancelar={t("Cancelar")}
          onCancelar={() => setPendente(null)}
          onConfirmar={() => {
            setPendente(null);
            void agir("reabrir", true);
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm">
        {t("Motivo da decisão")}
        <input
          className="mt-1 w-full rounded-md border border-border px-2 py-1 text-sm"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          maxLength={180}
        />
      </label>
      {status === "lead" || status === "documentos" ? (
        <Button size="sm" variant="outline" disabled={ocupado} onClick={() => void agir("avancar")}>
          {t("Avançar etapa")}
        </Button>
      ) : null}
      {podeAprovar ? (
        <Button size="sm" disabled={ocupado} onClick={() => setPendente("aprovar")}>
          {t("Aprovar processo")}
        </Button>
      ) : null}
      <Button size="sm" variant="outline" disabled={ocupado} onClick={() => void agir("reprovar")}>
        {t("Reprovar processo")}
      </Button>
      <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => void agir("cancelar")}>
        {t("Cancelar processo")}
      </Button>
      {erro ? (
        <p className="text-sm text-destructive" role="alert">
          {erro}
        </p>
      ) : null}
      <DialogoDeConfirmacao
        aberto={pendente === "aprovar"}
        ocupado={ocupado}
        titulo={t("Aprovar este processo?")}
        descricao={t("Confirme se conferiu a análise. A decisão fica registrada no processo.")}
        confirmar={t("Aprovar processo")}
        cancelar={t("Cancelar")}
        onCancelar={() => setPendente(null)}
        onConfirmar={() => {
          setPendente(null);
          void agir("aprovar", true);
        }}
      />
    </div>
  );
}

function DialogoDeConfirmacao({
  aberto,
  ocupado,
  titulo,
  descricao,
  confirmar,
  cancelar,
  onCancelar,
  onConfirmar,
}: {
  aberto: boolean;
  ocupado: boolean;
  titulo: string;
  descricao: string;
  confirmar: string;
  cancelar: string;
  onCancelar: () => void;
  onConfirmar: () => void;
}) {
  return (
    <AlertDialog
      open={aberto}
      onOpenChange={(open) => {
        if (!open) onCancelar();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{titulo}</AlertDialogTitle>
          <AlertDialogDescription>{descricao}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={ocupado}>{cancelar}</AlertDialogCancel>
          <AlertDialogAction disabled={ocupado} onClick={onConfirmar}>
            {confirmar}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
