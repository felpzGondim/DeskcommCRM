/**
 * Leitura, pré-preenchimento e gravação dos valores do imóvel no processo.
 * Service role + organization_id da sessão. Superlógica só GET, injetável;
 * chave desligada = pula essa fonte. Evento sem valores (só nomes de campo).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { tabelaLocacao } from "@/lib/locacao/admin";
import { pacoteSuperlogicaLigado } from "@/lib/locacao/chaves";
import {
  leitorSuperlogicaDesligado,
  type LeitorDePacoteSuperlogica,
} from "@/lib/locacao/extrato/pacote";
import { completarFicha } from "@/lib/locacao/ficha-schema";
import { lerFichaAtual } from "@/lib/locacao/ficha-repositorio";
import {
  gravarEvento,
  lerFichaAtualDoProcesso,
  lerProcesso,
  listarParticipantes,
  LocacaoErro,
} from "@/lib/locacao/repositorio";
import {
  aplicarEdicaoManual,
  centavosParaReais,
  extrairValoresDaConversa,
  lerValoresDaLinha,
  patchSqlDosValores,
  preencherValores,
  valoresVazios,
  type CampoDoValorDoImovel,
  type FonteNumerica,
  type ValoresDoImovel,
} from "@/lib/locacao/valores-imovel";

function asRec(row: unknown): Record<string, unknown> {
  return (row ?? {}) as Record<string, unknown>;
}

async function gravarPatch(
  admin: SupabaseClient,
  input: {
    orgId: string;
    processoId: string;
    valores: ValoresDoImovel;
    campos: readonly CampoDoValorDoImovel[];
    atorTipo: "usuario" | "sistema";
    atorId: string | null;
  },
): Promise<void> {
  if (input.campos.length === 0) return;
  const { error } = await tabelaLocacao(admin, "locacao_processos")
    .update(patchSqlDosValores(input.valores, input.campos))
    .eq("organization_id", input.orgId)
    .eq("id", input.processoId);
  if (error) throw new LocacaoErro("valores_imovel_gravacao", "valores");
  await gravarEvento(admin, {
    orgId: input.orgId,
    processoId: input.processoId,
    tipo: "valores_imovel",
    atorTipo: input.atorTipo,
    atorId: input.atorId,
    detalhe: { campos: [...input.campos] },
  });
}

async function fonteSuperlogica(
  admin: SupabaseClient,
  input: {
    orgId: string;
    processoId: string;
    imovelId: string;
    settings: unknown;
    leitor?: LeitorDePacoteSuperlogica;
  },
): Promise<FonteNumerica | null> {
  if (!pacoteSuperlogicaLigado(input.settings)) return null;
  let slImovel: unknown = null;
  if (input.imovelId) {
    const { data: imovel } = await tabelaLocacao(admin, "locacao_imoveis")
      .select("id,superlogica_imovel_id")
      .eq("organization_id", input.orgId)
      .eq("id", input.imovelId)
      .maybeSingle();
    slImovel = imovel ? asRec(imovel).superlogica_imovel_id : null;
  }
  const participantes = await listarParticipantes(admin, input.orgId, input.processoId);
  const locatario = participantes.find((p) => p.papel === "locatario" && p.principal)
    ?? participantes.find((p) => p.papel === "locatario")
    ?? participantes.find((p) => p.interlocutor_principal);
  const contactId = typeof locatario?.contact_id === "string" ? locatario.contact_id : null;
  let temVinculo = slImovel != null && String(slImovel).trim() !== "";
  if (!temVinculo && contactId) {
    const { data: vinculo } = await tabelaLocacao(admin, "contato_superlogica_vinculos")
      .select("id")
      .eq("organization_id", input.orgId)
      .eq("contact_id", contactId)
      .eq("ativo", true)
      .limit(1)
      .maybeSingle();
    temVinculo = !!vinculo;
  }
  if (!temVinculo && contactId) {
    const { data: contato } = await admin.from("contacts")
      .select("custom_fields")
      .eq("organization_id", input.orgId)
      .eq("id", contactId)
      .maybeSingle();
    const cf = contato && typeof contato.custom_fields === "object" && contato.custom_fields
      ? contato.custom_fields as Record<string, unknown>
      : {};
    temVinculo = Object.keys(cf).some((k) => k.startsWith("superlogica_"));
  }
  if (!temVinculo) return null;
  const leitor = input.leitor ?? leitorSuperlogicaDesligado();
  const bruto = await leitor.ler({
    orgId: input.orgId,
    contactId: contactId ?? "",
    superlogicaImovelId: typeof slImovel === "number" ? slImovel : Number(slImovel) || null,
  });
  if (!bruto) return null;
  return {
    aluguel: centavosParaReais(bruto.aluguelCentavos),
    condominio: centavosParaReais(bruto.condominioCentavos),
    iptu: centavosParaReais(bruto.iptuCentavos),
    seguro_incendio: centavosParaReais(bruto.seguroIncendioCentavos),
  };
}

async function fonteConversa(
  admin: SupabaseClient,
  orgId: string,
  processoId: string,
): Promise<FonteNumerica> {
  const atual = await lerFichaAtualDoProcesso(admin, orgId, processoId);
  if (atual?.ficha) {
    return extrairValoresDaConversa({ ficha: completarFicha(atual.ficha) });
  }
  const { data: ligacoes } = await tabelaLocacao(admin, "locacao_processo_conversas")
    .select("conversation_id,ultimo_uso_em")
    .eq("organization_id", orgId)
    .eq("processo_id", processoId)
    .order("ultimo_uso_em", { ascending: false })
    .limit(1);
  const convId = ligacoes?.[0] ? String(asRec(ligacoes[0]).conversation_id ?? "") : "";
  if (!convId) return {};
  const linha = await lerFichaAtual(admin, orgId, convId);
  if (!linha) return {};
  return extrairValoresDaConversa({ ficha: linha.ficha, relatorio: linha.relatorio });
}

export async function garantirValoresDoProcesso(
  admin: SupabaseClient,
  input: {
    orgId: string;
    processoId: string;
    settings: unknown;
    leitor?: LeitorDePacoteSuperlogica;
  },
): Promise<ValoresDoImovel> {
  const proc = await lerProcesso(admin, input.orgId, input.processoId);
  if (!proc) return valoresVazios();
  const atuais = lerValoresDaLinha(proc);
  const superlogica = await fonteSuperlogica(admin, {
    orgId: input.orgId,
    processoId: input.processoId,
    imovelId: String(proc.imovel_id ?? ""),
    settings: input.settings,
    leitor: input.leitor,
  });
  const conversa = await fonteConversa(admin, input.orgId, input.processoId);
  const { valores, campos } = preencherValores({ atuais, superlogica, conversa });
  await gravarPatch(admin, {
    orgId: input.orgId,
    processoId: input.processoId,
    valores,
    campos,
    atorTipo: "sistema",
    atorId: null,
  });
  return valores;
}

export async function editarValoresDoProcesso(
  admin: SupabaseClient,
  input: {
    orgId: string;
    processoId: string;
    userId: string;
    patch: Partial<Record<CampoDoValorDoImovel, number>>;
  },
): Promise<ValoresDoImovel> {
  const proc = await lerProcesso(admin, input.orgId, input.processoId);
  if (!proc) throw new LocacaoErro("processo_nao_encontrado", "processo");
  const atuais = lerValoresDaLinha(proc);
  const { valores, campos } = aplicarEdicaoManual(atuais, input.patch, input.userId);
  if (campos.length === 0) return atuais;
  await gravarPatch(admin, {
    orgId: input.orgId,
    processoId: input.processoId,
    valores,
    campos,
    atorTipo: "usuario",
    atorId: input.userId,
  });
  return valores;
}
