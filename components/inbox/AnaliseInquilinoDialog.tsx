"use client";

import { useCallback, useEffect, useState } from "react";

import { FormularioGerarContrato } from "@/components/inbox/GerarContratoDialog";
import { FichaPreliminarPainel } from "@/components/inbox/FichaPreliminarPainel";
import { CamposImovelProcessoNaFicha } from "@/components/locacao/CamposImovelProcesso";
import { ProcessoDeLocacaoPainel, type SecaoDoProcessoPainel } from "@/components/locacao/ProcessoDeLocacaoPainel";
import { VinculoSuperlogica } from "@/components/locacao/VinculoSuperlogica";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

type Aba = "dados" | "renda" | "fc" | "migra" | "contrato";

type ContatoLocacao = {
  id: string | null;
  superlogica_id_pessoa: string | null;
  superlogica_tipo: string | null;
};

const SECOES_DA_ABA: Record<Aba, readonly SecaoDoProcessoPainel[]> = {
  dados: ["cabecalho"],
  renda: ["renda", "relatorio"],
  fc: ["fc", "manual"],
  migra: ["seguro", "manual"],
  contrato: [],
};

export function AnaliseInquilinoDialog({
  aberto,
  onAbertoChange,
  conversationId,
  desabilitado = false,
  senhasPdf,
}: {
  aberto: boolean;
  onAbertoChange: (v: boolean) => void;
  conversationId: string;
  desabilitado?: boolean;
  senhasPdf: Array<{ nome: string; senha: string }>;
}) {
  const t = useT();
  const [aba, setAba] = useState<Aba>("dados");
  const [contato, setContato] = useState<ContatoLocacao | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [ocupado, setOcupado] = useState(false);

  const recarregarContato = useCallback(() => {
    setEpoch((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    void apiClient
      .get<{ data: { contato?: ContatoLocacao } }>(
        `/api/v1/conversations/${conversationId}/locacao`,
      )
      .then((r) => {
        if (!vivo) return;
        setContato(r.data?.contato ?? null);
      })
      .catch(() => {
        if (vivo) setContato(null);
      });
    return () => {
      vivo = false;
    };
  }, [aberto, conversationId, epoch]);

  return (
    <Dialog open={aberto} onOpenChange={(v) => { if (!v && ocupado) return; onAbertoChange(v); }}>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto bg-bg text-text sm:max-w-4xl"
        onInteractOutside={(e) => e.preventDefault()}
        data-testid="analise-inquilino-dialog"
      >
        <DialogHeader>
          <DialogTitle>{t("Análise de inquilino")}</DialogTitle>
          <DialogDescription>
            {t("A ficha, o vínculo Superlógica, a renda, a FC, a cotação e o contrato ficam nesta tela. Nada é enviado ao cliente.")}
          </DialogDescription>
        </DialogHeader>
        <Tabs value={aba} onValueChange={(v) => setAba(v as Aba)}>
          <TabsList aria-label={t("Análise de inquilino")}>
            <TabsTrigger value="dados" onClick={() => setAba("dados")}>{t("Dados")}</TabsTrigger>
            <TabsTrigger value="renda" onClick={() => setAba("renda")}>{t("Análise de renda")}</TabsTrigger>
            <TabsTrigger value="fc" onClick={() => setAba("fc")}>{t("Análise FC")}</TabsTrigger>
            <TabsTrigger value="migra" onClick={() => setAba("migra")}>{t("Análise Migra")}</TabsTrigger>
            <TabsTrigger value="contrato" onClick={() => setAba("contrato")}>{t("Gerar contrato")}</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className={aba === "dados" ? "space-y-3" : "hidden"} role="tabpanel" hidden={aba !== "dados"}>
          <CamposImovelProcessoNaFicha
            conversationId={conversationId}
            desabilitado={desabilitado}
          />
          <VinculoSuperlogica
            conversationId={conversationId}
            contato={contato}
            desabilitado={desabilitado}
            onAtualizado={recarregarContato}
          />
          <FichaPreliminarPainel
            conversationId={conversationId}
            desabilitado={desabilitado}
            senhasPdf={senhasPdf}
          />
        </div>
        <div className={aba === "contrato" ? "space-y-3" : "hidden"} role="tabpanel" hidden={aba !== "contrato"}>
          <FormularioGerarContrato
            conversationId={conversationId}
            desabilitado={desabilitado}
            onOcupadoChange={setOcupado}
          />
        </div>
        {aba !== "contrato" ? (
          <ProcessoDeLocacaoPainel
            conversationId={conversationId}
            desabilitado={desabilitado}
            secoes={SECOES_DA_ABA[aba]}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
