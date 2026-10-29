"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import {
  CAMPOS_DO_VALOR_DO_IMOVEL,
  CAMPOS_OBRIGATORIOS_DO_PACOTE,
  rotuloDaOrigemDoValor,
  valoresVazios,
  type CampoDoValorDoImovel,
  type OrigemDoValorDoImovel,
  type ValoresDoImovel,
} from "@/lib/locacao/valores-imovel";

const ROTULO_CAMPO_TELA: Record<CampoDoValorDoImovel, string> = {
  aluguel: "Aluguel (R$/mês)",
  condominio: "Condomínio (R$/mês, inclui rateio)",
  iptu: "IPTU (R$/mês)",
  seguro_incendio: "Seguro-incêndio (R$/mês)",
  seguro_fianca: "Seguro-fiança (R$/mês, informativo)",
};

export function CamposImovelProcesso({
  valores,
  onSalvar,
  desabilitado = false,
  aviso = null,
}: {
  valores: ValoresDoImovel;
  onSalvar?: (patch: Partial<Record<CampoDoValorDoImovel, number>>) => Promise<void> | void;
  desabilitado?: boolean;
  aviso?: string | null;
}) {
  const t = useT();
  const [rascunho, setRascunho] = useState<Record<CampoDoValorDoImovel, string>>(() => textosDe(valores));
  const [valoresVistos, setValoresVistos] = useState(valores);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  if (valores !== valoresVistos) {
    setValoresVistos(valores);
    setRascunho(textosDe(valores));
  }

  async function salvar() {
    if (!onSalvar || desabilitado || salvando) return;
    const patch: Partial<Record<CampoDoValorDoImovel, number>> = {};
    for (const campo of CAMPOS_DO_VALOR_DO_IMOVEL) {
      const bruto = rascunho[campo].trim().replace(",", ".");
      if (!bruto) continue;
      const n = Number(bruto);
      if (!Number.isFinite(n) || n < 0) {
        setErro(t("Informe um valor mensal válido, em reais."));
        return;
      }
      if (n !== valores[campo].valor) patch[campo] = Math.round(n * 100) / 100;
    }
    if (Object.keys(patch).length === 0) return;
    setErro(null);
    setSalvando(true);
    try {
      await onSalvar(patch);
    } catch (e) {
      setErro(e instanceof Error && e.message ? e.message : t("Não foi possível gravar os valores do imóvel."));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <fieldset className="space-y-2 rounded-md border border-border p-2" data-testid="campos-imovel-processo">
      <legend className="px-1 text-[11px] font-semibold">{t("Valores do imóvel")}</legend>
      <p className="text-[11px] text-muted-foreground">
        {t("3× usa aluguel + condomínio + IPTU + seguro-incêndio. O seguro-fiança é informativo.")}
      </p>
      {aviso && <p className="text-[11px] text-muted-foreground">{aviso}</p>}
      {erro && <p role="alert" className="text-xs text-destructive">{erro}</p>}
      {CAMPOS_DO_VALOR_DO_IMOVEL.map((campo) => {
        const obrigatorio = (CAMPOS_OBRIGATORIOS_DO_PACOTE as readonly string[]).includes(campo);
        const origem = valores[campo].origem;
        return (
          <label key={campo} className="block text-[11px]">
            {t(ROTULO_CAMPO_TELA[campo])}
            {!obrigatorio && (
              <span className="ml-1 font-normal text-muted-foreground">{t("(não entra no 3×)")}</span>
            )}
            <Input
              className="h-8 text-xs"
              inputMode="decimal"
              value={rascunho[campo]}
              disabled={desabilitado || salvando || !onSalvar}
              onChange={(e) => setRascunho((a) => ({ ...a, [campo]: e.target.value }))}
              aria-label={t(ROTULO_CAMPO_TELA[campo])}
            />
            <span className="text-[10px] text-muted-foreground">
              {t("Origem")}: {t(rotuloDaOrigemDoValor(origem))}
              {obrigatorio && valores[campo].valor == null ? ` · ${t("obrigatório para FC e Migra")}` : ""}
            </span>
          </label>
        );
      })}
      {onSalvar && (
        <Button size="sm" variant="secondary" className="h-7 px-2 text-xs"
          disabled={desabilitado || salvando} onClick={() => void salvar()}>
          {salvando ? t("Salvando valores…") : t("Salvar valores do imóvel")}
        </Button>
      )}
    </fieldset>
  );
}

function textosDe(valores: ValoresDoImovel): Record<CampoDoValorDoImovel, string> {
  const saida = {} as Record<CampoDoValorDoImovel, string>;
  for (const campo of CAMPOS_DO_VALOR_DO_IMOVEL) {
    saida[campo] = valores[campo].valor == null ? "" : String(valores[campo].valor);
  }
  return saida;
}

type ValorJson = {
  valor: number | null;
  origem: OrigemDoValorDoImovel | null;
  editado_em: string | null;
};

function valoresDeJson(bruto: Record<string, ValorJson> | undefined): ValoresDoImovel {
  const saida = valoresVazios();
  if (!bruto) return saida;
  for (const campo of CAMPOS_DO_VALOR_DO_IMOVEL) {
    const v = bruto[campo];
    if (!v) continue;
    saida[campo] = {
      valor: typeof v.valor === "number" ? v.valor : null,
      origem: v.origem ?? null,
      editado_por: null,
      editado_em: v.editado_em ?? null,
    };
  }
  return saida;
}

/** Ilha cliente: GET/PATCH do processo. Usado na aba Dados. */
export function CamposImovelProcessoDoProcesso({
  processoId,
  desabilitado = false,
}: {
  processoId: string;
  desabilitado?: boolean;
}) {
  const t = useT();
  const [valores, setValores] = useState<ValoresDoImovel>(valoresVazios());
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void apiClient.get<{ data: { valores: Record<string, ValorJson> } }>(
      `/api/v1/locacao/processos/${processoId}/valores-imovel`,
    ).then((r) => {
      if (!vivo) return;
      setValores(valoresDeJson(r.data.valores));
      setAviso(null);
    }).catch(() => {
      if (vivo) setAviso(t("Não foi possível ler os valores do imóvel."));
    });
    return () => { vivo = false; };
  }, [processoId, t]);

  return (
    <CamposImovelProcesso
      valores={valores}
      desabilitado={desabilitado}
      aviso={aviso}
      onSalvar={async (patch) => {
        const r = await apiClient.patch<{ data: { valores: Record<string, ValorJson> } }>(
          `/api/v1/locacao/processos/${processoId}/valores-imovel`,
          patch,
        );
        setValores(valoresDeJson(r.data.valores));
      }}
    />
  );
}

/** Onde a ficha aparece hoje: acha o processo da conversa ou avisa para abrir. */
export function CamposImovelProcessoNaFicha({
  conversationId,
  desabilitado = false,
}: {
  conversationId: string;
  desabilitado?: boolean;
}) {
  const t = useT();
  const [processoId, setProcessoId] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void apiClient.get<{ data: { habilitado?: boolean; processos?: Array<{ id: string }> } }>(
      `/api/v1/conversations/${conversationId}/locacao`,
    ).then((r) => {
      if (!vivo) return;
      const id = r.data.processos?.[0]?.id;
      if (id) setProcessoId(id);
    }).catch(() => {
      /* sem processo: o formulário fica visível, só não grava */
    });
    return () => { vivo = false; };
  }, [conversationId]);

  if (processoId) {
    return <CamposImovelProcessoDoProcesso processoId={processoId} desabilitado={desabilitado} />;
  }
  return (
    <CamposImovelProcesso
      valores={valoresVazios()}
      desabilitado
      aviso={t("Abra o processo para gravar os valores do imóvel. A edição humana não é sobrescrita.")}
    />
  );
}
