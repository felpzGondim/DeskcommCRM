"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { CamposImovelProcessoNaFicha } from "@/components/locacao/CamposImovelProcesso";
import {
  PAPEIS_DA_FICHA,
  pessoaVazia,
  type CampoFicha,
  type FichaPreliminar,
  type NumeroFicha,
  type PapelDaFicha,
} from "@/lib/locacao/ficha-schema";

type AvisoAnexo = { tipo: string; nome: string; tentativas?: number };
type ResumoVersao = {
  versao: number;
  origem: "preliminar_ia" | "atendente";
  campos_alterados: string[];
  alterado_em: string;
};

interface Props {
  conversationId: string;
  desabilitado?: boolean;
  senhasPdf: Array<{ nome: string; senha: string }>;
}

const ROTULO_PAPEL: Record<PapelDaFicha, string> = {
  inquilino: "Inquilino",
  solidario: "Solidário",
  fiador: "Fiador",
  contato: "Contato (só conversa)",
};

function campo(valor: string): CampoFicha {
  return { valor: valor.trim() || null, fonte: null, trecho: null, confianca: null, message_id: null };
}

function numero(valor: string): NumeroFicha {
  const n = Number(valor.replace(",", "."));
  return {
    valor: Number.isFinite(n) && valor.trim() !== "" ? n : null,
    fonte: null, trecho: null, confianca: null, message_id: null,
  };
}

function textoDe(c: CampoFicha | NumeroFicha | undefined): string {
  if (!c || c.valor === null || c.valor === undefined) return "";
  return String(c.valor);
}

export function FichaPreliminarPainel({ conversationId, desabilitado = false, senhasPdf }: Props) {
  const t = useT();
  const [ficha, setFicha] = useState<FichaPreliminar | null>(null);
  const [relatorio, setRelatorio] = useState("");
  const [versao, setVersao] = useState(0);
  const [historico, setHistorico] = useState<ResumoVersao[]>([]);
  const [somenteLeitura, setSomenteLeitura] = useState(false);
  const [carregando, setCarregando] = useState<"gerar" | "salvar" | "ler" | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setCarregando("ler");
    void apiClient.get<{ data: { atual: { versao: number; ficha: FichaPreliminar; relatorio: string } | null; historico: ResumoVersao[] } }>(
      `/api/v1/conversations/${conversationId}/painel-agente/ficha`,
    ).then((r) => {
      if (!vivo) return;
      if (r.data.atual) {
        setFicha(r.data.atual.ficha);
        setRelatorio(r.data.atual.relatorio);
        setVersao(r.data.atual.versao);
      }
      setHistorico(r.data.historico ?? []);
    }).catch(() => {
      if (vivo) setErro(null);
    }).finally(() => {
      if (vivo) setCarregando(null);
    });
    return () => { vivo = false; };
  }, [conversationId]);

  async function gerar() {
    if (carregando || desabilitado) return;
    setErro(null);
    setCarregando("gerar");
    try {
      const r = await apiClient.post<{ data: {
        versao: number; ficha: FichaPreliminar; relatorio: string; historico: ResumoVersao[]; avisos?: AvisoAnexo[];
      } }>(
        `/api/v1/conversations/${conversationId}/painel-agente/ficha`,
        { etapa: "gerar", ...(senhasPdf.length ? { senhasPdf } : {}) },
        { timeoutMs: 120_000 },
      );
      setFicha(r.data.ficha);
      setRelatorio(r.data.relatorio);
      setVersao(r.data.versao);
      setHistorico(r.data.historico ?? []);
      setSomenteLeitura(false);
    } catch (e) {
      setErro(e instanceof Error && e.message ? e.message : t("Não foi possível gerar o relatório preliminar."));
    } finally {
      setCarregando(null);
    }
  }

  async function salvar() {
    if (!ficha || carregando || desabilitado || somenteLeitura) return;
    setErro(null);
    setCarregando("salvar");
    try {
      const r = await apiClient.post<{ data: {
        versao: number; ficha: FichaPreliminar; relatorio: string; historico: ResumoVersao[];
      } }>(
        `/api/v1/conversations/${conversationId}/painel-agente/ficha`,
        { etapa: "salvar", ficha, relatorio, base_versao: versao },
      );
      setFicha(r.data.ficha);
      setRelatorio(r.data.relatorio);
      setVersao(r.data.versao);
      setHistorico(r.data.historico ?? []);
      toast.success(t("Ficha salva."));
    } catch (e) {
      setErro(e instanceof Error && e.message ? e.message : t("Não foi possível salvar a ficha preliminar."));
    } finally {
      setCarregando(null);
    }
  }

  async function verVersao(n: number) {
    setCarregando("ler");
    try {
      const r = await apiClient.get<{ data: { atual: { versao: number; ficha: FichaPreliminar; relatorio: string } | null } }>(
        `/api/v1/conversations/${conversationId}/painel-agente/ficha?versao=${n}`,
      );
      if (r.data.atual) {
        setFicha(r.data.atual.ficha);
        setRelatorio(r.data.atual.relatorio);
        setVersao(r.data.atual.versao);
        setSomenteLeitura(true);
      }
    } catch (e) {
      setErro(e instanceof Error && e.message ? e.message : t("Não foi possível ler a ficha preliminar."));
    } finally {
      setCarregando(null);
    }
  }

  function patchPessoa(i: number, patch: Partial<FichaPreliminar["pessoas"][number]>) {
    setFicha((atual) => {
      if (!atual) return atual;
      const pessoas = atual.pessoas.map((p, idx) => idx === i ? { ...p, ...patch } : p);
      return { ...atual, pessoas };
    });
  }

  const bloqueado = desabilitado || carregando !== null;

  return (
    <div className="space-y-2" data-testid="ficha-preliminar">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs"
          disabled={bloqueado} onClick={() => void gerar()}>
          {carregando === "gerar" ? t("Gerando relatório…") : t("Gerar relatório preliminar")}
        </Button>
        {ficha && !somenteLeitura && (
          <Button size="sm" variant="secondary" className="h-7 px-2 text-xs"
            disabled={bloqueado} onClick={() => void salvar()}>
            {carregando === "salvar" ? t("Salvando ficha…") : t("Salvar ficha")}
          </Button>
        )}
        {somenteLeitura && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
            disabled={bloqueado} onClick={() => { setSomenteLeitura(false); void verVersao(historico[0]?.versao ?? versao); }}>
            {t("Voltar à versão atual")}
          </Button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {t("A ficha preliminar alimenta a análise, a FC e o contrato. Confira o celular do inquilino — não use o número de quem só conversa.")}
      </p>
      {erro && <p role="alert" className="text-xs text-destructive">{erro}</p>}
      {ficha && (
        <div className="space-y-3 rounded-md border border-border p-2">
          <div>
            <h4 className="text-[11px] font-semibold">{t("Relatório preliminar")} · {t("Versão")} {versao}</h4>
            <Textarea className="mt-1 min-h-20 text-xs" value={relatorio} disabled={somenteLeitura || desabilitado}
              onChange={(e) => setRelatorio(e.target.value)} maxLength={4000} rows={6} />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-[11px] font-semibold">{t("Pessoas")}</h4>
              {!somenteLeitura && (
                <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" disabled={desabilitado}
                  onClick={() => setFicha((atual) => atual ? { ...atual, pessoas: [...atual.pessoas, pessoaVazia("contato")] } : atual)}>
                  {t("Adicionar pessoa")}
                </Button>
              )}
            </div>
            {ficha.pessoas.map((p, i) => (
              <fieldset key={i} className="space-y-1 rounded-md bg-muted/40 p-2">
                <legend className="text-[11px] font-medium">{t("Ficha de dados")} {i + 1}</legend>
                <label className="block text-[11px]">
                  {t("Papel")}
                  <select className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                    disabled={somenteLeitura || desabilitado}
                    value={p.papel}
                    onChange={(e) => patchPessoa(i, { papel: e.target.value as PapelDaFicha })}>
                    {PAPEIS_DA_FICHA.map((papel) => (
                      <option key={papel} value={papel}>{t(ROTULO_PAPEL[papel])}</option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1.5 text-[11px]">
                  <input type="checkbox" checked={p.principal} disabled={somenteLeitura || desabilitado}
                    onChange={(e) => patchPessoa(i, { principal: e.target.checked })} />
                  {t("Principal")}
                </label>
                <label className="block text-[11px]">{t("Nome")}
                  <Input className="h-8 text-xs" value={textoDe(p.nome)} disabled={somenteLeitura || desabilitado}
                    onChange={(e) => patchPessoa(i, { nome: campo(e.target.value) })} />
                </label>
                <label className="block text-[11px]">{t("CPF")}
                  <Input className="h-8 text-xs" value={textoDe(p.cpf)} disabled={somenteLeitura || desabilitado}
                    onChange={(e) => patchPessoa(i, { cpf: campo(e.target.value) })} />
                </label>
                <label className="block text-[11px]">{t("Celular")}
                  <Input className="h-8 text-xs" value={textoDe(p.celular)} disabled={somenteLeitura || desabilitado}
                    onChange={(e) => patchPessoa(i, { celular: campo(e.target.value) })} />
                </label>
                <label className="block text-[11px]">{t("E-mail")}
                  <Input className="h-8 text-xs" value={textoDe(p.email)} disabled={somenteLeitura || desabilitado}
                    onChange={(e) => patchPessoa(i, { email: campo(e.target.value) })} />
                </label>
              </fieldset>
            ))}
          </div>
          <div className="space-y-1">
            <h4 className="text-[11px] font-semibold">{t("Imóvel")}</h4>
            <label className="block text-[11px]">{t("Endereço do imóvel")}
              <Input className="h-8 text-xs" value={textoDe(ficha.imovel.logradouro)} disabled={somenteLeitura || desabilitado}
                onChange={(e) => setFicha((a) => a ? { ...a, imovel: { ...a.imovel, logradouro: campo(e.target.value) } } : a)} />
            </label>
            <label className="block text-[11px]">{t("Número do imóvel")}
              <Input className="h-8 text-xs" value={textoDe(ficha.imovel.numero)} disabled={somenteLeitura || desabilitado}
                onChange={(e) => setFicha((a) => a ? { ...a, imovel: { ...a.imovel, numero: campo(e.target.value) } } : a)} />
            </label>
            <label className="block text-[11px]">{t("Aluguel (R$)")}
              <Input className="h-8 text-xs" value={textoDe(ficha.imovel.aluguel)} disabled={somenteLeitura || desabilitado}
                onChange={(e) => setFicha((a) => a ? { ...a, imovel: { ...a.imovel, aluguel: numero(e.target.value) } } : a)} />
            </label>
            <label className="block text-[11px]">{t("Código FC")}
              <Input className="h-8 text-xs" value={textoDe(ficha.imovel.codigo_fc)} disabled={somenteLeitura || desabilitado}
                onChange={(e) => setFicha((a) => a ? { ...a, imovel: { ...a.imovel, codigo_fc: campo(e.target.value) } } : a)} />
            </label>
            <CamposImovelProcessoNaFicha
              conversationId={conversationId}
              desabilitado={somenteLeitura || desabilitado}
            />
          </div>
          <div className="space-y-1">
            <label className="block text-[11px]">{t("Renda mensal (R$)")}
              <Input className="h-8 text-xs" value={textoDe(ficha.renda.mensal)} disabled={somenteLeitura || desabilitado}
                onChange={(e) => setFicha((a) => a ? { ...a, renda: { ...a.renda, mensal: numero(e.target.value) } } : a)} />
            </label>
            <label className="block text-[11px]">{t("Renda proposta para a FC (R$)")}
              <Input className="h-8 text-xs" value={textoDe(ficha.renda.proposta_fc)} disabled={somenteLeitura || desabilitado}
                onChange={(e) => setFicha((a) => a ? { ...a, renda: { ...a.renda, proposta_fc: numero(e.target.value) } } : a)} />
            </label>
          </div>
          {ficha.documentos.faltantes.length > 0 && (
            <p className="text-[11px]"><span className="font-semibold">{t("Documentos faltantes")}:</span> {ficha.documentos.faltantes.join(", ")}</p>
          )}
          {ficha.pendencias.length > 0 && (
            <ul className="list-disc pl-4 text-[11px]">
              <li className="list-none font-semibold -ml-4">{t("Pendências")}</li>
              {ficha.pendencias.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
          {historico.length > 0 && (
            <div>
              <h4 className="text-[11px] font-semibold">{t("Histórico da ficha")}</h4>
              <ol className="mt-1 space-y-1 text-[11px]">
                {historico.map((h) => (
                  <li key={h.versao}>
                    {t("Versão")} {h.versao} · {h.origem === "preliminar_ia" ? t("Gerada pela IA") : t("Corrigida pelo atendente")}
                    {h.campos_alterados.length > 0 && h.campos_alterados[0] !== "*" && (
                      <> · {t("Campos alterados")}: {h.campos_alterados.slice(0, 8).join(", ")}</>
                    )}
                    <Button size="sm" variant="ghost" className="ml-1 h-5 px-1 text-[10px]"
                      disabled={bloqueado} onClick={() => void verVersao(h.versao)}>
                      {t("Ver como estava")}
                    </Button>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
