"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import {
  estadoVisivelDaAba,
  horaDaUltimaExecucao,
  linhasDoResultadoPublico,
  type ExecucaoPublica,
  type EstadoVisivelDaAba,
} from "@/lib/locacao/execucao-da-aba";

function formatarHora(iso: string | null, tag: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(tag, { dateStyle: "short", timeStyle: "short" }).format(d);
}

function rotuloDoEstado(
  t: (chave: string) => string,
  estado: EstadoVisivelDaAba,
  etapaTexto: string | null | undefined,
): string {
  if (estado === "sem_execucao") return t("Sem execução nesta aba.");
  if (estado === "na_fila") return t("Na fila");
  if (estado === "processando") return etapaTexto?.trim() ? etapaTexto.trim() : t("Processando");
  if (estado === "concluido") return t("Concluído");
  if (estado === "erro") return t("Erro");
  return t("desatualizado — rode de novo");
}

function rotuloDoBotao(t: (chave: string) => string, rotulo: string): string {
  if (rotulo === "Analisar renda") return t("Analisar renda");
  if (rotulo === "Analisar FC") return t("Analisar FC");
  if (rotulo === "Analisar Migra") return t("Analisar Migra");
  if (rotulo === "Analisar seguro-fiança") return t("Analisar Migra");
  if (rotulo === "Gerar relatório") return t("Gerar relatório");
  return rotulo;
}

function textoDoChecklist(t: (chave: string) => string, item: string): string {
  if (item === "Preencha ou gere a ficha pela conversa.") {
    return t("Preencha ou gere a ficha pela conversa.");
  }
  if (item === "Salve a ficha para abrir o processo.") {
    return t("Salve a ficha para abrir o processo.");
  }
  if (item === "Confirme a renda antes de rodar esta etapa.") {
    return t("Confirme a renda antes de rodar esta etapa.");
  }
  if (item === "Esta etapa está desligada em Configurações › Locação.") {
    return t("Esta etapa está desligada em Configurações › Locação.");
  }
  return item;
}

export function AbaComExecucao({
  execucao,
  checklist = [],
  hashAtual = null,
  entradaSuja = false,
  rotuloBotao,
  onRodar,
  desabilitado = false,
  ocupado = false,
  erroImediato,
  children,
}: {
  execucao: ExecucaoPublica | null;
  checklist?: string[];
  hashAtual?: string | null;
  entradaSuja?: boolean;
  rotuloBotao?: string;
  onRodar?: () => void | Promise<void>;
  desabilitado?: boolean;
  ocupado?: boolean;
  erroImediato?: string | null;
  children?: ReactNode;
}) {
  const t = useT();
  const tag = useTagDeIdioma();
  const estado: EstadoVisivelDaAba = estadoVisivelDaAba(execucao, { hashAtual, entradaSuja });
  const emAndamento = estado === "na_fila" || estado === "processando";
  const hora = formatarHora(horaDaUltimaExecucao(execucao), tag);
  const motivo = (execucao?.erro_motivo?.trim() || erroImediato?.trim() || "")
    || (estado === "erro" ? t("Não foi possível concluir.") : "");
  const mostrarErro = estado === "erro" || !!erroImediato?.trim();
  const linhasResultado = linhasDoResultadoPublico(execucao?.resultado ?? null)
    .filter((linha) => linha !== motivo);
  const podeRodar = !!onRodar && !!rotuloBotao && !desabilitado && !ocupado && !emAndamento && checklist.length === 0;
  const podeTentar = estado === "erro" && !!onRodar && !desabilitado && !ocupado;

  return (
    <div className="space-y-2" data-testid="aba-com-execucao" data-estado={estado}>
      <div className="space-y-1 rounded-md border border-border p-2" data-testid="status-da-execucao">
        <p role="status" className="text-xs font-medium" data-testid="rotulo-da-execucao">
          {rotuloDoEstado(t, estado, execucao?.etapa_texto)}
        </p>
        {estado === "processando" && execucao && execucao.progresso_total > 0 ? (
          <p className="text-[11px] text-text-muted">
            {execucao.progresso_atual} / {execucao.progresso_total}
          </p>
        ) : null}
        {mostrarErro && motivo ? <p role="alert" className="text-xs text-destructive">{motivo}</p> : null}
        {linhasResultado.length > 0 ? (
          <div className="space-y-0.5" data-testid="resultado-da-execucao">
            {linhasResultado.map((linha) => (
              <p key={linha} className="text-xs whitespace-pre-wrap">{linha}</p>
            ))}
          </div>
        ) : null}
        {hora ? (
          <p className="text-[11px] text-text-muted" data-testid="hora-da-execucao">
            {t("Última execução")}: {hora}
          </p>
        ) : null}
        {checklist.length > 0 ? (
          <div>
            <p className="text-[11px] font-medium">{t("Que falta para rodar")}</p>
            <ul className="list-disc pl-4 text-[11px] text-text-muted">
              {checklist.map((item) => <li key={item}>{textoDoChecklist(t, item)}</li>)}
            </ul>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-1.5">
          {rotuloBotao && onRodar ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              disabled={!podeRodar}
              onClick={() => void onRodar()}
            >
              {ocupado && emAndamento ? t("Processando") : rotuloDoBotao(t, rotuloBotao)}
            </Button>
          ) : null}
          {podeTentar ? (
            <Button
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => void onRodar?.()}
            >
              {t("Tentar de novo")}
            </Button>
          ) : null}
        </div>
      </div>
      {children}
    </div>
  );
}
