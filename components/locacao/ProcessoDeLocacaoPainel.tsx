"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { rotuloDoStatusDoProcesso } from "@/lib/locacao/status";

type ProcessoResumo = {
  id: string;
  status: string;
  imovel: string;
  encerrado_em: string | null;
};

export function ProcessoDeLocacaoPainel({
  conversationId,
  desabilitado = false,
}: {
  conversationId: string;
  desabilitado?: boolean;
}) {
  const t = useT();
  const [habilitado, setHabilitado] = useState(false);
  const [processos, setProcessos] = useState<ProcessoResumo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const r = await apiClient.get<{ data: { habilitado?: boolean; processos?: ProcessoResumo[] } }>(
          `/api/v1/conversations/${conversationId}/locacao`,
        );
        if (!vivo) return;
        setHabilitado(r.data?.habilitado === true);
        setProcessos(r.data?.processos ?? []);
      } catch {
        if (vivo) setHabilitado(false);
      }
    })();
    return () => { vivo = false; };
  }, [conversationId]);

  if (!habilitado) return null;

  async function abrir() {
    if (criando || desabilitado) return;
    setErro(null);
    setCriando(true);
    try {
      const r = await apiClient.post<{ data: { id: string } }>("/api/v1/locacao/processos", {
        conversation_id: conversationId,
        papel: "contato",
      });
      const id = r.data?.id;
      if (id) window.location.assign(`/app/locacao/${id}`);
    } catch (e) {
      setErro(e instanceof Error && e.message ? e.message : t("Não foi possível criar o processo."));
    } finally {
      setCriando(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-border p-2">
      <p className="text-xs font-medium">{t("Processo de locação")}</p>
      {processos.length === 0 ? (
        <p className="text-xs text-text-muted">{t("Nenhum processo ligado a esta conversa.")}</p>
      ) : (
        <ul className="space-y-1">
          {processos.map((p) => (
            <li key={p.id}>
              <a className="text-xs text-primary underline" href={`/app/locacao/${p.id}`}>
                {p.imovel || t("Imóvel")} · {rotuloDoStatusDoProcesso(p.status, t)}
              </a>
            </li>
          ))}
        </ul>
      )}
      <Button size="sm" variant="outline" className="h-7 px-2 text-xs"
        disabled={desabilitado || criando} onClick={() => void abrir()}>
        {criando ? t("Abrindo…") : t("Abrir processo")}
      </Button>
      {erro ? <p className="text-xs text-destructive" role="alert">{erro}</p> : null}
    </div>
  );
}
