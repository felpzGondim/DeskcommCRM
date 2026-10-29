"use client";

import { useCallback, useEffect, useState } from "react";

import { FormularioGerarContrato } from "@/components/inbox/GerarContratoDialog";
import { FichaPreliminarPainel } from "@/components/inbox/FichaPreliminarPainel";
import { DocumentosLocacaoPainel } from "@/components/locacao/DocumentosLocacaoPainel";
import { ProcessoDeLocacaoPainel, type SecaoDoProcessoPainel } from "@/components/locacao/ProcessoDeLocacaoPainel";
import { VinculoSuperlogica } from "@/components/locacao/VinculoSuperlogica";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

type Aba = "dados" | "renda" | "fc" | "migra" | "relatorio" | "contrato" | "documentos" | "sincronizacao";

type ContatoLocacao = {
  id: string | null;
  superlogica_id_pessoa: string | null;
  superlogica_tipo: string | null;
};

const SECOES_DA_ABA: Record<Aba, readonly SecaoDoProcessoPainel[]> = {
  dados: [],
  renda: ["renda"],
  fc: ["fc", "manual"],
  migra: ["seguro", "manual"],
  relatorio: ["relatorio"],
  contrato: [],
  documentos: [],
  sincronizacao: [],
};

export function AnaliseInquilinoDialog({
  aberto,
  onAbertoChange,
  conversationId,
  desabilitado = false,
  senhasPdf,
  atualizacaoFicha = 0,
}: {
  atualizacaoFicha?: number;
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
    const atualizar = (e: Event) => { if ((e as CustomEvent<{conversationId: string}>).detail?.conversationId === conversationId) setEpoch((n) => n + 1); };
    window.addEventListener("locacao:atualizada", atualizar);
    return () => window.removeEventListener("locacao:atualizada", atualizar);
  }, [conversationId]);

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
          <DialogTitle>{t("Cadastro e locação")}</DialogTitle>
          <DialogDescription>
            {t("A ficha, o vínculo Superlógica, a renda, a FC, a cotação e o contrato ficam nesta tela. Nada é enviado ao cliente.")}
          </DialogDescription>
        </DialogHeader>
        <Tabs value={aba} onValueChange={(v) => { if (!ocupado) setAba(v as Aba); }}>
          <TabsList className="h-auto flex-wrap justify-start" aria-label={t("Cadastro e locação")}>
            <TabsTrigger disabled={ocupado} value="dados" onClick={() => setAba("dados")}>{t("1. Dados")}</TabsTrigger>
            <TabsTrigger disabled={ocupado} value="renda" onClick={() => setAba("renda")}>{t("2. Renda")}</TabsTrigger>
            <TabsTrigger disabled={ocupado} value="fc" onClick={() => setAba("fc")}>{t("3. FCAnálise")}</TabsTrigger>
            <TabsTrigger disabled={ocupado} value="migra" onClick={() => setAba("migra")}>{t("4. Migra")}</TabsTrigger>
            <TabsTrigger disabled={ocupado} value="relatorio" onClick={() => setAba("relatorio")}>{t("5. Relatório")}</TabsTrigger>
            <TabsTrigger disabled={ocupado} value="contrato" onClick={() => setAba("contrato")}>{t("6. Contrato")}</TabsTrigger>
            <TabsTrigger disabled={ocupado} value="documentos" onClick={() => setAba("documentos")}>{t("Documentos e relatórios")}</TabsTrigger>
            <TabsTrigger disabled={ocupado} value="sincronizacao" onClick={() => setAba("sincronizacao")}>{t("Superlógica")}</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className={aba === "dados" ? "space-y-3" : "hidden"} role="tabpanel" hidden={aba !== "dados"}>
          <FichaPreliminarPainel
            atualizacao={atualizacaoFicha + epoch}
            conversationId={conversationId}
            desabilitado={desabilitado}
            senhasPdf={senhasPdf}
          />
        </div>
        <div className={aba === "contrato" ? "space-y-3" : "hidden"} role="tabpanel" hidden={aba !== "contrato"}>
          <FormularioGerarContrato
            key={epoch}
            conversationId={conversationId}
            desabilitado={desabilitado}
            onOcupadoChange={setOcupado}
          />
        </div>
        {aba === "documentos" && <DocumentosLocacaoPainel conversationId={conversationId} atualizacao={epoch + atualizacaoFicha} desabilitado={desabilitado} />}
        <div hidden={aba !== "sincronizacao"} role="tabpanel">
          <VinculoSuperlogica
            conversationId={conversationId}
            contato={contato}
            desabilitado={desabilitado}
            onAtualizado={recarregarContato}
          />
        </div>
        {SECOES_DA_ABA[aba].length > 0 ? (
          <ProcessoDeLocacaoPainel
            key={aba}
            conversationId={conversationId}
            desabilitado={desabilitado}
            secoes={SECOES_DA_ABA[aba]}
            atualizacao={epoch + atualizacaoFicha}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
