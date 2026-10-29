"use client";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useFichaPreliminar } from "@/hooks/inbox/useFichaPreliminar";
import { useT } from "@/hooks/i18n/useT";
import { normalizarRendaUtilizada } from "@/lib/locacao/renda-utilizada";
import { fichaVazia } from "@/lib/locacao/ficha-schema";
import {
  PAPEIS_DA_FICHA,
  pessoaVazia,
  type CampoFicha,
  type FichaPreliminar,
  type NumeroFicha,
  type PapelDaFicha,
} from "@/lib/locacao/ficha-schema";

interface Props {
  atualizacao?: number;
  onSalvo?: () => void;
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
  return { valor: valor.trim() || null, fonte: "atendente", trecho: null, confianca: 1, message_id: null };
}

function numero(valor: string): NumeroFicha {
  const n = Number(valor.replace(",", "."));
  return {
    valor: Number.isFinite(n) && valor.trim() !== "" ? n : null,
    fonte: "atendente", trecho: null, confianca: 1, message_id: null,
  };
}

function textoDe(c: CampoFicha | NumeroFicha | undefined): string {
  if (!c || c.valor === null || c.valor === undefined) return "";
  return String(c.valor);
}

export function FichaPreliminarPainel({ conversationId, desabilitado = false, senhasPdf, atualizacao = 0, onSalvo }: Props) {
  const t = useT();
  const {
    ficha, setFicha, relatorio, setRelatorio, versao, historico,
    somenteLeitura, setSomenteLeitura, carregando, gerando, erro,
    gerar, salvar, verVersao,
  } = useFichaPreliminar(conversationId, atualizacao);

  function patchPessoa(i: number, patch: Partial<FichaPreliminar["pessoas"][number]>) {
    setFicha((atual) => {
      if (!atual) return atual;
      const pessoas = atual.pessoas.map((p, idx) => idx === i ? { ...p, ...patch } : p);
      return { ...atual, pessoas };
    });
  }

  const bloqueado = desabilitado || carregando !== null || gerando;

  return (
    <div className="space-y-2" data-testid="ficha-preliminar">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs"
          disabled={bloqueado} onClick={() => void gerar(senhasPdf)}>
          {gerando || carregando === "gerar" ? t("gerando…") : t("Preencher pela conversa")}
        </Button>
        {!ficha && <Button size="sm" variant="outline" disabled={bloqueado} onClick={() => setFicha(fichaVazia())}>{t("Preencher manualmente")}</Button>}
        {ficha && !somenteLeitura && (
          <Button size="sm" variant="secondary" className="h-7 px-2 text-xs"
            disabled={bloqueado} onClick={() => void salvar(normalizarRendaUtilizada(ficha), relatorio || "Cadastro preenchido pelo atendente.", versao).then((ok) => {
              if (ok) { toast.success(t("Ficha salva.")); onSalvo?.(); }
            })}>
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
      {gerando && !erro && (
        <p className="text-[11px] text-muted-foreground" data-testid="ficha-gerando">{t("gerando…")}</p>
      )}
      {erro && <p role="alert" className="text-xs text-destructive">{erro}</p>}
      {ficha && (
        <div className="space-y-3 rounded-md border border-border p-2">
          <div>
            <h4 className="text-[11px] font-semibold">{t("Relatório preliminar")} · {t("Versão")} {versao}</h4>
            <Textarea className="mt-1 min-h-20 text-xs" value={relatorio} disabled={somenteLeitura || desabilitado}
              onChange={(e) => setRelatorio(e.target.value)} maxLength={60000} rows={6} />
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
                {(["nascimento", "rg", "profissao", "empregador"] as const).map((chave) => (
                  <label key={chave} className="block text-[11px]">{t({ nascimento: "Nascimento", rg: "RG", profissao: "Profissão", empregador: "Empregador"}[chave])}
                    <Input className="h-8 text-xs" value={textoDe(p[chave])} disabled={somenteLeitura || desabilitado}
                      onChange={(e) => patchPessoa(i, { [chave]: campo(e.target.value) })} />
                  </label>
                ))}
                {p.papel !== "contato" && <label className="block text-[11px]">{t("RENDA (R$)")}
                  <Input className="h-8 text-xs" inputMode="decimal" value={textoDe(p.renda_individual)} disabled={somenteLeitura || desabilitado}
                    onChange={(e) => patchPessoa(i, { renda_individual: numero(e.target.value) })} />
                </label>}
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
            {(["aluguel", "condominio", "iptu", "seguro_incendio"] as const).map((chave) => (
              <label key={chave} className="block text-[11px]">{t(chave === "aluguel" ? "Aluguel (R$)" : chave === "condominio" ? "Condomínio / rateio (R$)" : chave === "iptu" ? "IPTU mensal (R$)" : "Seguro-incêndio mensal (R$)")}
                <Input className="h-8 text-xs" inputMode="decimal" value={textoDe(ficha.imovel[chave])} disabled={somenteLeitura || desabilitado}
                  onChange={(e) => setFicha((a) => a ? { ...a, imovel: { ...a.imovel, [chave]: numero(e.target.value) } } : a)} />
              </label>
            ))}
            {(["complemento", "bairro", "cep", "cidade", "uf"] as const).map((chave) => (
              <label key={chave} className="block text-[11px]">{t({complemento: "Complemento", bairro: "Bairro", cep: "CEP", cidade: "Cidade", uf: "UF"}[chave])}
                <Input className="h-8 text-xs" value={textoDe(ficha.imovel[chave])} disabled={somenteLeitura || desabilitado}
                  onChange={(e) => setFicha((a) => a ? { ...a, imovel: { ...a.imovel, [chave]: campo(e.target.value) } } : a)} />
              </label>
            ))}
            <label className="block text-[11px]">{t("Tipo de imóvel")}
              <select className="h-8 w-full rounded border border-input bg-background text-xs" value={ficha.imovel.tipo ?? ""} disabled={somenteLeitura || desabilitado}
                onChange={(e) => { const tipo = e.target.value as FichaPreliminar["imovel"]["tipo"]; setFicha((a) => a ? {...a, imovel: {...a.imovel, tipo: tipo || null}} : a); }}>
                <option value="">{t("Selecionar")}</option><option value="residencial">{t("Residencial")}</option><option value="comercial">{t("Comercial")}</option>
              </select>
            </label>
            <label className="block text-[11px]">{t("Código FC")}
              <Input className="h-8 text-xs" value={textoDe(ficha.imovel.codigo_fc)} disabled={somenteLeitura || desabilitado}
                onChange={(e) => setFicha((a) => a ? { ...a, imovel: { ...a.imovel, codigo_fc: campo(e.target.value) } } : a)} />
            </label>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {(["inicio", "fim"] as const).map((chave) => <label key={chave} className="text-[11px]">{t(chave === "inicio" ? "Início da locação" : "Término da locação")}
              <Input type="date" className="h-8 text-xs" value={textoDe(ficha.vigencia[chave])} disabled={somenteLeitura || desabilitado}
                onChange={(e) => setFicha((a) => a ? {...a, vigencia: {...a.vigencia, [chave]: campo(e.target.value)}} : a)} />
            </label>)}
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
