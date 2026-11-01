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
  renda: "Renda",
  fc: "FC",
  migra: "Migra",
  relatorio: "Relatório",
  contrato: "Contrato",
  documentos: "Documentos",
};

export const ROTULO_DO_BOTAO_DA_ABA: Partial<Record<AbaDaExecucao, string>> = {
  renda: "Analisar renda",
  fc: "Analisar FC",
  migra: "Analisar seguro-fiança",
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
  };
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
