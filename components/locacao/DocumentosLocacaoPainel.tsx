"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiClient } from "@/lib/api/client";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { Button } from "@/components/ui/button";
import { CATEGORIAS_DE_DOCUMENTO } from "@/lib/locacao/vocabulario";
import {
  GRUPOS_DE_DOCUMENTO,
  ROTULOS_DO_GRUPO,
  agruparDocumentos,
  hrefAssinadoDoDocumento,
} from "@/lib/locacao/grupo-de-documento";

type Documento = {
  id: string;
  origem: "mensagem" | "processo";
  origem_arquivo?: string | null;
  nome: string;
  categoria: string;
  participante_id: string | null;
  categoria_automatica?: boolean;
  participante_automatico?: boolean;
  mime: string | null;
  data: string;
  situacao: string;
  mensagem_id?: string | null;
};
type Relatorio = {id: string; nome: string; texto: string};
type Dados = {recebidos: Documento[]; documentos: Documento[];
  participantes: Array<{id: string; papel: string; nome_exibicao: string | null; cpf_mascarado: string | null}>;
  pendencias: string[]; relatorios: Relatorio[]; ha_mais: boolean};
const ROTULOS: Record<string, string> = {
  documento_pessoal: "Identificação", comprovante_renda: "Comprovante de renda",
  laudo_fc: "Laudo FC", cotacao_seguro: "Cotação Migra", relatorio: "Relatório", contrato: "Contrato", outro: "A classificar",
};

export function DocumentosLocacaoPainel({conversationId, atualizacao = 0, desabilitado = false}: {
  conversationId: string; atualizacao?: number; desabilitado?: boolean;
}) {
  const t = useT();
  const tag = useTagDeIdioma();
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [pagina, setPagina] = useState(0);
  const endpoint = `/api/v1/conversations/${conversationId}/locacao/documentos`;
  const carregar = useCallback(async (proxima = 0) => {
    setCarregando(true); setErro(null);
    try {
      const r = await apiClient.get<{data: Dados}>(endpoint + "?pagina=" + proxima);
      setDados((anterior) => ({...r.data, recebidos: proxima > 0 && anterior
        ? [...anterior.recebidos, ...r.data.recebidos] : r.data.recebidos}));
      setPagina(proxima);
    } catch (e) { setErro(e instanceof Error ? e.message : t("Não foi possível listar os documentos.")); }
    finally {setCarregando(false);}
  }, [endpoint, t]);
  useEffect(() => {void carregar();}, [carregar, atualizacao]);
  useEffect(() => {setDados(null);}, [conversationId]);

  function abrir(doc: Documento, download = false) {
    window.open(
      hrefAssinadoDoDocumento({conversationId, id: doc.id, origem: doc.origem, download}),
      "_blank",
      "noopener,noreferrer",
    );
  }
  function baixarRelatorio(relatorio: Relatorio) {
    const url = URL.createObjectURL(new Blob([relatorio.texto], {type: "text/markdown;charset=utf-8"}));
    window.open(url, "_blank", "noopener,noreferrer");
    const a = document.createElement("a"); a.href = url; a.download = relatorio.id + ".md"; a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function classificar(doc: Documento, patch: Partial<Pick<Documento, "categoria" | "participante_id">>) {
    setSalvando(doc.id); setErro(null);
    try {
      await apiClient.patch(endpoint, {id: doc.id, origem: doc.origem, categoria: patch.categoria ?? doc.categoria,
        participante_id: "participante_id" in patch ? patch.participante_id : doc.participante_id});
      setDados((d) => d ? {...d,
        recebidos: d.recebidos.map((a) => a.id === doc.id ? {
          ...a, ...patch,
          categoria_automatica: "categoria" in patch ? false : a.categoria_automatica,
          participante_automatico: "participante_id" in patch ? false : a.participante_automatico,
        } : a),
        documentos: d.documentos.map((a) => a.id === doc.id ? {
          ...a, ...patch,
          categoria_automatica: "categoria" in patch ? false : a.categoria_automatica,
          participante_automatico: "participante_id" in patch ? false : a.participante_automatico,
        } : a),
      } : d);
    } catch (e) {setErro(e instanceof Error ? e.message : t("Não foi possível classificar o documento."));}
    finally {setSalvando(null);}
  }
  function cartao(doc: Documento) {
    return <article key={doc.origem + doc.id} className="space-y-2 rounded-md border border-border p-3">
      <p className="text-sm font-medium">{doc.nome}</p>
      <p className="text-xs text-muted-foreground">{new Date(doc.data).toLocaleDateString(tag)} · {t(doc.situacao)}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs">{t("Categoria")}
          {doc.categoria_automatica ? <span className="ml-1 text-[10px] text-muted-foreground" data-origem="automatico">{t("preenchido automaticamente")}</span> : null}
          <select aria-label={t("Categoria") + " " + doc.nome} className="mt-1 w-full rounded-md border border-input bg-background p-1"
            value={doc.categoria} disabled={desabilitado || salvando !== null}
            onChange={(e) => void classificar(doc, {categoria: e.target.value})}>
            {CATEGORIAS_DE_DOCUMENTO.map((c) => <option key={c} value={c}>{t(ROTULOS[c] ?? c)}</option>)}
          </select>
        </label>
        <label className="text-xs">{t("Participante")}
          {doc.participante_automatico ? <span className="ml-1 text-[10px] text-muted-foreground" data-origem="automatico">{t("preenchido automaticamente")}</span> : null}
          <select aria-label={t("Participante") + " " + doc.nome} className="mt-1 w-full rounded-md border border-input bg-background p-1"
            value={doc.participante_id ?? ""} disabled={desabilitado || salvando !== null}
            onChange={(e) => void classificar(doc, {participante_id: e.target.value || null})}>
            <option value="">{t("A identificar / documento do processo")}</option>
            {(dados?.participantes ?? []).map((p) => <option key={p.id} value={p.id}>{[p.nome_exibicao, p.papel, p.cpf_mascarado].filter(Boolean).join(" · ")}</option>)}
          </select>
        </label>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => abrir(doc)}>{t("Abrir")}</Button>
        <Button size="sm" variant="ghost" onClick={() => abrir(doc, true)}>{t("Baixar")}</Button>
      </div>
    </article>;
  }
  const grupos = useMemo(() => {
    const mensagensNoProcesso = new Set(
      (dados?.documentos ?? []).map((d) => d.mensagem_id).filter((id): id is string => !!id),
    );
    const recebidos = (dados?.recebidos ?? []).filter((d) => !mensagensNoProcesso.has(d.id));
    return agruparDocumentos([...(dados?.documentos ?? []), ...recebidos]);
  }, [dados]);
  return <div className="space-y-4" data-testid="documentos-locacao">
    <Button size="sm" variant="outline" disabled={carregando} onClick={() => void carregar()}>{t("Atualizar documentos")}</Button>
    {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
    {carregando && <p role="status" className="text-xs">{t("Carregando documentos…")}</p>}
    {dados?.pendencias.length ? <section><h3 className="text-sm font-semibold">{t("Documentos pendentes")}</h3>
      <ul className="list-disc pl-4 text-xs">{dados.pendencias.map((p) => <li key={p}>{p}</li>)}</ul></section> : null}
    {GRUPOS_DE_DOCUMENTO.map((grupo) => <section key={grupo} className="space-y-2" data-grupo={grupo}>
      <h3 className="text-sm font-semibold">{t(ROTULOS_DO_GRUPO[grupo])}</h3>
      {grupos[grupo].length ? grupos[grupo].map(cartao) : <p className="text-xs text-muted-foreground">{t("nenhum arquivo ainda")}</p>}
    </section>)}
    {dados?.ha_mais && <Button size="sm" variant="outline" disabled={carregando} onClick={() => void carregar(pagina + 1)}>{t("Carregar mais documentos")}</Button>}
    {(dados?.relatorios ?? []).map((r) => <article key={r.id} className="space-y-2 rounded-md border p-3">
      <p className="text-sm font-medium">{r.nome}</p><div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => baixarRelatorio(r)}>{t("Abrir")}</Button>
        <Button size="sm" variant="ghost" onClick={() => baixarRelatorio(r)}>{t("Baixar .md")}</Button>
      </div></article>)}
  </div>;
}
