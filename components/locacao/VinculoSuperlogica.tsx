"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { tipoParaVinculo } from "@/lib/locacao/busca-superlogica";
import { MOTIVOS_DE_DESFAZER_VINCULO } from "@/lib/locacao/vocabulario";

type Candidato = {
  id: string;
  nome: string;
  tipo: string;
  contrato: string | null;
  imovel: string | null;
};

type ContatoLocacao = {
  id: string | null;
  superlogica_id_pessoa: string | null;
  superlogica_tipo: string | null;
};

const ROTULO_MOTIVO: Record<(typeof MOTIVOS_DE_DESFAZER_VINCULO)[number], string> = {
  errado: "Cadastro errado",
  numero_mudou: "Número mudou",
  lgpd: "Pedido de privacidade",
  outro: "Outro",
};

export function VinculoSuperlogica({
  conversationId,
  contato,
  desabilitado = false,
  onAtualizado,
}: {
  conversationId: string;
  contato: ContatoLocacao | null;
  desabilitado?: boolean;
  onAtualizado?: () => void;
}) {
  const t = useT();
  const [pesquisa, setPesquisa] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [ligando, setLigando] = useState<string | null>(null);
  const [desfazendo, setDesfazendo] = useState(false);
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [haMais, setHaMais] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [vinculoId, setVinculoId] = useState<string | null>(null);
  const [motivo, setMotivo] = useState<(typeof MOTIVOS_DE_DESFAZER_VINCULO)[number]>("errado");
  const contactId = contato?.id ?? null;

  const vinculoAtivoId = contactId ? vinculoId : null;

  useEffect(() => {
    if (!contactId) return;
    let vivo = true;
    void apiClient
      .get<{ data: { vinculo?: { id?: string } | null } }>(
        `/api/v1/locacao/vinculos?contact_id=${contactId}`,
      )
      .then((r) => {
        if (!vivo) return;
        setVinculoId(typeof r.data?.vinculo?.id === "string" ? r.data.vinculo.id : null);
      })
      .catch(() => {
        if (vivo) setVinculoId(null);
      });
    return () => {
      vivo = false;
    };
  }, [contactId]);

  async function buscar() {
    if (buscando || desabilitado || pesquisa.trim().length < 2) return;
    setBuscando(true);
    setErro(null);
    setStatus(null);
    try {
      const r = await apiClient.post<{
        data: {
          status?: string;
          encontrado?: boolean;
          candidatos?: Candidato[];
          ha_mais?: boolean;
        };
      }>("/api/v1/locacao/vinculos/busca", {
        conversation_id: conversationId,
        pesquisa: pesquisa.trim(),
      });
      setPesquisa("");
      setCandidatos(Array.isArray(r.data?.candidatos) ? r.data.candidatos.slice(0, 5) : []);
      setHaMais(r.data?.ha_mais === true);
      setStatus(typeof r.data?.status === "string" ? r.data.status : null);
    } catch (e) {
      setCandidatos([]);
      setErro(e instanceof Error ? e.message : t("Não foi possível buscar na Superlógica."));
    } finally {
      setBuscando(false);
    }
  }

  async function ligar(c: Candidato) {
    if (!contactId || ligando || desabilitado) return;
    const tipo = tipoParaVinculo(c.tipo);
    setLigando(c.id);
    setErro(null);
    try {
      const r = await apiClient.post<{ data?: { id?: string } }>("/api/v1/locacao/vinculos", {
        contact_id: contactId,
        superlogica_pessoa_id: c.id,
        ...(tipo ? { tipos: [tipo] } : {}),
      });
      const id = typeof r.data?.id === "string" ? r.data.id : null;
      if (id) setVinculoId(id);
      setCandidatos([]);
      onAtualizado?.();
    } catch (e) {
      setErro(e instanceof Error ? e.message : t("Não foi possível ligar."));
    } finally {
      setLigando(null);
    }
  }

  async function desfazer() {
    if (!vinculoAtivoId || desfazendo || desabilitado) return;
    setDesfazendo(true);
    setErro(null);
    try {
      await apiClient.delete("/api/v1/locacao/vinculos", { vinculo_id: vinculoAtivoId, motivo });
      setVinculoId(null);
      onAtualizado?.();
    } catch (e) {
      setErro(e instanceof Error ? e.message : t("Não foi possível desligar."));
    } finally {
      setDesfazendo(false);
    }
  }

  return (
    <section className="space-y-2 rounded-md border border-border p-2" data-testid="vinculo-superlogica">
      <p className="text-xs font-medium">{t("Vínculo Superlógica")}</p>
      {contato?.superlogica_id_pessoa ? (
        <p className="text-xs">
          {t("Pessoa Superlógica")} {contato.superlogica_id_pessoa}
          {contato.superlogica_tipo ? ` · ${contato.superlogica_tipo}` : ""}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">{t("Sem vínculo Superlógica neste contato.")}</p>
      )}
      {vinculoAtivoId ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-[11px]">
            {t("Motivo")}
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              value={motivo}
              disabled={desabilitado || desfazendo}
              onChange={(e) => setMotivo(e.target.value as typeof motivo)}
            >
              {MOTIVOS_DE_DESFAZER_VINCULO.map((m) => (
                <option key={m} value={m}>{t(ROTULO_MOTIVO[m])}</option>
              ))}
            </select>
          </label>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs"
            disabled={desabilitado || desfazendo} onClick={() => void desfazer()}>
            {desfazendo ? t("Desfazendo…") : t("Desfazer vínculo")}
          </Button>
        </div>
      ) : null}
      <p className="text-[11px] text-muted-foreground">
        {t("Busque por nome ou CPF. O CPF só vai na consulta e não fica salvo nem no log.")}
      </p>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void buscar();
        }}
      >
        <Input
          className="h-8 max-w-xs text-xs"
          value={pesquisa}
          maxLength={120}
          disabled={desabilitado || buscando}
          autoComplete="off"
          aria-label={t("Nome ou CPF")}
          placeholder={t("Nome ou CPF")}
          onChange={(e) => setPesquisa(e.target.value)}
        />
        <Button type="submit" size="sm" variant="outline" className="h-7 px-2 text-xs"
          disabled={desabilitado || buscando || pesquisa.trim().length < 2}>
          {buscando ? t("Buscando…") : t("Buscar na Superlógica")}
        </Button>
      </form>
      {status === "nao_encontrado" && candidatos.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("Nenhum cadastro encontrado. Isso não prova que a pessoa não existe — confira no Superlógica.")}
        </p>
      ) : null}
      {candidatos.length > 0 ? (
        <ul className="space-y-1.5">
          {candidatos.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1.5">
              <span className="text-xs">
                {c.nome} · {c.tipo || t("tipo não informado")}
                {c.imovel ? ` · ${c.imovel}` : ""}
                {c.contrato ? ` · ${t("Contrato")} ${c.contrato}` : ""}
              </span>
              <Button size="sm" className="h-7 px-2 text-xs" disabled={desabilitado || ligando !== null}
                onClick={() => void ligar(c)}>
                {ligando === c.id ? t("Ligando…") : t("Ligar este cadastro")}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {haMais ? (
        <p className="text-[11px] text-muted-foreground">{t("Há mais resultados. Refine a busca.")}</p>
      ) : null}
      {erro ? <p role="alert" className="text-xs text-destructive">{erro}</p> : null}
    </section>
  );
}
