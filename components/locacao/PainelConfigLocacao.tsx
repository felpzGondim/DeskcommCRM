"use client";

import { useEffect, useState } from "react";

import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

type Estado = {
  locacao: {
    processos_habilitado: boolean;
    arquivos_habilitado: boolean;
    drive_habilitado: boolean;
  };
  superlogica_vinculo: { habilitado: boolean; ligar_unico_exato: boolean };
};

type EstadoPainel = { painel_agente: { ferramentas_habilitado: boolean } };

export function PainelConfigLocacao() {
  const t = useT();
  const [estado, setEstado] = useState<Estado | null>(null);
  const [painel, setPainel] = useState<EstadoPainel | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [loc, pa] = await Promise.all([
          apiClient.get<{ data: Estado }>("/api/v1/settings/locacao"),
          apiClient.get<{ data: EstadoPainel }>("/api/v1/settings/painel-agente"),
        ]);
        setEstado(loc.data);
        setPainel(pa.data);
      } catch (e) {
        setErro(e instanceof Error ? e.message : t("Não foi possível carregar."));
      }
    })();
  }, [t]);

  async function gravar(patch: Partial<Estado>) {
    if (!estado || salvando) return;
    setSalvando(true);
    setErro(null);
    try {
      const r = await apiClient.patch<{ data: Estado }>("/api/v1/settings/locacao", patch);
      setEstado(r.data);
    } catch (e) {
      setErro(e instanceof Error ? e.message : t("Não foi possível salvar."));
    } finally {
      setSalvando(false);
    }
  }

  async function gravarPainel(ferramentas_habilitado: boolean) {
    if (!painel || salvando) return;
    setSalvando(true);
    setErro(null);
    try {
      const r = await apiClient.patch<{ data: EstadoPainel }>("/api/v1/settings/painel-agente", {
        painel_agente: { ferramentas_habilitado },
      });
      setPainel(r.data);
    } catch (e) {
      setErro(e instanceof Error ? e.message : t("Não foi possível salvar."));
    } finally {
      setSalvando(false);
    }
  }

  if (!estado || !painel) {
    return <p className="text-sm text-text-muted">{erro ?? t("Carregando…")}</p>;
  }

  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("Processo de locação")}</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={estado.locacao.processos_habilitado}
            disabled={salvando}
            onChange={(e) => void gravar({ locacao: { ...estado.locacao, processos_habilitado: e.target.checked } })} />
          {t("Ligar processos (desligado por padrão)")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={estado.locacao.arquivos_habilitado}
            disabled={salvando || !estado.locacao.processos_habilitado}
            onChange={(e) => void gravar({ locacao: { ...estado.locacao, arquivos_habilitado: e.target.checked } })} />
          {t("Ligar arquivos do processo")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={estado.locacao.drive_habilitado}
            disabled={salvando || !estado.locacao.arquivos_habilitado}
            onChange={(e) => void gravar({ locacao: { ...estado.locacao, drive_habilitado: e.target.checked } })} />
          {t("Ligar cópia para o Google Drive (desligado por padrão)")}
        </label>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("Painel do agente")}</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={painel.painel_agente.ferramentas_habilitado}
            disabled={salvando}
            onChange={(e) => void gravarPainel(e.target.checked)} />
          {t("Ligar ferramentas no campo de pergunta (desligado por padrão)")}
        </label>
        <p className="text-xs text-text-muted">
          {t("Os botões continuam iguais. Desligado, a pergunta livre não consulta sistemas.")}
        </p>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("Vínculo Superlógica")}</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={estado.superlogica_vinculo.habilitado}
            disabled={salvando}
            onChange={(e) => void gravar({
              superlogica_vinculo: { ...estado.superlogica_vinculo, habilitado: e.target.checked },
            })} />
          {t("Ligar casamento de telefone (desligado por padrão)")}
        </label>
        <p className="text-xs text-text-muted">
          {t("Padrão sujeito à revisão do Felipe: só únicos exatos ligam sozinhos.")}
        </p>
      </fieldset>
      {erro ? <p className="text-sm text-destructive" role="alert">{erro}</p> : null}
      <p className="text-xs text-text-muted">
        {t("Rollback: desligar as chaves. As tabelas ficam.")}
      </p>
      <p className="text-xs text-text-muted">{t("Alterações gravam na hora")}</p>
    </div>
  );
}
