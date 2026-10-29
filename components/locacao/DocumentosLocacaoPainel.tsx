"use client";
/* eslint-disable @next/next/no-img-element -- visualização autenticada de arquivos privados com URL temporária */

import { useCallback, useEffect, useState } from "react";
import { apiClient } from "@/lib/api/client";
import { useT } from "@/hooks/i18n/useT";
import { Button } from "@/components/ui/button";
import { CATEGORIAS_DE_DOCUMENTO } from "@/lib/locacao/vocabulario";

type Documento = {id: string; origem: "mensagem" | "processo"; nome: string; categoria: string;
  participante_id: string | null; mime: string | null; data: string; situacao: string};
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
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [pagina, setPagina] = useState(0);
  const [visualizacao, setVisualizacao] = useState<{nome: string; url?: string; texto?: string; mime?: string | null} | null>(null);
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
  useEffect(() => {setVisualizacao(null); setDados(null);}, [conversationId]);

  async function abrir(doc: Documento, download = false) {
    setErro(null);
    try {
      const r = await apiClient.get<{data: {url: string}}>(endpoint + "?arquivo=" + doc.id + "&origem=" + doc.origem + (download ? "&download=1" : ""));
      if (download) { const a = document.createElement("a"); a.href = r.data.url; a.download = doc.nome; a.rel = "noopener noreferrer"; a.click(); }
      else setVisualizacao({nome: doc.nome, url: r.data.url, mime: doc.mime});
    } catch (e) {setErro(e instanceof Error ? e.message : t("Não foi possível abrir o arquivo."));}
  }
  function baixarRelatorio(relatorio: Relatorio) {
    const url = URL.createObjectURL(new Blob([relatorio.texto], {type: "text/markdown;charset=utf-8"}));
    const a = document.createElement("a"); a.href = url; a.download = relatorio.id + ".md"; a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function classificar(doc: Documento, patch: Partial<Pick<Documento, "categoria" | "participante_id">>) {
    setSalvando(doc.id); setErro(null);
    try {
      await apiClient.patch(endpoint, {id: doc.id, origem: doc.origem, categoria: patch.categoria ?? doc.categoria,
        participante_id: "participante_id" in patch ? patch.participante_id : doc.participante_id});
      setDados((d) => d ? {...d,
        recebidos: d.recebidos.map((a) => a.id === doc.id ? {...a, ...patch} : a),
        documentos: d.documentos.map((a) => a.id === doc.id ? {...a, ...patch} : a),
      } : d);
    } catch (e) {setErro(e instanceof Error ? e.message : t("Não foi possível classificar o documento."));}
    finally {setSalvando(null);}
  }
  function lista(titulo: string, docs: Documento[]) {
    return <section className="space-y-2">
      <h3 className="text-sm font-semibold">{titulo}</h3>
      {!docs.length && <p className="text-xs text-muted-foreground">{t("Nenhum documento nesta seção.")}</p>}
      {docs.map((doc) => <article key={doc.origem + doc.id} className="space-y-2 rounded border border-border p-3">
        <p className="text-sm font-medium">{doc.nome}</p>
        <p className="text-xs text-muted-foreground">{new Date(doc.data).toLocaleDateString("pt-BR")} · {t(doc.situacao)}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs">{t("Categoria")}
            <select aria-label={t("Categoria") + " " + doc.nome} className="mt-1 w-full rounded border border-input bg-background p-1"
              value={doc.categoria} disabled={desabilitado || salvando !== null}
              onChange={(e) => void classificar(doc, {categoria: e.target.value})}>
              {CATEGORIAS_DE_DOCUMENTO.map((c) => <option key={c} value={c}>{t(ROTULOS[c] ?? c)}</option>)}
            </select>
          </label>
          <label className="text-xs">{t("Participante")}
            <select aria-label={t("Participante") + " " + doc.nome} className="mt-1 w-full rounded border border-input bg-background p-1"
              value={doc.participante_id ?? ""} disabled={desabilitado || salvando !== null}
              onChange={(e) => void classificar(doc, {participante_id: e.target.value || null})}>
              <option value="">{t("A identificar / documento do processo")}</option>
              {(dados?.participantes ?? []).map((p) => <option key={p.id} value={p.id}>{[p.nome_exibicao, p.papel, p.cpf_mascarado].filter(Boolean).join(" · ")}</option>)}
            </select>
          </label>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => void abrir(doc)}>{t("Visualizar")}</Button>
          <Button size="sm" variant="ghost" onClick={() => void abrir(doc, true)}>{t("Baixar")}</Button>
        </div>
      </article>)}
    </section>;
  }
  const recebidos = dados?.recebidos ?? [];
  const resultados = (dados?.documentos ?? []).filter((d) => d.categoria !== "contrato");
  const contratos = (dados?.documentos ?? []).filter((d) => d.categoria === "contrato");
  return <div className="space-y-4" data-testid="documentos-locacao">
    <Button size="sm" variant="outline" disabled={carregando} onClick={() => void carregar()}>{t("Atualizar documentos")}</Button>
    {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
    {carregando && <p role="status" className="text-xs">{t("Carregando documentos…")}</p>}
    {dados?.pendencias.length ? <section><h3 className="text-sm font-semibold">{t("Documentos pendentes")}</h3>
      <ul className="list-disc pl-4 text-xs">{dados.pendencias.map((p) => <li key={p}>{p}</li>)}</ul></section> : null}
    {lista(t("Documentos recebidos"), recebidos)}
    {dados?.ha_mais && <Button size="sm" variant="outline" disabled={carregando} onClick={() => void carregar(pagina + 1)}>{t("Carregar mais documentos")}</Button>}
    {lista(t("Resultados das etapas"), resultados)}
    {(dados?.relatorios ?? []).map((r) => <article key={r.id} className="space-y-2 rounded border p-3">
      <p className="text-sm font-medium">{r.nome}</p><div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => setVisualizacao({nome: r.nome, texto: r.texto})}>{t("Visualizar")}</Button>
        <Button size="sm" variant="ghost" onClick={() => baixarRelatorio(r)}>{t("Baixar .md")}</Button>
      </div></article>)}
    {lista(t("Contrato"), contratos)}
    {visualizacao && <section className="space-y-2 rounded border p-3">
      <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">{visualizacao.nome}</h3>
        <Button size="sm" variant="ghost" onClick={() => setVisualizacao(null)}>{t("Fechar visualização")}</Button></div>
      {visualizacao.texto ? <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap text-xs">{visualizacao.texto}</pre>
        : visualizacao.mime?.startsWith("image/") ? <img src={visualizacao.url} alt={visualizacao.nome} className="max-h-[55vh] max-w-full object-contain" />
        : visualizacao.mime === "application/pdf" ? <iframe src={visualizacao.url} title={visualizacao.nome} className="h-[55vh] w-full border-0" />
        : <a href={visualizacao.url} target="_blank" rel="noopener noreferrer" className="text-sm underline">{t("Abrir documento")}</a>}
    </section>}
  </div>;
}
