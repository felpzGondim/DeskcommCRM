"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { copyToClipboard } from "@/lib/clipboard";
import { rotuloDoStatusDoProcesso } from "@/lib/locacao/status";

type CardSeguro = { seguradora?: string; codigo?: string; codigo_cotacao?: string; status?: string; plano?: string };
type FiadorFc = { id: string; papel?: string; cpf_mascarado?: string | null };
type CampoCopia = { chave: string; rotulo: string; valor: string; sensivel?: boolean };
type ManualResumo = {
  campos: CampoCopia[];
  solidarios: Array<{ nome: string; cpf_mascarado: string }>;
  vigencia: { inicio: string; fim: string };
  links: { fc: string; migra: string };
  passos_fc: string[];
  passos_migra: string[];
  etapa_fc?: boolean;
  etapa_seguro?: boolean;
  fc_pedido_id?: string | null;
  seguro_pedido_id?: string | null;
};

function estadoAbreManual(estado: string | null | undefined): boolean {
  return estado === "erro" || estado === "login_necessario";
}

async function arquivoParaAnexo(file: File): Promise<{ bytes_b64: string; mime: string } | null> {
  if (file.size === 0 || file.size > 2 * 1024 * 1024) return null;
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return { bytes_b64: btoa(bin), mime: file.type || "application/pdf" };
}

type ProcessoResumo = {
  id: string;
  status: string;
  imovel: string;
  encerrado_em: string | null;
  renda_confirmada_em?: string | null;
  relatorio_desatualizado?: boolean;
  seguro_desatualizado?: boolean;
  fc_desatualizado?: boolean;
  renda_mensal?: number | null;
  renda_proposta_fc?: number | null;
  alertas?: string[];
  seguro_pedido_id?: string | null;
  seguro_estado?: string | null;
  seguro_cards?: CardSeguro[];
  seguro_documento_id?: string | null;
  fc_pedido_id?: string | null;
  fc_estado?: string | null;
  fc_score?: number | string | null;
  fc_risco?: string | null;
  fc_id?: string | null;
  fc_documento_id?: string | null;
  fc_reaproveitada?: boolean;
  fc_cobranca?: "ja_cobrado" | "incerta" | null;
  fc_fiadores?: FiadorFc[];
  relatorio_rascunho?: string | null;
  relatorio_rascunho_em?: string | null;
  relatorio_aprovado_em?: string | null;
  relatorio_documento_id?: string | null;
};

type AvisoSenha = { tipo?: string; nome: string; tentativas?: number };

function rotuloEstadoSeguro(estado: string): string {
  if (estado === "solicitada" || estado === "cotando") return "Cotação em andamento";
  if (estado === "concluida") return "Cotação concluída";
  if (estado === "login_necessario") return "Login necessário no Hub";
  if (estado === "erro") return "Cotação com erro";
  if (estado === "cancelada") return "Cotação cancelada";
  return "Cotação em andamento";
}

function rotuloEstadoFc(estado: string): string {
  if (estado === "solicitada") return "FC em andamento";
  if (estado === "aguardando_cobranca") return "FC aguardando confirmação";
  if (estado === "cobrando") return "FC em cobrança";
  if (estado === "concluida") return "FC concluída";
  if (estado === "reaproveitada") return "FC reaproveitada (90 dias)";
  if (estado === "login_necessario") return "Login necessário no Hub";
  if (estado === "erro") return "FC com erro";
  if (estado === "cancelada") return "FC cancelada";
  return "FC em andamento";
}

export type SecaoDoProcessoPainel =
  | "cabecalho"
  | "renda"
  | "seguro"
  | "fc"
  | "relatorio"
  | "manual";

export function ProcessoDeLocacaoPainel({
  conversationId,
  desabilitado = false,
  secoes,
  atualizacao = 0,
}: {
  conversationId: string;
  desabilitado?: boolean;
  secoes?: readonly SecaoDoProcessoPainel[];
  atualizacao?: number;
}) {
  const t = useT();
  const [habilitado, setHabilitado] = useState(false);
  const [analiseRenda, setAnaliseRenda] = useState(false);
  const [analiseSeguro, setAnaliseSeguro] = useState(false);
  const [analiseFc, setAnaliseFc] = useState(false);
  const [analiseManual, setAnaliseManual] = useState(false);
  const [analiseRelatorio, setAnaliseRelatorio] = useState(false);
  const [processos, setProcessos] = useState<ProcessoResumo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [analisando, setAnalisando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [cotando, setCotando] = useState(false);
  const [salvandoFc, setSalvandoFc] = useState(false);
  const [confirmandoFc, setConfirmandoFc] = useState(false);
  const [avisos, setAvisos] = useState<AvisoSenha[]>([]);
  const [senhas, setSenhas] = useState<Record<string, string>>({});
  const [resumo, setResumo] = useState<string | null>(null);
  const [resumoSeguro, setResumoSeguro] = useState<string | null>(null);
  const [resumoFc, setResumoFc] = useState<string | null>(null);
  const [manual, setManual] = useState<ManualResumo | null>(null);
  const [resumoManual, setResumoManual] = useState<string | null>(null);
  const [cpfRevelado, setCpfRevelado] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [revelandoCpf, setRevelandoCpf] = useState(false);
  const [registrandoFc, setRegistrandoFc] = useState(false);
  const [registrandoSeguro, setRegistrandoSeguro] = useState(false);
  const [gerandoRelatorio, setGerandoRelatorio] = useState(false);
  const [aprovandoRelatorio, setAprovandoRelatorio] = useState(false);
  const [resumoRelatorio, setResumoRelatorio] = useState<string | null>(null);
  const [scoreManual, setScoreManual] = useState("");
  const [riscoManual, setRiscoManual] = useState("");
  const [idFcManual, setIdFcManual] = useState("");
  const [cardsManual, setCardsManual] = useState<CardSeguro[]>([{}]);
  const [laudoManual, setLaudoManual] = useState<File | null>(null);
  const [printManual, setPrintManual] = useState<File | null>(null);
  const mostra = (s: SecaoDoProcessoPainel) => !secoes || secoes.includes(s);
  const verCabecalho = mostra("cabecalho");
  const verRenda = mostra("renda");
  const verSeguro = mostra("seguro");
  const verFc = mostra("fc");
  const verRelatorio = mostra("relatorio");
  const verManual = mostra("manual");

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const r = await apiClient.get<{
          data: {
            habilitado?: boolean;
            analise?: { renda?: boolean; seguro?: boolean; fc?: boolean; manual?: boolean; relatorio?: boolean };
            processos?: ProcessoResumo[];
          };
        }>(`/api/v1/conversations/${conversationId}/locacao`);
        if (!vivo) return;
        setHabilitado(r.data?.habilitado === true);
        setAnaliseRenda(r.data?.analise?.renda === true);
        setAnaliseSeguro(r.data?.analise?.seguro === true);
        setAnaliseFc(r.data?.analise?.fc === true);
        setAnaliseManual(r.data?.analise?.manual === true);
        setAnaliseRelatorio(r.data?.analise?.relatorio === true);
        setProcessos(r.data?.processos ?? []);
      } catch {
        if (vivo) setHabilitado(false);
      }
    })();
    return () => { vivo = false; };
  }, [conversationId, atualizacao]);

  const processoAtivo = processos[0];
  const seguroEmCurso =
    analiseSeguro
    && (processoAtivo?.seguro_estado === "solicitada" || processoAtivo?.seguro_estado === "cotando");
  const fcEmCurso =
    analiseFc
    && (processoAtivo?.fc_estado === "solicitada" || processoAtivo?.fc_estado === "cobrando");

  useEffect(() => {
    if (!seguroEmCurso || !processoAtivo) return;
    const tick = window.setInterval(() => {
      void (async () => {
        try {
          const r = await apiClient.post<{
            data: {
              resumo?: string;
              estado?: string;
              cards?: CardSeguro[];
              documento_id?: string | null;
              pedido_id?: string;
            };
          }>(`/api/v1/conversations/${conversationId}/painel-agente/seguro`, {
            etapa: "status",
            processo_id: processoAtivo.id,
            pedido_id: processoAtivo.seguro_pedido_id ?? undefined,
          });
          setResumoSeguro(r.data?.resumo ?? null);
          setProcessos((atual) =>
            atual.map((p) =>
              p.id === processoAtivo.id
                ? {
                    ...p,
                    seguro_pedido_id: r.data?.pedido_id ?? p.seguro_pedido_id,
                    seguro_estado: r.data?.estado ?? p.seguro_estado,
                    seguro_cards: r.data?.cards ?? p.seguro_cards,
                    seguro_documento_id: r.data?.documento_id ?? p.seguro_documento_id,
                  }
                : p,
            ),
          );
        } catch {
          /* o próximo tick tenta de novo; o erro pontual não tapa a tela */
        }
      })();
    }, 15_000);
    return () => window.clearInterval(tick);
  }, [conversationId, seguroEmCurso, processoAtivo?.id, processoAtivo?.seguro_pedido_id, processoAtivo?.seguro_estado]);

  useEffect(() => {
    if (!fcEmCurso || !processoAtivo) return;
    const tick = window.setInterval(() => {
      void (async () => {
        try {
          const r = await apiClient.post<{
            data: {
              resumo?: string;
              estado?: string;
              score?: number | string | null;
              risco?: string | null;
              id_fc?: string | null;
              documento_id?: string | null;
              pedido_id?: string;
              cobranca?: "ja_cobrado" | "incerta" | null;
              reaproveitada?: boolean;
            };
          }>(`/api/v1/conversations/${conversationId}/painel-agente/fc`, {
            etapa: "status",
            processo_id: processoAtivo.id,
            pedido_id: processoAtivo.fc_pedido_id ?? undefined,
          });
          setResumoFc(r.data?.resumo ?? null);
          setProcessos((atual) =>
            atual.map((p) =>
              p.id === processoAtivo.id
                ? {
                    ...p,
                    fc_pedido_id: r.data?.pedido_id ?? p.fc_pedido_id,
                    fc_estado: r.data?.estado ?? p.fc_estado,
                    fc_score: r.data?.score ?? p.fc_score,
                    fc_risco: r.data?.risco ?? p.fc_risco,
                    fc_id: r.data?.id_fc ?? p.fc_id,
                    fc_documento_id: r.data?.documento_id ?? p.fc_documento_id,
                    fc_cobranca: r.data?.cobranca ?? p.fc_cobranca,
                    fc_reaproveitada: r.data?.reaproveitada ?? p.fc_reaproveitada,
                  }
                : p,
            ),
          );
        } catch {
          /* o próximo tick tenta de novo; o erro pontual não tapa a tela */
        }
      })();
    }, 15_000);
    return () => window.clearInterval(tick);
  }, [conversationId, fcEmCurso, processoAtivo?.id, processoAtivo?.fc_pedido_id, processoAtivo?.fc_estado]);

  const manualAberto = analiseManual && !!processoAtivo
    && (estadoAbreManual(processoAtivo.fc_estado) || estadoAbreManual(processoAtivo.seguro_estado));

  useEffect(() => {
    if (!manualAberto || !processoAtivo) {
      setManual(null);
      setCpfRevelado(null);
      return;
    }
    let vivo = true;
    void (async () => {
      try {
        const r = await apiClient.post<{ data: ManualResumo & { resumo?: string } }>(
          `/api/v1/conversations/${conversationId}/painel-agente/manual`,
          { etapa: "preparar", processo_id: processoAtivo.id },
        );
        if (!vivo) return;
        setManual({
          campos: r.data?.campos ?? [],
          solidarios: r.data?.solidarios ?? [],
          vigencia: r.data?.vigencia ?? { inicio: "", fim: "" },
          links: r.data?.links ?? { fc: "", migra: "" },
          passos_fc: r.data?.passos_fc ?? [],
          passos_migra: r.data?.passos_migra ?? [],
          etapa_fc: r.data?.etapa_fc === true,
          etapa_seguro: r.data?.etapa_seguro === true,
          fc_pedido_id: r.data?.fc_pedido_id ?? null,
          seguro_pedido_id: r.data?.seguro_pedido_id ?? null,
        });
        setResumoManual(r.data?.resumo ?? null);
      } catch {
        if (vivo) setManual(null);
      }
    })();
    return () => { vivo = false; };
  }, [conversationId, manualAberto, processoAtivo?.id, processoAtivo?.fc_estado, processoAtivo?.seguro_estado]);

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

  function aplicarSeguro(data: {
    resumo?: string;
    estado?: string;
    cards?: CardSeguro[];
    documento_id?: string | null;
    pedido_id?: string;
  }) {
    setResumoSeguro(data.resumo ?? null);
    setProcessos((atual) =>
      atual.map((p) =>
        p.id === processo?.id
          ? {
              ...p,
              seguro_pedido_id: data.pedido_id ?? p.seguro_pedido_id,
              seguro_estado: data.estado ?? p.seguro_estado,
              seguro_cards: data.cards ?? p.seguro_cards,
              seguro_documento_id: data.documento_id ?? p.seguro_documento_id,
            }
          : p,
      ),
    );
  }

  async function cotar() {
    if (cotando || desabilitado || !processo || !processo.renda_confirmada_em) return;
    setErro(null);
    setCotando(true);
    try {
      const r = await apiClient.post<{
        data: {
          resumo?: string;
          estado?: string;
          cards?: CardSeguro[];
          documento_id?: string | null;
          pedido_id?: string;
        };
      }>(`/api/v1/conversations/${conversationId}/painel-agente/seguro`, {
        etapa: "analisar",
        processo_id: processo.id,
      });
      aplicarSeguro(r.data ?? {});
    } catch (e) {
      setErro(e instanceof Error && e.message ? e.message : t("Não foi possível cotar o seguro-fiança."));
    } finally {
      setCotando(false);
    }
  }

  async function atualizarCotacao() {
    if (cotando || desabilitado || !processo) return;
    try {
      const r = await apiClient.post<{
        data: {
          resumo?: string;
          estado?: string;
          cards?: CardSeguro[];
          documento_id?: string | null;
          pedido_id?: string;
        };
      }>(`/api/v1/conversations/${conversationId}/painel-agente/seguro`, {
        etapa: "status",
        processo_id: processo.id,
        pedido_id: processo.seguro_pedido_id ?? undefined,
      });
      aplicarSeguro(r.data ?? {});
    } catch (e) {
      setErro(e instanceof Error && e.message ? e.message : t("Não foi possível consultar a cotação."));
    }
  }

  type DadosFc = {
    resumo?: string;
    estado?: string;
    score?: number | string | null;
    risco?: string | null;
    id_fc?: string | null;
    documento_id?: string | null;
    pedido_id?: string;
    cobranca?: "ja_cobrado" | "incerta" | null;
    reaproveitada?: boolean;
  };

  function aplicarFc(data: DadosFc) {
    setResumoFc(data.resumo ?? null);
    setProcessos((atual) =>
      atual.map((p) =>
        p.id === processo?.id
          ? {
              ...p,
              fc_pedido_id: data.pedido_id ?? p.fc_pedido_id,
              fc_estado: data.estado ?? p.fc_estado,
              fc_score: data.score ?? p.fc_score,
              fc_risco: data.risco ?? p.fc_risco,
              fc_id: data.id_fc ?? p.fc_id,
              fc_documento_id: data.documento_id ?? p.fc_documento_id,
              fc_cobranca: data.cobranca ?? p.fc_cobranca,
              fc_reaproveitada: data.reaproveitada ?? p.fc_reaproveitada,
            }
          : p,
      ),
    );
  }

  async function salvarFc(participanteId?: string) {
    if (salvandoFc || desabilitado || !processo || !processo.renda_confirmada_em) return;
    setErro(null);
    setSalvandoFc(true);
    try {
      const r = await apiClient.post<{ data: DadosFc }>(
        `/api/v1/conversations/${conversationId}/painel-agente/fc`,
        {
          etapa: "analisar",
          processo_id: processo.id,
          participante_id: participanteId,
        },
      );
      aplicarFc(r.data ?? {});
    } catch (e) {
      setErro(e instanceof Error && e.message ? e.message : t("Não foi possível analisar a FC."));
    } finally {
      setSalvandoFc(false);
    }
  }

  async function atualizarFc() {
    if (salvandoFc || desabilitado || !processo) return;
    try {
      const r = await apiClient.post<{ data: DadosFc }>(
        `/api/v1/conversations/${conversationId}/painel-agente/fc`,
        {
          etapa: "status",
          processo_id: processo.id,
          pedido_id: processo.fc_pedido_id ?? undefined,
        },
      );
      aplicarFc(r.data ?? {});
    } catch (e) {
      setErro(e instanceof Error && e.message ? e.message : t("Não foi possível consultar a FC."));
    }
  }

  async function confirmarFc() {
    if (confirmandoFc || desabilitado || !processo) return;
    setErro(null);
    setConfirmandoFc(true);
    try {
      const r = await apiClient.post<{ data: DadosFc }>(
        `/api/v1/conversations/${conversationId}/painel-agente/fc`,
        {
          etapa: "confirmar",
          processo_id: processo.id,
          pedido_id: processo.fc_pedido_id ?? undefined,
        },
      );
      aplicarFc(r.data ?? {});
    } catch (e) {
      const msg = e instanceof Error && e.message ? e.message : t("Não foi possível confirmar a cobrança da FC.");
      setErro(msg);
      if (/incerta/i.test(msg)) {
        setProcessos((atual) =>
          atual.map((p) => (p.id === processo.id ? { ...p, fc_cobranca: "incerta" } : p)),
        );
      }
    } finally {
      setConfirmandoFc(false);
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

  async function copiarCampo(chave: string, valor: string) {
    const ok = await copyToClipboard(valor);
    if (ok) {
      setCopiado(chave);
      window.setTimeout(() => setCopiado((atual) => (atual === chave ? null : atual)), 1500);
      return;
    }
    setErro(t("Não foi possível copiar."));
  }

  async function revelarCpf() {
    if (revelandoCpf || desabilitado || !processo || !manual) return;
    if (cpfRevelado) {
      setCpfRevelado(null);
      return;
    }
    setErro(null);
    setRevelandoCpf(true);
    try {
      const r = await apiClient.post<{ data: { cpf?: string; cpf_formatado?: string; resumo?: string } }>(
        `/api/v1/conversations/${conversationId}/painel-agente/manual`,
        { etapa: "revelar_cpf", processo_id: processo.id },
      );
      setCpfRevelado(r.data?.cpf_formatado ?? r.data?.cpf ?? null);
      setResumoManual(r.data?.resumo ?? null);
    } catch (e) {
      setErro(e instanceof Error && e.message ? e.message : t("Não há CPF na ficha deste processo para revelar."));
    } finally {
      setRevelandoCpf(false);
    }
  }

  async function registrarFcManual() {
    if (registrandoFc || desabilitado || !processo || !manual) return;
    setErro(null);
    setRegistrandoFc(true);
    try {
      const anexo = laudoManual ? await arquivoParaAnexo(laudoManual) : undefined;
      if (laudoManual && !anexo) {
        setErro(t("O arquivo anexado não pôde ser lido (PDF, PNG, JPG ou WEBP até 2 MB)."));
        return;
      }
      const r = await apiClient.post<{
        data: {
          resumo?: string;
          estado?: string;
          score?: number | string | null;
          risco?: string | null;
          id_fc?: string | null;
          documento_id?: string | null;
          pedido_id?: string;
        };
      }>(`/api/v1/conversations/${conversationId}/painel-agente/manual`, {
        etapa: "registrar_fc",
        processo_id: processo.id,
        pedido_id: manual.fc_pedido_id ?? processo.fc_pedido_id ?? undefined,
        score: scoreManual.trim() || undefined,
        risco: riscoManual.trim() || undefined,
        id_fc: idFcManual.trim() || undefined,
        anexo,
      });
      setResumoManual(r.data?.resumo ?? null);
      setProcessos((atual) =>
        atual.map((p) =>
          p.id === processo.id
            ? {
                ...p,
                fc_estado: r.data?.estado ?? "concluida",
                fc_score: r.data?.score ?? p.fc_score,
                fc_risco: r.data?.risco ?? p.fc_risco,
                fc_id: r.data?.id_fc ?? p.fc_id,
                fc_documento_id: r.data?.documento_id ?? p.fc_documento_id,
              }
            : p,
        ),
      );
    } catch (e) {
      setErro(e instanceof Error && e.message ? e.message : t("Não foi possível analisar a FC."));
    } finally {
      setRegistrandoFc(false);
    }
  }

  async function registrarSeguroManual() {
    if (registrandoSeguro || desabilitado || !processo || !manual) return;
    setErro(null);
    setRegistrandoSeguro(true);
    try {
      const anexo = printManual ? await arquivoParaAnexo(printManual) : undefined;
      if (printManual && !anexo) {
        setErro(t("O arquivo anexado não pôde ser lido (PDF, PNG, JPG ou WEBP até 2 MB)."));
        return;
      }
      const r = await apiClient.post<{
        data: {
          resumo?: string;
          estado?: string;
          cards?: CardSeguro[];
          documento_id?: string | null;
          pedido_id?: string;
        };
      }>(`/api/v1/conversations/${conversationId}/painel-agente/manual`, {
        etapa: "registrar_seguro",
        processo_id: processo.id,
        pedido_id: manual.seguro_pedido_id ?? processo.seguro_pedido_id ?? undefined,
        cards: cardsManual.filter((c) => c.seguradora || c.codigo || c.codigo_cotacao),
        anexo,
      });
      setResumoManual(r.data?.resumo ?? null);
      setProcessos((atual) =>
        atual.map((p) =>
          p.id === processo.id
            ? {
                ...p,
                seguro_estado: r.data?.estado ?? "concluida",
                seguro_cards: r.data?.cards ?? p.seguro_cards,
                seguro_documento_id: r.data?.documento_id ?? p.seguro_documento_id,
              }
            : p,
        ),
      );
    } catch (e) {
      setErro(e instanceof Error && e.message ? e.message : t("Não foi possível cotar o seguro-fiança."));
    } finally {
      setRegistrandoSeguro(false);
    }
  }

  async function gerarRelatorio() {
    if (gerandoRelatorio || desabilitado || !processo) return;
    setErro(null);
    setGerandoRelatorio(true);
    try {
      const r = await apiClient.post<{
        data: {
          resumo?: string;
          risco?: string | null;
          renda?: { comprovada?: number | null };
        };
      }>(`/api/v1/conversations/${conversationId}/painel-agente/relatorio`, {
        etapa: "gerar",
        processo_id: processo.id,
      });
      setResumoRelatorio(r.data?.resumo ?? null);
      setProcessos((atual) =>
        atual.map((p) =>
          p.id === processo.id
            ? { ...p, relatorio_rascunho: r.data?.resumo ?? p.relatorio_rascunho }
            : p,
        ),
      );
    } catch (e) {
      setErro(e instanceof Error && e.message ? e.message : t("Não foi possível gerar o relatório."));
    } finally {
      setGerandoRelatorio(false);
    }
  }

  async function aprovarRelatorio() {
    if (aprovandoRelatorio || desabilitado || !processo) return;
    setErro(null);
    setAprovandoRelatorio(true);
    try {
      const r = await apiClient.post<{
        data: { resumo?: string; documento_id?: string | null };
      }>(`/api/v1/conversations/${conversationId}/painel-agente/relatorio`, {
        etapa: "aprovar",
        processo_id: processo.id,
      });
      setResumoRelatorio(r.data?.resumo ?? t("Relatório aprovado."));
      setProcessos((atual) =>
        atual.map((p) =>
          p.id === processo.id
            ? {
                ...p,
                relatorio_aprovado_em: new Date().toISOString(),
                relatorio_documento_id: r.data?.documento_id ?? p.relatorio_documento_id,
              }
            : p,
        ),
      );
    } catch (e) {
      setErro(e instanceof Error && e.message ? e.message : t("Não foi possível aprovar o relatório."));
    } finally {
      setAprovandoRelatorio(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-border p-2">
      {verCabecalho ? <>
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
      </> : null}
      {processo?.relatorio_desatualizado && <p role="status" className="text-xs text-amber-600">{t("Os dados foram alterados. Atualize o relatório consolidado; consultas anteriores preservam os dados da emissão.")}</p>}
      {verRenda && analiseRenda ? (
        <div className="space-y-1.5 border-t border-border pt-2" data-testid="analise-renda">
          <p className="text-xs font-medium">{t("Análise de renda")}</p>
          {!processo ? (
            <p className="text-xs text-text-muted">{t("Abra um processo antes de analisar a renda.")}</p>
          ) : (
            <>
              {typeof processo.renda_mensal === "number" ? (
                <p className="text-xs">{t("RENDA")}: R$ {processo.renda_mensal.toFixed(2)}</p>
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
      {verSeguro && analiseSeguro ? (
        <div className="space-y-1.5 border-t border-border pt-2" data-testid="analise-seguro">
          <p className="text-xs font-medium">{t("Seguro-fiança")}</p>
          {processo?.seguro_desatualizado && <p role="status" className="text-xs text-amber-600">{t("Esta cotação utilizou uma versão anterior dos dados. Confira antes de continuar.")}</p>}
          {!processo ? (
            <p className="text-xs text-text-muted">{t("Abra um processo antes de cotar o seguro-fiança.")}</p>
          ) : !processo.renda_confirmada_em ? (
            <p className="text-xs text-text-muted">
              {t("Confirme a renda antes de analisar o seguro-fiança ou a FC.")}
            </p>
          ) : (
            <>
              {processo.seguro_estado ? (
                <p className="text-xs text-text-muted">
                  {t("Estado da cotação")}: {t(rotuloEstadoSeguro(processo.seguro_estado))}
                </p>
              ) : null}
              {resumoSeguro ? <p className="text-xs whitespace-pre-wrap">{resumoSeguro}</p> : null}
              {(processo.seguro_cards ?? []).slice(0, 8).map((card, i) => (
                <p key={`${card.codigo ?? card.codigo_cotacao ?? i}`} className="text-[11px] text-text-muted">
                  {[card.seguradora, card.codigo ?? card.codigo_cotacao, card.status, card.plano]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              ))}
              {processo.seguro_documento_id ? (
                <p className="text-xs text-text-muted">{t("Print da cotação guardado.")}</p>
              ) : null}
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs"
                  disabled={desabilitado || cotando}
                  onClick={() => void cotar()}>
                  {cotando ? t("Cotando seguro-fiança…") : t("Analisar seguro-fiança")}
                </Button>
                {processo.seguro_pedido_id ? (
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
                    disabled={desabilitado || cotando}
                    onClick={() => void atualizarCotacao()}>
                    {t("Atualizar cotação")}
                  </Button>
                ) : null}
              </div>
            </>
          )}
        </div>
      ) : null}
      {verFc && analiseFc ? (
        <div className="space-y-1.5 border-t border-border pt-2" data-testid="analise-fc">
          <p className="text-xs font-medium">{t("FC Score+")}</p>
          {processo?.fc_desatualizado && <p role="status" className="text-xs text-amber-600">{t("Esta FC utilizou uma versão anterior dos dados. Confira antes de continuar.")}</p>}
          {!processo ? (
            <p className="text-xs text-text-muted">{t("Abra um processo antes de analisar a FC.")}</p>
          ) : !processo.renda_confirmada_em ? (
            <p className="text-xs text-text-muted">
              {t("Confirme a renda antes de analisar o seguro-fiança ou a FC.")}
            </p>
          ) : (
            <>
              {processo.fc_estado ? (
                <p className="text-xs text-text-muted">
                  {t("Estado da FC")}: {t(rotuloEstadoFc(processo.fc_estado))}
                </p>
              ) : null}
              {processo.fc_score != null ? (
                <p className="text-xs">{t("Score")}: {String(processo.fc_score)}</p>
              ) : null}
              {processo.fc_risco ? (
                <p className="text-xs">{t("Risco")}: {processo.fc_risco}</p>
              ) : null}
              {processo.fc_id ? (
                <p className="text-xs text-text-muted">{t("ID-FC")}: {processo.fc_id}</p>
              ) : null}
              {resumoFc ? <p className="text-xs whitespace-pre-wrap">{resumoFc}</p> : null}
              {processo.fc_cobranca === "incerta" ? (
                <p className="text-xs text-destructive" role="alert">
                  {t("A cobrança da FC ficou incerta. Nada foi confirmado daqui. Não repetimos sozinhos — clique de novo só se tiver conferido no Hub.")}
                </p>
              ) : null}
              {processo.fc_documento_id ? (
                <p className="text-xs text-text-muted">{t("Laudo da FC guardado.")}</p>
              ) : null}
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs"
                  disabled={desabilitado || salvandoFc || confirmandoFc}
                  onClick={() => void salvarFc()}>
                  {salvandoFc ? t("Salvando FC Score+…") : t("Analisar FC")}
                </Button>
                {processo.fc_estado === "aguardando_cobranca" || processo.fc_estado === "login_necessario" || processo.fc_cobranca === "incerta" ? (
                  <Button size="sm" className="h-7 px-2 text-xs"
                    disabled={desabilitado || salvandoFc || confirmandoFc}
                    onClick={() => void confirmarFc()}>
                    {confirmandoFc
                      ? t("Confirmando cobrança da FC…")
                      : t("Confirmar cobrança da FC (vai gastar créditos)")}
                  </Button>
                ) : null}
                {processo.fc_pedido_id ? (
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
                    disabled={desabilitado || salvandoFc || confirmandoFc}
                    onClick={() => void atualizarFc()}>
                    {t("Atualizar FC")}
                  </Button>
                ) : null}
              </div>
              {(processo.fc_fiadores ?? []).map((f) => (
                <Button key={String(f.id)} size="sm" variant="ghost" className="h-7 px-2 text-xs"
                  disabled={desabilitado || salvandoFc || confirmandoFc}
                  onClick={() => void salvarFc(String(f.id))}>
                  {t("Pedir FC do fiador")}{f.cpf_mascarado ? ` ${f.cpf_mascarado}` : ""}
                </Button>
              ))}
            </>
          )}
        </div>
      ) : null}
      {verRelatorio && analiseRelatorio ? (
        <div className="space-y-1.5 border-t border-border pt-2" data-testid="analise-relatorio">
          <p className="text-xs font-medium">{t("Relatório financeiro")}</p>
          {!processo ? (
            <p className="text-xs text-text-muted">{t("Abra um processo antes de gerar o relatório.")}</p>
          ) : (
            <>
              {processo.relatorio_aprovado_em ? (
                <p className="text-xs text-text-muted">{t("Relatório aprovado.")}</p>
              ) : processo.relatorio_rascunho_em ? (
                <p className="text-xs text-text-muted">{t("Há um rascunho para conferir.")}</p>
              ) : (
                <p className="text-[11px] text-text-muted">
                  {t("Monta as 6 seções com os blocos já gravados. Sem renda comprovada, a seção fica pendente.")}
                </p>
              )}
              {resumoRelatorio || processo.relatorio_rascunho ? (
                <p className="text-xs whitespace-pre-wrap">
                  {resumoRelatorio ?? processo.relatorio_rascunho}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs"
                  disabled={desabilitado || gerandoRelatorio || aprovandoRelatorio}
                  onClick={() => void gerarRelatorio()}>
                  {gerandoRelatorio ? t("Gerando relatório…") : t("Gerar relatório")}
                </Button>
                <Button size="sm" className="h-7 px-2 text-xs"
                  disabled={
                    desabilitado || gerandoRelatorio || aprovandoRelatorio
                    || !(resumoRelatorio || processo.relatorio_rascunho)
                    || !!processo.relatorio_aprovado_em
                  }
                  onClick={() => void aprovarRelatorio()}>
                  {aprovandoRelatorio ? t("Aprovando relatório…") : t("Aprovar relatório")}
                </Button>
              </div>
            </>
          )}
        </div>
      ) : null}
      {verManual && manualAberto && manual ? (
        <div className="space-y-1.5 border-t border-border pt-2" data-testid="analise-manual">
          <p className="text-xs font-medium">{t("Manual assistido")}</p>
          <p className="text-[11px] text-text-muted">
            {t("O robô não conseguiu terminar esta etapa. Faça no site e registre o resultado aqui.")}
          </p>
          {resumoManual ? <p className="text-xs whitespace-pre-wrap">{resumoManual}</p> : null}
          <p className="text-[11px] font-medium">{t("Dados para copiar")}</p>
          {manual.campos.map((campo) => {
            const valor = campo.sensivel && cpfRevelado ? cpfRevelado : campo.valor;
            return (
              <div key={campo.chave} className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-text-muted">{t(campo.rotulo)}:</span>
                <span className="text-xs">{valor}</span>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
                  type="button"
                  disabled={desabilitado}
                  onClick={() => void copiarCampo(campo.chave, valor)}>
                  {copiado === campo.chave ? t("Copiado") : t("Copiar")}
                </Button>
                {campo.sensivel ? (
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
                    type="button"
                    disabled={desabilitado || revelandoCpf}
                    onClick={() => void revelarCpf()}>
                    {revelandoCpf
                      ? t("revelando CPF…")
                      : cpfRevelado ? t("Esconder CPF") : t("Revelar CPF")}
                  </Button>
                ) : null}
              </div>
            );
          })}
          {manual.solidarios.length > 0 ? (
            <div className="space-y-0.5">
              <p className="text-[11px] font-medium">{t("Solidários")}</p>
              {manual.solidarios.map((s, i) => (
                <p key={`${s.nome}-${i}`} className="text-[11px] text-text-muted">
                  {s.nome}{s.cpf_mascarado ? ` · ${s.cpf_mascarado}` : ""}
                </p>
              ))}
            </div>
          ) : null}
          {manual.vigencia.inicio ? (
            <p className="text-[11px] text-text-muted">
              {t("Vigência")}: {manual.vigencia.inicio} → {manual.vigencia.fim}
            </p>
          ) : null}
          {manual.etapa_fc ? (
            <div className="space-y-1">
              <p className="text-[11px] font-medium">{t("Passo a passo da FC")}</p>
              {manual.links.fc ? (
                <a className="text-xs underline" href={manual.links.fc} target="_blank" rel="noreferrer">
                  {t("Abrir site da FC")}
                </a>
              ) : null}
              <ol className="list-decimal space-y-0.5 pl-4">
                <li className="text-[11px] text-text-muted">
                  {t("Abra o site da FC Score+ (cliente.fcanalise.com.br) e entre com a conta da imobiliária.")}
                </li>
                <li className="text-[11px] text-text-muted">
                  {t("Preencha o formulário com os dados ao lado. Não envie arquivo — a FC só pede dados.")}
                </li>
                <li className="text-[11px] text-text-muted">
                  {t("Clique em SALVAR (é grátis e gera o ID-FC). Não clique em Processar ANÁLISE daqui do painel: o passo pago é só no site, se você decidir.")}
                </li>
                <li className="text-[11px] text-text-muted">
                  {t("Se processar no site, espere o laudo. Anote score, risco e o ID-FC e anexe o PDF aqui.")}
                </li>
              </ol>
              <p className="text-[11px] font-medium">{t("Registrar resultado da FC")}</p>
              <label className="block space-y-0.5">
                <span className="text-[11px]">{t("Score")}</span>
                <input className="h-7 w-full rounded-md border border-border bg-background px-2 text-xs"
                  value={scoreManual} onChange={(e) => setScoreManual(e.target.value)}
                  aria-label={t("Score")} />
              </label>
              <label className="block space-y-0.5">
                <span className="text-[11px]">{t("Risco")}</span>
                <input className="h-7 w-full rounded-md border border-border bg-background px-2 text-xs"
                  value={riscoManual} onChange={(e) => setRiscoManual(e.target.value)}
                  aria-label={t("Risco")} />
              </label>
              <label className="block space-y-0.5">
                <span className="text-[11px]">{t("ID-FC")}</span>
                <input className="h-7 w-full rounded-md border border-border bg-background px-2 text-xs"
                  value={idFcManual} onChange={(e) => setIdFcManual(e.target.value)}
                  aria-label={t("ID-FC")} />
              </label>
              <label className="block space-y-0.5">
                <span className="text-[11px]">{t("Anexar laudo")}</span>
                <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp"
                  className="text-xs" aria-label={t("Anexar laudo")}
                  onChange={(e) => setLaudoManual(e.target.files?.[0] ?? null)} />
              </label>
              <Button size="sm" className="h-7 px-2 text-xs"
                disabled={desabilitado || registrandoFc}
                onClick={() => void registrarFcManual()}>
                {registrandoFc ? t("registrando a FC manual…") : t("Registrar FC")}
              </Button>
            </div>
          ) : null}
          {manual.etapa_seguro ? (
            <div className="space-y-1">
              <p className="text-[11px] font-medium">{t("Passo a passo da Migra")}</p>
              {manual.links.migra ? (
                <a className="text-xs underline" href={manual.links.migra} target="_blank" rel="noreferrer">
                  {t("Abrir site da Migra")}
                </a>
              ) : null}
              <p className="text-[11px] font-medium text-destructive">
                {t("Clique em Analisar. Nunca clique em Contratar.")}
              </p>
              <ol className="list-decimal space-y-0.5 pl-4">
                <li className="text-[11px] text-text-muted">
                  {t("Abra o site da Migra (migra.app.br) e entre com a conta da imobiliária.")}
                </li>
                <li className="text-[11px] text-text-muted">
                  {t("Abra o Multi Cálculo PF Residencial e preencha com os dados ao lado. Colocatários entram como solidários.")}
                </li>
                <li className="text-[11px] text-text-muted">
                  {t("Clique em Analisar. Nunca clique em Contratar.")}
                </li>
                <li className="text-[11px] text-text-muted">
                  {t("Espere o modal, tire um print dos cards e registre seguradora, código, status e plano aqui.")}
                </li>
              </ol>
              <p className="text-[11px] font-medium">{t("Registrar cards da Migra")}</p>
              {cardsManual.map((card, i) => (
                <div key={i} className="grid grid-cols-2 gap-1">
                  <input className="h-7 rounded-md border border-border bg-background px-2 text-xs"
                    placeholder={t("Seguradora")} aria-label={t("Seguradora")}
                    value={card.seguradora ?? ""}
                    onChange={(e) => setCardsManual((atual) => atual.map((c, j) => j === i ? { ...c, seguradora: e.target.value } : c))} />
                  <input className="h-7 rounded-md border border-border bg-background px-2 text-xs"
                    placeholder={t("Código")} aria-label={t("Código")}
                    value={card.codigo ?? ""}
                    onChange={(e) => setCardsManual((atual) => atual.map((c, j) => j === i ? { ...c, codigo: e.target.value } : c))} />
                  <input className="h-7 rounded-md border border-border bg-background px-2 text-xs"
                    placeholder={t("Status")} aria-label={t("Status")}
                    value={card.status ?? ""}
                    onChange={(e) => setCardsManual((atual) => atual.map((c, j) => j === i ? { ...c, status: e.target.value } : c))} />
                  <input className="h-7 rounded-md border border-border bg-background px-2 text-xs"
                    placeholder={t("Plano")} aria-label={t("Plano")}
                    value={card.plano ?? ""}
                    onChange={(e) => setCardsManual((atual) => atual.map((c, j) => j === i ? { ...c, plano: e.target.value } : c))} />
                </div>
              ))}
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" type="button"
                onClick={() => setCardsManual((atual) => [...atual, {}])}>
                {t("Adicionar card")}
              </Button>
              <label className="block space-y-0.5">
                <span className="text-[11px]">{t("Anexar print")}</span>
                <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp"
                  className="text-xs" aria-label={t("Anexar print")}
                  onChange={(e) => setPrintManual(e.target.files?.[0] ?? null)} />
              </label>
              <Button size="sm" className="h-7 px-2 text-xs"
                disabled={desabilitado || registrandoSeguro}
                onClick={() => void registrarSeguroManual()}>
                {registrandoSeguro ? t("registrando a cotação manual…") : t("Registrar cotação")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {erro ? <p className="text-xs text-destructive" role="alert">{erro}</p> : null}
    </div>
  );
}
