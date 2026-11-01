/**
 * Leitura e gravação mínima de `locacao_execucoes` (migration 0772).
 * Service role + organization_id da sessão. Sem tela neste PR.
 * Sem dado pessoal neste arquivo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { tabelaLocacao } from "@/lib/locacao/admin";
import { LocacaoErro } from "@/lib/locacao/repositorio";
import type { LocacaoExecucaoRow } from "@/lib/locacao/tipos-banco";
import type {
  AbaDaExecucao,
  CategoriaDeDocumento,
  EstadoDaExecucao,
  OrigemDaExecucao,
} from "@/lib/locacao/vocabulario";

const COLUNAS =
  "id,organization_id,processo_id,participante_id,aba,estado,etapa_texto,progresso_atual,progresso_total,erro_codigo,erro_motivo,entrada_hash,ficha_versao,origem,ator_user_id,resultado,iniciado_em,terminado_em,call_id,created_at,updated_at";

const ESTADOS_EM_ANDAMENTO: readonly EstadoDaExecucao[] = ["na_fila", "processando"];
const ESTADOS_TERMINAIS: readonly EstadoDaExecucao[] = ["concluido", "erro", "desatualizado"];

function asLinha(row: unknown): LocacaoExecucaoRow {
  return row as LocacaoExecucaoRow;
}

/** Pasta da ficha cadastral impressa no bucket `locacao-processos`. */
export const PASTA_FICHA_CADASTRAL = "ficha_cadastral" satisfies CategoriaDeDocumento;

/**
 * `{org}/processos/{processo}/{categoria}/{arquivo}`.
 * Ficha cadastral impressa: `{org}/processos/{id}/ficha_cadastral/{id}.{ext}`.
 */
export function caminhoDeDocumentoDoProcesso(
  orgId: string,
  processoId: string,
  categoria: CategoriaDeDocumento,
  arquivo: string,
): string {
  return `${orgId}/processos/${processoId}/${categoria}/${arquivo}`;
}

export async function abrirExecucao(
  admin: SupabaseClient,
  input: {
    orgId: string;
    processoId: string;
    aba: AbaDaExecucao;
    origem: OrigemDaExecucao;
    atorUserId: string;
    participanteId?: string | null;
    entradaHash?: string | null;
    fichaVersao?: number | null;
    callId?: string | null;
    etapaTexto?: string | null;
    progressoTotal?: number;
    resultado?: Record<string, unknown> | null;
  },
): Promise<string> {
  const { data, error } = await tabelaLocacao(admin, "locacao_execucoes")
    .insert({
      organization_id: input.orgId,
      processo_id: input.processoId,
      participante_id: input.participanteId ?? null,
      aba: input.aba,
      estado: "na_fila",
      etapa_texto: input.etapaTexto ?? null,
      progresso_atual: 0,
      progresso_total: input.progressoTotal ?? 0,
      entrada_hash: input.entradaHash ?? null,
      ficha_versao: input.fichaVersao ?? null,
      origem: input.origem,
      ator_user_id: input.atorUserId,
      call_id: input.callId ?? null,
      resultado: input.resultado ?? null,
    })
    .select("id")
    .maybeSingle();
  if (error?.code === "23505") {
    const corrida = await lerExecucaoEmAndamento(admin, input.orgId, input.processoId, input.aba);
    if (corrida) return corrida.id;
  }
  if (error || !data || typeof (data as { id?: unknown }).id !== "string") {
    throw new LocacaoErro("execucao_gravacao", "locacao_execucoes");
  }
  return (data as { id: string }).id;
}

export async function lerExecucao(
  admin: SupabaseClient,
  orgId: string,
  execucaoId: string,
): Promise<LocacaoExecucaoRow | null> {
  const { data } = await tabelaLocacao(admin, "locacao_execucoes")
    .select(COLUNAS)
    .eq("organization_id", orgId)
    .eq("id", execucaoId)
    .maybeSingle();
  return data ? asLinha(data) : null;
}

export async function lerExecucaoEmAndamento(
  admin: SupabaseClient,
  orgId: string,
  processoId: string,
  aba: AbaDaExecucao,
): Promise<LocacaoExecucaoRow | null> {
  const { data } = await tabelaLocacao(admin, "locacao_execucoes")
    .select(COLUNAS)
    .eq("organization_id", orgId)
    .eq("processo_id", processoId)
    .eq("aba", aba)
    .in("estado", [...ESTADOS_EM_ANDAMENTO])
    .maybeSingle();
  return data ? asLinha(data) : null;
}

export async function lerUltimaExecucaoPorAba(
  admin: SupabaseClient,
  orgId: string,
  processoId: string,
  aba: AbaDaExecucao,
): Promise<LocacaoExecucaoRow | null> {
  const { data } = await tabelaLocacao(admin, "locacao_execucoes")
    .select(COLUNAS)
    .eq("organization_id", orgId)
    .eq("processo_id", processoId)
    .eq("aba", aba)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? asLinha(data) : null;
}

export async function lerUltimasExecucoesDoProcesso(
  admin: SupabaseClient,
  orgId: string,
  processoId: string,
): Promise<LocacaoExecucaoRow[]> {
  const { data } = await tabelaLocacao(admin, "locacao_execucoes")
    .select(COLUNAS)
    .eq("organization_id", orgId)
    .eq("processo_id", processoId)
    .order("created_at", { ascending: false });
  const vistas = new Set<string>();
  const saida: LocacaoExecucaoRow[] = [];
  for (const row of data ?? []) {
    const linha = asLinha(row);
    if (vistas.has(linha.aba)) continue;
    vistas.add(linha.aba);
    saida.push(linha);
  }
  return saida;
}

/**
 * Marca execuções concluídas cujo hash da entrada não bate mais.
 * Service role. Sem PII. Não cria linha nova.
 */
export async function marcarDesatualizadasSeEntradaMudou(
  admin: SupabaseClient,
  input: {
    orgId: string;
    processoId: string;
    hashAtual: string;
    abas?: readonly AbaDaExecucao[];
  },
): Promise<void> {
  let q = tabelaLocacao(admin, "locacao_execucoes")
    .update({ estado: "desatualizado" })
    .eq("organization_id", input.orgId)
    .eq("processo_id", input.processoId)
    .eq("estado", "concluido")
    .not("entrada_hash", "is", null)
    .neq("entrada_hash", input.hashAtual);
  if (input.abas && input.abas.length > 0) {
    q = q.in("aba", [...input.abas]);
  }
  const { error } = await q;
  if (error) throw new LocacaoErro("execucao_estado", "locacao_execucoes");
}

export async function atualizarExecucao(
  admin: SupabaseClient,
  input: {
    orgId: string;
    execucaoId: string;
    estado?: EstadoDaExecucao;
    etapaTexto?: string | null;
    progressoAtual?: number;
    progressoTotal?: number;
    erroCodigo?: string | null;
    erroMotivo?: string | null;
    resultado?: Record<string, unknown> | null;
    entradaHash?: string | null;
    callId?: string | null;
  },
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (input.estado !== undefined) patch.estado = input.estado;
  if (input.etapaTexto !== undefined) patch.etapa_texto = input.etapaTexto;
  if (input.progressoAtual !== undefined) patch.progresso_atual = input.progressoAtual;
  if (input.progressoTotal !== undefined) patch.progresso_total = input.progressoTotal;
  if (input.erroCodigo !== undefined) patch.erro_codigo = input.erroCodigo;
  if (input.erroMotivo !== undefined) patch.erro_motivo = input.erroMotivo;
  if (input.resultado !== undefined) patch.resultado = input.resultado;
  if (input.entradaHash !== undefined) patch.entrada_hash = input.entradaHash;
  if (input.callId !== undefined) patch.call_id = input.callId;
  if (input.estado && ESTADOS_TERMINAIS.includes(input.estado)) {
    patch.terminado_em = new Date().toISOString();
  }
  if (Object.keys(patch).length === 0) return;
  const { error } = await tabelaLocacao(admin, "locacao_execucoes")
    .update(patch)
    .eq("organization_id", input.orgId)
    .eq("id", input.execucaoId);
  if (error) throw new LocacaoErro("execucao_estado", "locacao_execucoes");
  if (input.estado === "processando") {
    const { error: stampErr } = await tabelaLocacao(admin, "locacao_execucoes")
      .update({ iniciado_em: new Date().toISOString() })
      .eq("organization_id", input.orgId)
      .eq("id", input.execucaoId)
      .is("iniciado_em", null);
    if (stampErr) throw new LocacaoErro("execucao_estado", "locacao_execucoes");
  }
}

export async function listarExecucoesNaFila(
  admin: SupabaseClient,
  input: { aba: AbaDaExecucao; limite?: number },
): Promise<LocacaoExecucaoRow[]> {
  const { data } = await tabelaLocacao(admin, "locacao_execucoes")
    .select(COLUNAS)
    .eq("aba", input.aba)
    .eq("estado", "na_fila")
    .order("created_at", { ascending: true })
    .limit(input.limite ?? 5);
  return (data ?? []).map(asLinha);
}

export async function listarExecucoesPresas(
  admin: SupabaseClient,
  input: { aba: AbaDaExecucao; minutos?: number; limite?: number },
): Promise<LocacaoExecucaoRow[]> {
  const minutos = input.minutos ?? 10;
  const corte = new Date(Date.now() - minutos * 60_000).toISOString();
  const { data } = await tabelaLocacao(admin, "locacao_execucoes")
    .select(COLUNAS)
    .eq("aba", input.aba)
    .eq("estado", "processando")
    .lt("iniciado_em", corte)
    .order("iniciado_em", { ascending: true })
    .limit(input.limite ?? 5);
  return (data ?? []).map(asLinha);
}

/** na_fila → processando. Devolve null se outra rodada já pegou. */
export async function reivindicarExecucao(
  admin: SupabaseClient,
  input: { orgId: string; execucaoId: string; etapaTexto?: string | null },
): Promise<LocacaoExecucaoRow | null> {
  const { data, error } = await tabelaLocacao(admin, "locacao_execucoes")
    .update({
      estado: "processando",
      etapa_texto: input.etapaTexto ?? "lendo extrato",
    })
    .eq("organization_id", input.orgId)
    .eq("id", input.execucaoId)
    .eq("estado", "na_fila")
    .select(COLUNAS)
    .maybeSingle();
  if (error) throw new LocacaoErro("execucao_estado", "locacao_execucoes");
  if (!data) return null;
  const { error: stampErr } = await tabelaLocacao(admin, "locacao_execucoes")
    .update({ iniciado_em: new Date().toISOString() })
    .eq("organization_id", input.orgId)
    .eq("id", input.execucaoId)
    .is("iniciado_em", null);
  if (stampErr) throw new LocacaoErro("execucao_estado", "locacao_execucoes");
  return asLinha(data);
}

export async function conversaDoProcesso(
  admin: SupabaseClient,
  orgId: string,
  processoId: string,
): Promise<string | null> {
  const { data } = await tabelaLocacao(admin, "locacao_processo_conversas")
    .select("conversation_id")
    .eq("organization_id", orgId)
    .eq("processo_id", processoId)
    .order("ultimo_uso_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  const id = data && typeof (data as { conversation_id?: unknown }).conversation_id === "string"
    ? (data as { conversation_id: string }).conversation_id
    : "";
  return id || null;
}
