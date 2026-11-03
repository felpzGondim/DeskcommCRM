"use client";

import { useEffect, useState } from "react";

import { SeloOrigem } from "@/components/locacao/SeloOrigem";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { CampoFicha, FichaPreliminar } from "@/lib/locacao/ficha-schema";
import {
  campoLocadorVisivel,
  type LocadorDoVinculo,
} from "@/lib/locacao/locador-do-vinculo";
import { ValidarImovelSuperlogica } from "@/components/locacao/ValidarImovelSuperlogica";
import {
  mascararContatoLocador,
  mascararDocumentoLocador,
} from "@/lib/locacao/mascarar-locador";

const CAMPOS = [
  { chave: "nome", tela: "Nome do locador", mascarar: (v: string) => v },
  { chave: "documento", tela: "CPF/CNPJ do locador", mascarar: mascararDocumentoLocador },
  { chave: "contato", tela: "Contato do locador", mascarar: mascararContatoLocador },
] as const;

type ChaveLocador = (typeof CAMPOS)[number]["chave"];

function slDoCampo(vinculo: LocadorDoVinculo | null, chave: ChaveLocador): string | null {
  if (!vinculo) return null;
  if (chave === "nome") return vinculo.nome;
  if (chave === "documento") return vinculo.documento_mascarado;
  return vinculo.contato_mascarado;
}

export function CamposLocador({
  locador,
  vinculo,
  desabilitado = false,
  onAlterar,
}: {
  locador: FichaPreliminar["locador"];
  vinculo?: LocadorDoVinculo | null;
  desabilitado?: boolean;
  onAlterar?: (chave: ChaveLocador, valor: string) => void;
}) {
  const t = useT();
  const [rascunho, setRascunho] = useState<Partial<Record<ChaveLocador, string>>>({});
  return (
    <fieldset className="space-y-1 rounded-md border border-border p-2" data-testid="campos-locador">
      <legend className="px-1 text-[11px] font-semibold">{t("Locador")}</legend>
      <p className="text-[11px] text-muted-foreground">
        {t("Proprietário do imóvel. CPF/CNPJ e contato aparecem mascarados.")}
      </p>
      {CAMPOS.map((campo) => {
        const visivel = campoLocadorVisivel(
          locador[campo.chave],
          slDoCampo(vinculo ?? null, campo.chave),
          campo.mascarar,
        );
        return (
          <label key={campo.chave} className="block text-[11px]">
            {t(campo.tela)}
            <Input
              className="h-8 text-xs"
              value={rascunho[campo.chave] ?? visivel.valor}
              disabled={desabilitado || !onAlterar}
              onChange={(e) => {
                setRascunho((a) => ({ ...a, [campo.chave]: e.target.value }));
                onAlterar?.(campo.chave, e.target.value);
              }}
              aria-label={t(campo.tela)}
            />
            <SeloOrigem origem={visivel.origem} />
          </label>
        );
      })}
    </fieldset>
  );
}

export function CamposLocadorNaFicha({
  conversationId,
  locador,
  desabilitado = false,
  atualizacao = 0,
  onAlterar,
  onFichaDaSuperlogica,
}: {
  conversationId: string;
  locador: FichaPreliminar["locador"];
  desabilitado?: boolean;
  atualizacao?: number;
  onAlterar?: (chave: ChaveLocador, valor: string) => void;
  onFichaDaSuperlogica?: (ficha: FichaPreliminar) => void;
}) {
  const [vinculo, setVinculo] = useState<LocadorDoVinculo | null>(null);

  useEffect(() => {
    let vivo = true;
    void apiClient.get<{
      data: {
        locador?: LocadorDoVinculo | null;
      };
    }>(`/api/v1/conversations/${conversationId}/locacao`).then((r) => {
      if (!vivo) return;
      setVinculo(r.data.locador ?? null);
    }).catch(() => {
      if (vivo) setVinculo(null);
    });
    return () => { vivo = false; };
  }, [conversationId, atualizacao]);

  return (
    <div className="space-y-1">
      <CamposLocador
        locador={locador}
        vinculo={vinculo}
        desabilitado={desabilitado}
        onAlterar={onAlterar}
      />
      <ValidarImovelSuperlogica
        conversationId={conversationId}
        desabilitado={desabilitado}
        onLocador={setVinculo}
        onFicha={onFichaDaSuperlogica}
      />
    </div>
  );
}

export function campoLocadorDaEdicao(valor: string): CampoFicha {
  return {
    valor: valor.trim() || null,
    fonte: "atendente",
    trecho: null,
    confianca: 1,
    message_id: null,
  };
}
