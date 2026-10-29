"use client";

import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import { textoDaPendencia, type DadosContrato, type PendenciaContrato, type ResultadoContrato } from "@/lib/agent-engine/agent/painel-contrato";
import { apiClient } from "@/lib/api/client";

type Previa = { resumo: string; pendencias: Array<string | PendenciaContrato>; avisos: string[]; token: string | null };
type Campo = { nome: string; rotulo: string; tipo?: "number" | "date" | "email"; obrigatorio?: boolean };

/** Formulário da locação — usado no diálogo legado e na aba Gerar contrato. */
export function FormularioGerarContrato({
  conversationId,
  desabilitado = false,
  modo = "embutido",
}: {
  conversationId: string;
  desabilitado?: boolean;
  modo?: "embutido" | "dialogo";
}) {
  const t = useT();
  const campoId = useId();
  const [aberto, setAberto] = useState(false);
  const camposPessoa: Campo[] = [
    { nome: "cpf", rotulo: t("CPF"), obrigatorio: true },
    { nome: "nome", rotulo: t("Nome completo") }, { nome: "email", rotulo: t("E-mail"), tipo: "email" },
    { nome: "celular", rotulo: t("Celular") }, { nome: "nascimento", rotulo: t("Data de nascimento"), tipo: "date" },
    { nome: "rg", rotulo: t("RG") }, { nome: "profissao", rotulo: t("Profissão") },
    { nome: "endereco", rotulo: t("Endereço atual") }, { nome: "numero", rotulo: t("Número") },
    { nome: "complemento", rotulo: t("Complemento") }, { nome: "bairro", rotulo: t("Bairro") },
    { nome: "cep", rotulo: t("CEP") }, { nome: "cidade", rotulo: t("Cidade") }, { nome: "uf", rotulo: t("UF") },
  ];
  const [ocupado, setOcupado] = useState(false);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [resultado, setResultado] = useState<ResultadoContrato | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [revisado, setRevisado] = useState(false);
  const [confirmacaoIniciada, setConfirmacaoIniciada] = useState(false);
  const [locatarios, setLocatarios] = useState(1);
  const [fiadores, setFiadores] = useState(0);
  const [valores, setValores] = useState<Record<string, string>>({});
  const emCurso = useRef(false);
  const rota = `/api/v1/conversations/${conversationId}/painel-agente/contrato`;

  const bloqueado = ocupado || desabilitado || confirmacaoIniciada;
  function campo({ nome, rotulo, tipo, obrigatorio }: Campo) {
    return <label key={nome} className="grid gap-1 text-sm">
      <span>{rotulo}{obrigatorio ? " *" : ""}</span>
      <Input name={nome} defaultValue={valores[nome] ?? ""} type={tipo ?? "text"} required={obrigatorio} maxLength={240}
        {...(tipo === "number" ? { min: 0, step: "any" } : {})} />
    </label>;
  }
  function selecao(nome: string, rotulo: string, opcoes: Array<[string, string]>, padrao = "") {
    return <label className="grid gap-1 text-sm">
      <span id={`${campoId}-${nome}`}>{rotulo} *</span>
      <select aria-labelledby={`${campoId}-${nome}`} name={nome} required defaultValue={valores[nome] ?? padrao} className="h-10 rounded-sm border border-border bg-bg px-3 text-text">
        {!padrao && <option value="" disabled>{t("Selecione")}</option>}
        {opcoes.map(([valor, texto]) => <option key={valor} value={valor}>{texto}</option>)}
      </select>
    </label>;
  }
  function pessoas(tipo: "locatarios" | "fiadores", quantidade: number) {
    return Array.from({ length: quantidade }, (_, i) => <fieldset key={`${tipo}-${i}`} className="space-y-3 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-medium">{tipo === "locatarios" ? t("Locatário") : t("Fiador")} {i + 1}</legend>
      <p className="text-xs text-muted-foreground">{t("O Hub busca o cadastro pelo CPF. Preencha os demais dados se a pessoa ainda não estiver cadastrada.")}</p>
      <div className="grid gap-3 sm:grid-cols-2">{camposPessoa.slice(0, 2).map((c) => campo({ ...c, nome: `${tipo}.${i}.${c.nome}` }))}</div>
      <details className="space-y-3">
        <summary className="cursor-pointer text-sm">{t("Dados para novo cadastro")}</summary>
        <div className="grid gap-3 sm:grid-cols-2">{camposPessoa.slice(2).map((c) => campo({ ...c, nome: `${tipo}.${i}.${c.nome}` }))}</div>
      </details>
    </fieldset>);
  }

  async function preparar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (emCurso.current || desabilitado || confirmacaoIniciada) return;
    const form = new FormData(evento.currentTarget);
    const ler = (nome: string) => String(form.get(nome) ?? "").trim();
    const pessoasDoForm = (tipo: "locatarios" | "fiadores", quantidade: number) => Array.from({ length: quantidade }, (_, i) => ({
      cpf: ler(`${tipo}.${i}.cpf`).replace(/\D/g, ""),
      dados: Object.fromEntries(camposPessoa.filter((c) => c.nome !== "cpf").map((c) => [c.nome, ler(`${tipo}.${i}.${c.nome}`)]).filter(([, valor]) => valor)),
    }));
    const dados = {
      imovel: Object.fromEntries(["endereco", "numero", "complemento"].map((n) => [n, ler(`imovel.${n}`)]).filter(([, v]) => v)),
      locatarios: pessoasDoForm("locatarios", locatarios),
      ...(fiadores ? { fiadores: pessoasDoForm("fiadores", fiadores) } : {}),
      ...Object.fromEntries(["aluguel", "prazo_meses", "dia_vencimento", "caucao_valor", "taxa_adm", "taxa_locacao"]
        .filter((n) => ler(n)).map((n) => [n, Number(ler(n))])),
      split: ler("split") === "true",
      isencao_multa_meses: Number(ler("isencao_multa_meses") || "0"),
      ...Object.fromEntries(["data_inicio", "data_fim", "indice_reajuste", "tipo", "garantia", "seguradora_fianca", "apolice", "observacao"]
        .filter((n) => ler(n)).map((n) => [n, ler(n)])),
      ...Object.fromEntries(["iptu", "seguro_fianca"].filter((n) => ler(`${n}.valor_mensal`))
        .map((n) => [n, { valor_mensal: Number(ler(`${n}.valor_mensal`)) }])),
    } as DadosContrato;
    emCurso.current = true;
    setOcupado(true); setErro(null); setPrevia(null); setRevisado(false);
    try {
      const r = await apiClient.post<{ data: Previa }>(rota, { etapa: "preparar", dados }, { timeoutMs: 120_000 });
      setPrevia(r.data);
    } catch (e) { setErro(e instanceof Error ? e.message : t("Não foi possível preparar a locação.")); }
    finally { emCurso.current = false; setOcupado(false); }
  }

  async function confirmar() {
    if (emCurso.current || desabilitado || !previa?.token || !revisado) return;
    emCurso.current = true;
    setOcupado(true); setErro(null); setConfirmacaoIniciada(true);
    try {
      const r = await apiClient.post<{ data: ResultadoContrato }>(rota,
        { etapa: "confirmar", token: previa.token, confirmado: true }, { timeoutMs: 120_000 });
      setResultado(r.data);
      if (!r.data.gravado) setErro(t("A locação não foi concluída. Confira o SuperLógica e tente novamente pela mesma prévia."));
    } catch (e) { setErro(e instanceof Error ? e.message : t("Não foi possível confirmar a locação.")); }
    finally { emCurso.current = false; setOcupado(false); }
  }

  const garantias: Array<[string, string]> = [["nenhuma", t("Nenhuma")], ["caucao", t("Caução")], ["seguro_fianca", t("Seguro fiança")], ["fiador", t("Fiador")]];

  const corpo = <>
    {!resultado?.gravado && <form onSubmit={(e) => void preparar(e)} onChange={(e) => {
      const alvo = e.target;
      if (alvo instanceof HTMLInputElement || alvo instanceof HTMLSelectElement) {
        setValores((v) => ({ ...v, [alvo.name]: alvo.value }));
      }
      if (!confirmacaoIniciada) { setPrevia(null); setRevisado(false); }
    }} className="space-y-4">
      <fieldset disabled={bloqueado} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {campo({ nome: "imovel.endereco", rotulo: t("Endereço do imóvel"), obrigatorio: true })}
          {campo({ nome: "imovel.numero", rotulo: t("Número do imóvel") })}
          {campo({ nome: "imovel.complemento", rotulo: t("Complemento do imóvel") })}
          {campo({ nome: "aluguel", rotulo: t("Aluguel mensal (R$)"), tipo: "number", obrigatorio: true })}
          {campo({ nome: "data_inicio", rotulo: t("Início da locação"), tipo: "date", obrigatorio: true })}
          {campo({ nome: "data_fim", rotulo: t("Fim da locação"), tipo: "date" })}
          {campo({ nome: "prazo_meses", rotulo: t("Prazo em meses"), tipo: "number" })}
          {campo({ nome: "isencao_multa_meses", rotulo: t("Meses de isenção de multa"), tipo: "number" })}
          {campo({ nome: "dia_vencimento", rotulo: t("Dia de vencimento"), tipo: "number", obrigatorio: true })}
          {selecao("tipo", t("Tipo de locação"), [["residencial", t("Residencial")], ["comercial", t("Comercial")]])}
          {selecao("indice_reajuste", t("Índice de reajuste"), [["IGPM", t("IGP-M")], ["IPCA", t("IPCA")]])}
          {selecao("garantia", t("Garantia"), garantias)}
          {selecao("split", t("Split (repasse automático)"), [["false", t("Não ligar o split")], ["true", t("Ligar o split")]], "false")}
          {campo({ nome: "caucao_valor", rotulo: t("Valor da caução (R$)"), tipo: "number" })}
          {campo({ nome: "seguradora_fianca", rotulo: t("Seguradora do seguro fiança") })}
          {campo({ nome: "apolice", rotulo: t("Número da apólice") })}
        </div>
        {pessoas("locatarios", locatarios)}
        <Button type="button" variant="outline" onClick={() => { setPrevia(null); setLocatarios((n) => n + 1); }} disabled={locatarios >= 10}>{t("Adicionar locatário")}</Button>
        {locatarios > 1 && <Button type="button" variant="ghost" onClick={() => { setPrevia(null); setLocatarios((n) => n - 1); }}>{t("Remover último locatário")}</Button>}
        {pessoas("fiadores", fiadores)}
        <Button type="button" variant="outline" onClick={() => { setPrevia(null); setFiadores((n) => n + 1); }} disabled={fiadores >= 10}>{t("Adicionar fiador")}</Button>
        {fiadores > 0 && <Button type="button" variant="ghost" onClick={() => { setPrevia(null); setFiadores((n) => n - 1); }}>{t("Remover último fiador")}</Button>}
        <details className="space-y-3">
          <summary className="cursor-pointer text-sm font-medium">{t("Taxas e despesas da locação")}</summary>
          <p className="text-xs text-muted-foreground">{t("Campos opcionais em branco usam os valores definidos pelo Hub. Confira todas as taxas e condições na prévia antes de confirmar.")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {campo({ nome: "taxa_adm", rotulo: t("Taxa de administração (%)"), tipo: "number" })}
            {campo({ nome: "taxa_locacao", rotulo: t("Taxa de locação (%)"), tipo: "number" })}
            {campo({ nome: "iptu.valor_mensal", rotulo: t("IPTU mensal (R$)"), tipo: "number" })}
            {campo({ nome: "seguro_fianca.valor_mensal", rotulo: t("Seguro fiança mensal (R$)"), tipo: "number" })}
            {campo({ nome: "observacao", rotulo: t("Observação") })}
          </div>
        </details>
        <Button type="submit">{ocupado ? t("Preparando…") : t("Preparar locação")}</Button>
      </fieldset>
    </form>}
    {previa && !resultado?.gravado && <section aria-label={t("Prévia da locação")} className="space-y-3 rounded-md border border-border p-3">
      <h4 className="font-medium">{t("Prévia da locação")}</h4>
      <p className="whitespace-pre-wrap wrap-anywhere text-sm">{previa.resumo}</p>
      {[...previa.pendencias.map(textoDaPendencia), ...previa.avisos].map((p, i) => <p key={i} className="text-sm">{p}</p>)}
      {previa.token && <>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={revisado} disabled={ocupado || desabilitado || confirmacaoIniciada}
            onChange={(e) => setRevisado(e.target.checked)} />
          {t("Conferi todos os dados, taxas e condições. Confirmo a criação da locação ativa no SuperLógica.")}
        </label>
        <Button disabled={ocupado || desabilitado || !revisado} onClick={() => void confirmar()}>
          {ocupado ? t("Confirmando…") : confirmacaoIniciada ? t("Consultar ou retomar confirmação") : t("Confirmar criação da locação")}
        </Button>
      </>}
    </section>}
    {resultado?.gravado && <section role="status" className="space-y-2 text-sm">
      <p className="font-medium">{t("Locação criada no SuperLógica.")}</p>
      <p>{t("Contrato")}: {resultado.id_contrato} · {resultado.situacao}</p>
      {resultado.completo === false && <p>{t("O contrato foi criado, mas há despesas pendentes. Confira no SuperLógica antes de prosseguir.")}</p>}
      {[resultado.proximo_passo, resultado.acao_humana, ...resultado.acoes_manuais, ...resultado.avisos, ...resultado.divergencias]
        .filter(Boolean).map((p, i) => <p key={i}>{p}</p>)}
    </section>}
    {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
    {modo === "dialogo" ? (
      <Button variant="ghost" disabled={ocupado} onClick={() => setAberto(false)}>{t("Fechar")}</Button>
    ) : null}
  </>;

  if (modo === "embutido") return corpo;

  return <Dialog open={aberto} onOpenChange={(v) => { if (!ocupado) setAberto(v); }}>
    <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={desabilitado}
      onClick={() => setAberto(true)}>{t("Gerar contrato")}</Button>
    <DialogContent className="max-h-[90dvh] overflow-y-auto bg-bg text-text sm:max-w-3xl" onInteractOutside={(e) => e.preventDefault()}>
      <DialogHeader>
        <DialogTitle>{t("Gerar contrato no SuperLógica")}</DialogTitle>
        <DialogDescription>{t("Preencha os dados da locação e confira a prévia. A gravação acontece somente após sua confirmação. O contrato será criado como ativo.")}</DialogDescription>
      </DialogHeader>
      {corpo}
    </DialogContent>
  </Dialog>;
}

/** Dados ficam na tela; a preparação não grava a locação. Sem envio ao cliente. */
export function GerarContratoDialog({ conversationId, desabilitado = false }: {
  conversationId: string; desabilitado?: boolean;
}) {
  return <FormularioGerarContrato conversationId={conversationId} desabilitado={desabilitado} modo="dialogo" />;
}
