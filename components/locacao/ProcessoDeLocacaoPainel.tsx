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
  renda_confirmada_em?: string | null;
  renda_mensal?: number | null;
  renda_proposta_fc?: number | null;
  alertas?: string[];
};

type AvisoSenha = { tipo?: string; nome: string; tentativas?: number };

export function ProcessoDeLocacaoPainel({
  conversationId,
  desabilitado = false,
}: {
  conversationId: string;
  desabilitado?: boolean;
}) {
  const t = useT();
  const [habilitado, setHabilitado] = useState(false);
  const [analiseRenda, setAnaliseRenda] = useState(false);
  const [processos, setProcessos] = useState<ProcessoResumo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [analisando, setAnalisando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [avisos, setAvisos] = useState<AvisoSenha[]>([]);
  const [senhas, setSenhas] = useState<Record<string, string>>({});
  const [resumo, setResumo] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const r = await apiClient.get<{
          data: {
            habilitado?: boolean;
            analise?: { renda?: boolean };
            processos?: ProcessoResumo[];
          };
        }>(`/api/v1/conversations/${conversationId}/locacao`);
        if (!vivo) return;
        setHabilitado(r.data?.habilitado === true);
        setAnaliseRenda(r.data?.analise?.renda === true);
        setProcessos(r.data?.processos ?? []);
      } catch {
        if (vivo) setHabilitado(false);
      }
    })();
    return () => { vivo = false; };
  }, [conversationId]);

  if (!habilitado) return null;

  const processo = processos[0];

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

  async function analisar() {
    if (analisando || desabilitado || !processo) return;
    setErro(null);
    setAnalisando(true);
    try {
      const senhasPdf = Object.entries(senhas)
        .filter(([, senha]) => senha)
        .map(([nome, senha]) => ({ nome, senha }));
      const r = await apiClient.post<{
        data: {
          resumo?: string;
          avisos?: AvisoSenha[];
          renda_comprovada?: number | null;
          renda_proposta_fc?: number | null;
          alertas?: string[];
        };
      }>(`/api/v1/conversations/${conversationId}/painel-agente/renda`, {
        etapa: "analisar",
        processo_id: processo.id,
        senhasPdf: senhasPdf.length ? senhasPdf : undefined,
      });
      setResumo(r.data?.resumo ?? null);
      setAvisos((r.data?.avisos ?? []).filter((a) => a.tipo === "pdf_protegido" || a.nome));
      setProcessos((atual) =>
        atual.map((p) =>
          p.id === processo.id
            ? {
                ...p,
                renda_mensal: r.data?.renda_comprovada ?? p.renda_mensal,
                renda_proposta_fc: r.data?.renda_proposta_fc ?? p.renda_proposta_fc,
                alertas: r.data?.alertas ?? p.alertas,
              }
            : p,
        ),
      );
    } catch (e) {
      setErro(e instanceof Error && e.message ? e.message : t("Não foi possível analisar a renda."));
    } finally {
      setAnalisando(false);
    }
  }

  async function confirmar() {
    if (confirmando || desabilitado || !processo) return;
    setErro(null);
    setConfirmando(true);
    try {
      await apiClient.post(`/api/v1/conversations/${conversationId}/painel-agente/renda`, {
        etapa: "confirmar",
        processo_id: processo.id,
        renda_proposta_fc: processo.renda_proposta_fc ?? undefined,
      });
      setProcessos((atual) =>
        atual.map((p) =>
          p.id === processo.id ? { ...p, renda_confirmada_em: new Date().toISOString() } : p,
        ),
      );
    } catch (e) {
      setErro(e instanceof Error && e.message ? e.message : t("Não foi possível confirmar a renda."));
    } finally {
      setConfirmando(false);
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
      {analiseRenda ? (
        <div className="space-y-1.5 border-t border-border pt-2" data-testid="analise-renda">
          <p className="text-xs font-medium">{t("Análise de renda")}</p>
          {!processo ? (
            <p className="text-xs text-text-muted">{t("Abra um processo antes de analisar a renda.")}</p>
          ) : (
            <>
              {typeof processo.renda_mensal === "number" ? (
                <p className="text-xs">{t("Renda comprovada")}: R$ {processo.renda_mensal.toFixed(2)}</p>
              ) : null}
              {typeof processo.renda_proposta_fc === "number" ? (
                <p className="text-xs">{t("Renda proposta para a FC")}: R$ {processo.renda_proposta_fc.toFixed(2)}</p>
              ) : null}
              {resumo ? <p className="text-xs whitespace-pre-wrap">{resumo}</p> : null}
              {(processo.alertas ?? []).slice(0, 5).map((a) => (
                <p key={a} className="text-[11px] text-text-muted">{a}</p>
              ))}
              {avisos.filter((a) => a.tipo === "pdf_protegido").map((aviso) => (
                <label key={aviso.nome} className="block space-y-1">
                  <span className="text-[11px]">{t("Senha do PDF")}: {aviso.nome}</span>
                  <input
                    type="password"
                    autoComplete="off"
                    className="h-7 w-full rounded-md border border-border bg-background px-2 text-xs"
                    value={senhas[aviso.nome] ?? ""}
                    onChange={(e) => setSenhas((atual) => ({ ...atual, [aviso.nome]: e.target.value }))}
                    aria-label={`${t("Senha do PDF")} ${aviso.nome}`}
                  />
                </label>
              ))}
              {processo.renda_confirmada_em ? (
                <p className="text-xs text-text-muted">{t("Renda confirmada.")}</p>
              ) : (
                <p className="text-[11px] text-text-muted">
                  {t("Confirme a renda antes de analisar o seguro-fiança ou a FC.")}
                </p>
              )}
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs"
                  disabled={desabilitado || analisando || confirmando}
                  onClick={() => void analisar()}>
                  {analisando ? t("Analisando renda…") : t("Analisar renda")}
                </Button>
                <Button size="sm" className="h-7 px-2 text-xs"
                  disabled={
                    desabilitado || analisando || confirmando
                    || typeof processo.renda_proposta_fc !== "number"
                    || !!processo.renda_confirmada_em
                  }
                  onClick={() => void confirmar()}>
                  {confirmando ? t("Confirmando renda…") : t("Confirmar renda")}
                </Button>
              </div>
            </>
          )}
        </div>
      ) : null}
      {erro ? <p className="text-xs text-destructive" role="alert">{erro}</p> : null}
    </div>
  );
}
