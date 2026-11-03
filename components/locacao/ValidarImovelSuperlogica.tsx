"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { CandidatoImovelHub } from "@/lib/locacao/extrato/pacote";
import type { FichaPreliminar } from "@/lib/locacao/ficha-schema";
import { rotuloDoCandidato } from "@/lib/locacao/locador-do-pacote";
import type { LocadorDoVinculo } from "@/lib/locacao/locador-do-vinculo";

type Resposta = {
  status?: string;
  aviso?: string | null;
  locador?: LocadorDoVinculo | null;
  candidatos?: CandidatoImovelHub[];
  ha_mais?: boolean;
  ficha?: FichaPreliminar | null;
};

export function ValidarImovelSuperlogica({
  conversationId,
  desabilitado = false,
  onLocador,
  onFicha,
}: {
  conversationId: string;
  desabilitado?: boolean;
  onLocador?: (locador: LocadorDoVinculo | null) => void;
  onFicha?: (ficha: FichaPreliminar) => void;
}) {
  const t = useT();
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [candidatos, setCandidatos] = useState<CandidatoImovelHub[]>([]);
  const [haMais, setHaMais] = useState(false);
  const [escolhido, setEscolhido] = useState<number | null>(null);

  async function validar(idImovel?: number) {
    if (desabilitado || ocupado) return;
    setOcupado(true);
    setAviso(null);
    try {
      const r = await apiClient.post<{ data: Resposta }>(
        `/api/v1/conversations/${conversationId}/locacao/pacote-imovel`,
        idImovel ? { id_imovel: idImovel } : {},
      );
      const d = r.data ?? {};
      setAviso(d.aviso ?? null);
      setCandidatos(d.candidatos ?? []);
      setHaMais(d.ha_mais === true);
      if (d.locador) onLocador?.(d.locador);
      if (d.ficha) onFicha?.(d.ficha);
      if (d.status !== "candidatos") setEscolhido(null);
      window.dispatchEvent(new CustomEvent("locacao:atualizada", { detail: { conversationId } }));
    } catch (e) {
      setAviso(e instanceof Error && e.message
        ? e.message
        : t("Não foi possível validar o imóvel na Superlógica."));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-1" data-testid="validar-imovel-superlogica">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs"
        disabled={desabilitado || ocupado}
        onClick={() => void validar()}
      >
        {ocupado ? t("Validando…") : t("Validar no Superlógica")}
      </Button>
      {aviso && (
        <p role="status" className="text-[11px] text-muted-foreground" data-testid="aviso-superlogica-imovel">
          {aviso}
        </p>
      )}
      {candidatos.length > 0 && (
        <fieldset className="space-y-1 rounded-md border border-border/70 p-2">
          <legend className="px-1 text-[11px] font-semibold">{t("Imóveis na Superlógica")}</legend>
          {candidatos.map((c) => (
            <label key={c.id_imovel} className="flex items-start gap-1.5 text-[11px]">
              <input
                type="radio"
                name="candidato-imovel-superlogica"
                className="mt-0.5"
                checked={escolhido === c.id_imovel}
                disabled={desabilitado || ocupado}
                onChange={() => setEscolhido(c.id_imovel)}
              />
              <span>{rotuloDoCandidato(c)}</span>
            </label>
          ))}
          {haMais && (
            <p className="text-[11px] text-muted-foreground">
              {t("Há mais resultados. Refine o endereço ou o código.")}
            </p>
          )}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-7 px-2 text-xs"
            disabled={desabilitado || ocupado || escolhido == null}
            onClick={() => escolhido != null && void validar(escolhido)}
          >
            {t("Usar este imóvel")}
          </Button>
        </fieldset>
      )}
    </div>
  );
}
