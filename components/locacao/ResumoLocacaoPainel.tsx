"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { rotuloDoStatusDoProcesso } from "@/lib/locacao/status";

type ProcessoResumo = { id: string; status: string; imovel: string };

export function ResumoLocacaoPainel({
  conversationId,
  desabilitado = false,
  onAbrirAnalise,
}: {
  conversationId: string;
  desabilitado?: boolean;
  onAbrirAnalise: () => void;
}) {
  const t = useT();
  const [processo, setProcesso] = useState<ProcessoResumo | null>(null);

  useEffect(() => {
    let vivo = true;
    void apiClient
      .get<{ data: { processos?: ProcessoResumo[] } }>(
        `/api/v1/conversations/${conversationId}/locacao`,
      )
      .then((r) => {
        if (!vivo) return;
        setProcesso(r.data?.processos?.[0] ?? null);
      })
      .catch(() => {
        if (vivo) setProcesso(null);
      });
    return () => {
      vivo = false;
    };
  }, [conversationId]);

  return (
    <div className="space-y-1.5 rounded-md border border-border p-2" data-testid="resumo-locacao">
      <p className="text-xs font-medium">{t("Locação")}</p>
      <p className="text-xs text-muted-foreground">
        {processo
          ? `${processo.imovel || t("Imóvel")} · ${rotuloDoStatusDoProcesso(processo.status, t)}`
          : t("Nenhum processo ligado a esta conversa.")}
      </p>
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs"
        disabled={desabilitado}
        onClick={onAbrirAnalise}
      >
        {t("Abrir análise")}
      </Button>
    </div>
  );
}
