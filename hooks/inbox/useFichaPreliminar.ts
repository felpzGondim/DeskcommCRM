"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { apiClient } from "@/lib/api/client";
import { normalizarRendaUtilizada } from "@/lib/locacao/renda-utilizada";
import type { FichaPreliminar } from "@/lib/locacao/ficha-schema";
import { MS_CONSULTA_DA_GERACAO } from "@/lib/painel/relatorio-preliminar";

export type AvisoAnexo = { tipo: string; nome: string; tentativas?: number };
export type ResumoVersao = {
  versao: number;
  origem: "preliminar_ia" | "atendente";
  campos_alterados: string[];
  alterado_em: string;
};

type Geracao = {
  status: "gerando" | "erro";
  motivo: string | null;
  mensagem: string | null;
  evento_id: string;
};

type CorpoDaFicha = {
  atual: { versao: number; processo_versao?: number; ficha: FichaPreliminar; relatorio: string } | null;
  historico: ResumoVersao[];
  geracao?: Geracao | null;
};

export function useFichaPreliminar(conversationId: string, atualizacao = 0) {
  const [ficha, setFicha] = useState<FichaPreliminar | null>(null);
  const [relatorio, setRelatorio] = useState("");
  const [versao, setVersao] = useState(0);
  const [historico, setHistorico] = useState<ResumoVersao[]>([]);
  const [somenteLeitura, setSomenteLeitura] = useState(false);
  const [carregando, setCarregando] = useState<"gerar" | "salvar" | "ler" | null>("ler");
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const vivo = useRef(true);
  const versaoAtual = useRef(0);
  const processoVersao = useRef(0);

  const aplicar = useCallback((corpo: CorpoDaFicha) => {
    if (corpo.atual) {
      setFicha(normalizarRendaUtilizada(corpo.atual.ficha));
      setRelatorio(corpo.atual.relatorio);
      setVersao(corpo.atual.versao);
      versaoAtual.current = corpo.atual.versao;
      processoVersao.current = corpo.atual.processo_versao ?? 0;
    }
    setHistorico(corpo.historico ?? []);
    if (corpo.geracao?.status === "gerando") {
      setGerando(true);
      setErro(null);
    } else if (corpo.geracao?.status === "erro") {
      setGerando(false);
      setErro(corpo.geracao.mensagem);
    } else {
      setGerando(false);
    }
  }, []);

  const ler = useCallback(async (versaoQ?: number) => {
    const sufixo = versaoQ && versaoQ > 0 ? `?versao=${versaoQ}` : "";
    const r = await apiClient.get<{ data: CorpoDaFicha }>(
      `/api/v1/conversations/${conversationId}/painel-agente/ficha${sufixo}`,
    );
    aplicar(r.data);
    return r.data;
  }, [aplicar, conversationId]);

  useEffect(() => {
    vivo.current = true;
    setCarregando("ler");
    void ler()
      .catch(() => {
        if (vivo.current) setErro(null);
      })
      .finally(() => {
        if (vivo.current) setCarregando(null);
      });
    return () => {
      vivo.current = false;
    };
  }, [ler]);

  // A resposta do agente pode ter enfileirado a ficha fora do botão.
  // Uma consulta sem geração nova preserva as edições locais do atendente.
  useEffect(() => {
    if (atualizacao === 0) return;
    let cancelado = false;
    void apiClient.get<{ data: CorpoDaFicha }>(
      `/api/v1/conversations/${conversationId}/painel-agente/ficha`,
    ).then((r) => {
      if (cancelado) return;
      if (r.data.geracao || (r.data.atual?.versao ?? 0) > versaoAtual.current || (r.data.atual?.processo_versao ?? 0) > processoVersao.current) aplicar(r.data);
    }).catch(() => { /* o GET inicial ou a próxima resposta permite retomar */ });
    return () => { cancelado = true; };
  }, [aplicar, atualizacao, conversationId]);

  useEffect(() => {
    if (!gerando) return;
    let cancelado = false;
    const tick = async () => {
      try {
        const data = await ler();
        if (cancelado) return;
        if (data.geracao?.status !== "gerando") setCarregando(null);
      } catch {
        if (!cancelado) setErro(null);
      }
    };
    const id = window.setInterval(() => void tick(), MS_CONSULTA_DA_GERACAO);
    void tick();
    return () => {
      cancelado = true;
      window.clearInterval(id);
    };
  }, [gerando, ler]);

  async function gerar(senhasPdf: Array<{ nome: string; senha: string }>) {
    if (carregando || gerando) return;
    setErro(null);
    setCarregando("gerar");
    try {
      await apiClient.post<{ data: { status: string; evento_id: string } }>(
        `/api/v1/conversations/${conversationId}/painel-agente/ficha`,
        { etapa: "gerar", ...(senhasPdf.length ? { senhasPdf } : {}) },
      );
      setGerando(true);
      setSomenteLeitura(false);
      setCarregando(null);
    } catch (e) {
      setGerando(false);
      setCarregando(null);
      setErro(e instanceof Error && e.message ? e.message : null);
    }
  }

  async function salvar(fichaAtual: FichaPreliminar, relatorioAtual: string, baseVersao: number) {
    if (carregando || gerando) return;
    setErro(null);
    setCarregando("salvar");
    try {
      const r = await apiClient.post<{ data: CorpoDaFicha & { versao: number; processo_versao?: number; ficha: FichaPreliminar; relatorio: string } }>(
        `/api/v1/conversations/${conversationId}/painel-agente/ficha`,
        { etapa: "salvar", ficha: fichaAtual, relatorio: relatorioAtual, base_versao: baseVersao, processo_base_versao: processoVersao.current },
      );
      setFicha(normalizarRendaUtilizada(r.data.ficha));
      setRelatorio(r.data.relatorio);
      setVersao(r.data.versao);
      versaoAtual.current = r.data.versao;
      processoVersao.current = r.data.processo_versao ?? 0;
      setHistorico(r.data.historico ?? []);
      window.dispatchEvent(new CustomEvent("locacao:atualizada", { detail: { conversationId } }));
      return true;
    } catch (e) {
      setErro(e instanceof Error && e.message ? e.message : null);
      return false;
    } finally {
      setCarregando(null);
    }
  }

  async function verVersao(n: number) {
    setCarregando("ler");
    try {
      await ler(n);
      setSomenteLeitura(true);
    } catch (e) {
      setErro(e instanceof Error && e.message ? e.message : null);
    } finally {
      setCarregando(null);
    }
  }

  return {
    ficha,
    setFicha,
    relatorio,
    setRelatorio,
    versao,
    historico,
    somenteLeitura,
    setSomenteLeitura,
    carregando,
    gerando,
    erro,
    setErro,
    gerar,
    salvar,
    verVersao,
  };
}
