"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { FormularioGerarContrato } from "@/components/inbox/GerarContratoDialog";
import { FichaPreliminarPainel } from "@/components/inbox/FichaPreliminarPainel";
import { AbaComExecucao } from "@/components/locacao/AbaComExecucao";
import { DocumentosLocacaoPainel } from "@/components/locacao/DocumentosLocacaoPainel";
import { ProcessoDeLocacaoPainel, type SecaoDoProcessoPainel } from "@/components/locacao/ProcessoDeLocacaoPainel";
import { VinculoSuperlogica } from "@/components/locacao/VinculoSuperlogica";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { rodarAbaDoModal } from "@/lib/locacao/acoes-do-modal";
import {
  ABAS_DO_MODAL_LOCACAO,
  MS_POLLING_DA_EXECUCAO,
  ROTULO_DA_ABA,
  ROTULO_DO_BOTAO_DA_ABA,
  checklistDaAba,
  execucaoEmAndamento,
  execucoesVazias,
  rendaConfirmadaNaVersaoAtual,
  type ExecucaoPublica,
} from "@/lib/locacao/execucao-da-aba";
import { rotuloDoStatusDoProcesso } from "@/lib/locacao/status";
import type { AbaDaExecucao } from "@/lib/locacao/vocabulario";

type ContatoLocacao = {
  id: string | null;
  superlogica_id_pessoa: string | null;
  superlogica_tipo: string | null;
};

type AnaliseLigada = {
  renda?: boolean;
  seguro?: boolean;
  fc?: boolean;
  relatorio?: boolean;
};

type ProcessoResumo = {
  id: string;
  status: string;
  ficha_versao?: number | null;
  renda_confirmada_em?: string | null;
  renda_confirmada_ficha_versao?: number | null;
};

const SECOES_DA_ABA: Record<AbaDaExecucao, readonly SecaoDoProcessoPainel[]> = {
  dados: [],
  renda: ["renda"],
  fc: ["fc", "manual"],
  migra: ["seguro", "manual"],
  relatorio: ["relatorio"],
  contrato: [],
  documentos: [],
};

const CHAVE_ANALISE: Record<AbaDaExecucao, keyof AnaliseLigada | null> = {
  dados: null,
  renda: "renda",
  fc: "fc",
  migra: "seguro",
  relatorio: "relatorio",
  contrato: null,
  documentos: null,
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
  const [aba, setAba] = useState<AbaDaExecucao>("dados");
  const [contato, setContato] = useState<ContatoLocacao | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const [rodando, setRodando] = useState(false);
  const [execucoes, setExecucoes] = useState(execucoesVazias);
  const [entradaAtual, setEntradaAtual] = useState<string | null>(null);
  const [entradaSuja, setEntradaSuja] = useState(false);
  const [analise, setAnalise] = useState<AnaliseLigada>({});
  const [processo, setProcesso] = useState<ProcessoResumo | null>(null);
  const [erroImediato, setErroImediato] = useState<Partial<Record<AbaDaExecucao, string>>>({});
  const emAndamentoAntes = useRef(false);

  const recarregarContato = useCallback(() => {
    setEpoch((n) => n + 1);
  }, []);

  const carregar = useCallback(async () => {
    const r = await apiClient.get<{
      data: {
        contato?: ContatoLocacao;
        execucoes?: Partial<Record<AbaDaExecucao, ExecucaoPublica | null>>;
        entrada_atual?: string | null;
        etapa_quadro?: { status: string; processo_id: string } | null;
        analise?: AnaliseLigada;
        processos?: ProcessoResumo[];
      };
    }>(`/api/v1/conversations/${conversationId}/locacao`);
    setContato(r.data?.contato ?? null);
    setAnalise(r.data?.analise ?? {});
    const mapa = execucoesVazias();
    for (const chave of ABAS_DO_MODAL_LOCACAO) {
      mapa[chave] = r.data?.execucoes?.[chave] ?? null;
    }
    setExecucoes(mapa);
    setEntradaAtual(r.data?.entrada_atual ?? null);
    setProcesso(r.data?.processos?.[0] ?? null);
  }, [conversationId]);

  useEffect(() => {
    const atualizar = (e: Event) => {
      if ((e as CustomEvent<{ conversationId: string }>).detail?.conversationId === conversationId) {
        setEpoch((n) => n + 1);
        setEntradaSuja(false);
      }
    };
    window.addEventListener("locacao:atualizada", atualizar);
    return () => window.removeEventListener("locacao:atualizada", atualizar);
  }, [conversationId]);

  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    void carregar().catch(() => {
      if (vivo) {
        setContato(null);
        setExecucoes(execucoesVazias());
        setProcesso(null);
      }
    });
    return () => {
      vivo = false;
    };
  }, [aberto, conversationId, epoch, atualizacaoFicha, carregar]);

  const emAndamento = ABAS_DO_MODAL_LOCACAO.some((id) => execucaoEmAndamento(execucoes[id]));
  useEffect(() => {
    if (!aberto || !emAndamento) return;
    const tick = window.setInterval(() => {
      void carregar().catch(() => undefined);
    }, MS_POLLING_DA_EXECUCAO);
    return () => window.clearInterval(tick);
  }, [aberto, emAndamento, carregar]);

  useEffect(() => {
    if (emAndamentoAntes.current && !emAndamento && aberto) {
      window.dispatchEvent(new CustomEvent("locacao:atualizada", { detail: { conversationId } }));
    }
    emAndamentoAntes.current = emAndamento;
  }, [emAndamento, aberto, conversationId]);

  async function rodar(alvo: AbaDaExecucao) {
    if (!processo || rodando || desabilitado) return;
    setRodando(true);
    setErroImediato((atual) => ({ ...atual, [alvo]: undefined }));
    try {
      await rodarAbaDoModal({
        conversationId,
        aba: alvo,
        processoId: processo.id,
        senhasPdf,
      });
    } catch (e) {
      const msg = e instanceof Error && e.message
        ? e.message
        : t("Não foi possível concluir.");
      setErroImediato((atual) => ({ ...atual, [alvo]: msg }));
    } finally {
      window.dispatchEvent(new CustomEvent("locacao:atualizada", { detail: { conversationId } }));
      setRodando(false);
    }
  }

  function contextoDaAba(alvo: AbaDaExecucao) {
    const chave = CHAVE_ANALISE[alvo];
    return {
      temProcesso: !!processo,
      rendaConfirmada: rendaConfirmadaNaVersaoAtual(processo),
      analiseLigada: chave ? analise[chave] === true : true,
    };
  }

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
        <p className="text-xs text-text-muted" data-testid="etapa-do-quadro">
          {t("Etapa no quadro")}: {processo
            ? rotuloDoStatusDoProcesso(processo.status, t)
            : t("Sem processo")}
          {" · "}
          {t("O modal não move o card do quadro.")}
        </p>
        <Tabs value={aba} onValueChange={(v) => { if (!ocupado) setAba(v as AbaDaExecucao); }}>
          <TabsList className="h-auto flex-wrap justify-start" aria-label={t("Cadastro e locação")}>
            {ABAS_DO_MODAL_LOCACAO.map((id) => (
              <TabsTrigger key={id} disabled={ocupado} value={id} onClick={() => setAba(id)}>
                {t(ROTULO_DA_ABA[id])}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className={aba === "dados" ? "space-y-3" : "hidden"} role="tabpanel" hidden={aba !== "dados"}>
          <AbaComExecucao
            execucao={execucoes.dados}
            checklist={checklistDaAba("dados", contextoDaAba("dados"))}
            hashAtual={entradaAtual}
            entradaSuja={entradaSuja}
          >
            <FichaPreliminarPainel
              atualizacao={atualizacaoFicha + epoch}
              conversationId={conversationId}
              desabilitado={desabilitado}
              senhasPdf={senhasPdf}
              onEntradaEditada={() => setEntradaSuja(true)}
              onSalvo={recarregarContato}
            />
            <VinculoSuperlogica
              conversationId={conversationId}
              contato={contato}
              desabilitado={desabilitado}
              onAtualizado={recarregarContato}
            />
          </AbaComExecucao>
        </div>
        {(["renda", "fc", "migra", "relatorio"] as const).map((id) => (
          <div key={id} className={aba === id ? "space-y-3" : "hidden"} role="tabpanel" hidden={aba !== id}>
            <AbaComExecucao
              execucao={execucoes[id]}
              checklist={checklistDaAba(id, contextoDaAba(id))}
              hashAtual={entradaAtual}
              entradaSuja={entradaSuja}
              rotuloBotao={ROTULO_DO_BOTAO_DA_ABA[id]}
              onRodar={() => rodar(id)}
              desabilitado={desabilitado}
              ocupado={rodando}
              erroImediato={erroImediato[id]}
            >
              {SECOES_DA_ABA[id].length > 0 ? (
                <ProcessoDeLocacaoPainel
                  conversationId={conversationId}
                  desabilitado={desabilitado}
                  secoes={SECOES_DA_ABA[id]}
                  atualizacao={epoch + atualizacaoFicha}
                  esconderBotoesPrincipais
                />
              ) : null}
            </AbaComExecucao>
          </div>
        ))}
        <div className={aba === "contrato" ? "space-y-3" : "hidden"} role="tabpanel" hidden={aba !== "contrato"}>
          <AbaComExecucao
            execucao={execucoes.contrato}
            checklist={checklistDaAba("contrato", contextoDaAba("contrato"))}
            hashAtual={entradaAtual}
            entradaSuja={entradaSuja}
          >
            <FormularioGerarContrato
              key={epoch}
              conversationId={conversationId}
              desabilitado={desabilitado}
              onOcupadoChange={setOcupado}
            />
          </AbaComExecucao>
        </div>
        {aba === "documentos" ? (
          <AbaComExecucao
            execucao={execucoes.documentos}
            checklist={checklistDaAba("documentos", contextoDaAba("documentos"))}
          >
            <DocumentosLocacaoPainel
              conversationId={conversationId}
              atualizacao={epoch + atualizacaoFicha}
              desabilitado={desabilitado}
            />
          </AbaComExecucao>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
