/**
 * Casca das abas do modal de locação: estado visível, checklist e ponto de
 * ligação da renda assíncrona. Sem React. Sem cliente MCP do Hub.
 */
import type { LocacaoExecucaoRow } from "@/lib/locacao/tipos-banco";
import {
  ABAS_DA_EXECUCAO,
  type AbaDaExecucao,
  type EstadoDaExecucao,
  type OrigemDaExecucao,
} from "@/lib/locacao/vocabulario";

export const ABAS_DO_MODAL_LOCACAO = ABAS_DA_EXECUCAO;
export type AbaDoModalLocacao = AbaDaExecucao;

export const ROTULO_DA_ABA: Record<AbaDaExecucao, string> = {
  dados: "Dados",
  renda: "Análise de renda",
  fc: "Análise FC",
  migra: "Análise Migra",
  relatorio: "Relatório",
  contrato: "Gerar contrato",
  documentos: "Documentos",
};

export const ROTULO_DO_BOTAO_DA_ABA: Partial<Record<AbaDaExecucao, string>> = {
  renda: "Analisar renda",
  fc: "Analisar FC",
  migra: "Analisar Migra",
  relatorio: "Gerar relatório",
};

/**
 * PONTO DE LIGAÇÃO — renda assíncrona.
 * O botão da aba renda chama o POST que só enfileira (202 + execucao_id).
 * A casca lê o andamento em `locacao_execucoes`.
 */
export const PONTO_RENDA_ASSINCRONA = {
  rota: "/api/v1/conversations/:id/painel-agente/renda",
  estado: "assincrono",
} as const;

export const MS_POLLING_DA_EXECUCAO = 2000;

export type ExecucaoPublica = {
  id: string;
  aba: AbaDaExecucao;
  estado: EstadoDaExecucao;
  etapa_texto: string | null;
  progresso_atual: number;
  progresso_total: number;
  erro_motivo: string | null;
  entrada_hash: string | null;
  ficha_versao: number | null;
  origem: OrigemDaExecucao;
  iniciado_em: string | null;
  terminado_em: string | null;
  created_at: string;
  updated_at: string;
  /** Recorte público do `resultado` (sem senha de PDF). */
  resultado?: Record<string, unknown> | null;
};

export type EstadoVisivelDaAba =
  | "sem_execucao"
  | "na_fila"
  | "processando"
  | "concluido"
  | "erro"
  | "desatualizado";

export type ContextoDoChecklist = {
  temProcesso: boolean;
  rendaConfirmada: boolean;
  analiseLigada: boolean;
};

const ESTADOS_EM_ANDAMENTO: readonly EstadoDaExecucao[] = ["na_fila", "processando"];

export function resultadoPublicoDaExecucao(
  resultado: LocacaoExecucaoRow["resultado"],
): Record<string, unknown> | null {
  if (!resultado || typeof resultado !== "object" || Array.isArray(resultado)) return null;
  const bruto = { ...(resultado as Record<string, unknown>) };
  delete bruto.senhas;
  return bruto;
}

export function paraExecucaoPublica(row: LocacaoExecucaoRow): ExecucaoPublica {
  return {
    id: row.id,
    aba: row.aba,
    estado: row.estado,
    etapa_texto: row.etapa_texto,
    progresso_atual: row.progresso_atual,
    progresso_total: row.progresso_total,
    erro_motivo: row.erro_motivo,
    entrada_hash: row.entrada_hash,
    ficha_versao: row.ficha_versao,
    origem: row.origem,
    iniciado_em: row.iniciado_em,
    terminado_em: row.terminado_em,
    created_at: row.created_at,
    updated_at: row.updated_at,
    resultado: resultadoPublicoDaExecucao(row.resultado),
  };
}

/** Confirmada e a ficha não avançou depois. Sem versão, vale o carimbo. */
export function rendaConfirmadaNaVersaoAtual(p: {
  renda_confirmada_em?: string | null;
  renda_confirmada_ficha_versao?: number | null;
  ficha_versao?: number | null;
} | null | undefined): boolean {
  if (!p?.renda_confirmada_em) return false;
  if (p.ficha_versao == null || p.renda_confirmada_ficha_versao == null) return true;
  return p.ficha_versao <= p.renda_confirmada_ficha_versao;
}

export type RelatorioDeRendaDaExecucao = {
  execucao_id: string;
  estado: EstadoDaExecucao;
  etapa_texto: string | null;
  progresso_atual: number;
  progresso_total: number;
  motivo: string | null;
  resumo: string | null;
  renda_comprovada: number | null;
  renda_proposta_fc: number | null;
  alertas: string[];
  checklist: string[];
  regra_3x: { frase?: string; exclusoes?: Array<{ rotulo: string; volume: number }> } | null;
};

function numeroFinito(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function textos(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "")
    : [];
}

/** Relatório da última análise de renda, sem senha de PDF. */
export function relatorioDeRendaDaExecucao(
  e: ExecucaoPublica | null | undefined,
): RelatorioDeRendaDaExecucao | null {
  if (!e) return null;
  const r = e.resultado ?? {};
  const regraBruta = r.regra_3x;
  const regra = regraBruta && typeof regraBruta === "object" && !Array.isArray(regraBruta)
    ? (regraBruta as RelatorioDeRendaDaExecucao["regra_3x"])
    : null;
  return {
    execucao_id: e.id,
    estado: e.estado,
    etapa_texto: e.etapa_texto,
    progresso_atual: e.progresso_atual,
    progresso_total: e.progresso_total,
    motivo: e.erro_motivo,
    resumo: typeof r.resumo === "string" ? r.resumo : null,
    renda_comprovada: numeroFinito(r.renda_comprovada),
    renda_proposta_fc: numeroFinito(r.renda_proposta_fc),
    alertas: textos(r.alertas),
    checklist: textos(r.checklist),
    regra_3x: regra,
  };
}

/** Linhas visíveis do resultado de FC/Migra (sem dado pessoal). */
export function linhasDoResultadoPublico(
  resultado: Record<string, unknown> | null | undefined,
): string[] {
  if (!resultado) return [];
  const linhas: string[] = [];
  if (typeof resultado.resumo === "string" && resultado.resumo.trim()) {
    linhas.push(resultado.resumo.trim());
  }
  const idFc = typeof resultado.id_fc === "string"
    ? resultado.id_fc
    : typeof resultado.fc_id === "string"
      ? resultado.fc_id
      : null;
  if (idFc) linhas.push(`ID-FC: ${idFc}`);
  if (typeof resultado.estado === "string" && resultado.estado.trim()) {
    linhas.push(`Estado: ${resultado.estado.trim()}`);
  }
  if (resultado.score != null && resultado.score !== "") {
    linhas.push(`Score: ${String(resultado.score)}`);
  }
  if (typeof resultado.risco === "string" && resultado.risco.trim()) {
    linhas.push(`Risco: ${resultado.risco.trim()}`);
  }
  const cards = Array.isArray(resultado.cards) ? resultado.cards : [];
  for (const c of cards.slice(0, 8)) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    const linha = [o.seguradora, o.codigo ?? o.codigo_cotacao, o.status, o.plano]
      .filter((x) => typeof x === "string" && x.trim())
      .join(" · ");
    if (linha) linhas.push(linha);
  }
  return linhas;
}

export function execucaoEmAndamento(execucao: ExecucaoPublica | null | undefined): boolean {
  return !!execucao && ESTADOS_EM_ANDAMENTO.includes(execucao.estado);
}

export function estadoVisivelDaAba(
  execucao: ExecucaoPublica | null | undefined,
  opts: { hashAtual?: string | null; entradaSuja?: boolean } = {},
): EstadoVisivelDaAba {
  if (!execucao) return "sem_execucao";
  if (execucao.estado === "na_fila" || execucao.estado === "processando" || execucao.estado === "erro") {
    return execucao.estado;
  }
  if (execucao.estado === "desatualizado") return "desatualizado";
  if (execucao.estado === "concluido") {
    if (opts.entradaSuja) return "desatualizado";
    const atual = opts.hashAtual;
    if (atual && execucao.entrada_hash && atual !== execucao.entrada_hash) return "desatualizado";
  }
  return execucao.estado;
}

export function rotuloDoEstadoVisivel(estado: EstadoVisivelDaAba, etapaTexto?: string | null): string {
  switch (estado) {
    case "sem_execucao":
      return "Sem execução nesta aba.";
    case "na_fila":
      return "Na fila";
    case "processando":
      return etapaTexto?.trim() ? etapaTexto.trim() : "Processando";
    case "concluido":
      return "Concluído";
    case "erro":
      return "Erro";
    case "desatualizado":
      return "desatualizado — rode de novo";
    default: {
      const _nunca: never = estado;
      return _nunca;
    }
  }
}

export function checklistDaAba(aba: AbaDaExecucao, ctx: ContextoDoChecklist): string[] {
  if (aba === "documentos") return [];
  if (aba === "dados") {
    return ctx.temProcesso ? [] : ["Preencha ou gere a ficha pela conversa."];
  }
  const falta: string[] = [];
  if (!ctx.temProcesso) falta.push("Salve a ficha para abrir o processo.");
  if ((aba === "fc" || aba === "migra") && ctx.temProcesso && !ctx.rendaConfirmada) {
    falta.push("Confirme a renda antes de rodar esta etapa.");
  }
  if (
    (aba === "renda" || aba === "fc" || aba === "migra" || aba === "relatorio")
    && !ctx.analiseLigada
  ) {
    falta.push("Esta etapa está desligada em Configurações › Locação.");
  }
  return falta;
}

export function horaDaUltimaExecucao(execucao: ExecucaoPublica | null | undefined): string | null {
  if (!execucao) return null;
  return execucao.terminado_em ?? execucao.iniciado_em ?? execucao.created_at;
}

export function execucoesVazias(): Record<AbaDaExecucao, ExecucaoPublica | null> {
  return {
    dados: null,
    renda: null,
    fc: null,
    migra: null,
    relatorio: null,
    contrato: null,
    documentos: null,
  };
}
