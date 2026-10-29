/**
 * Ficha preliminar (A1) — JSON versionado que a análise, a FC, a Migra e o
 * contrato reusam. Mora na conversa; `processo_id` aponta para o processo da
 * Fase 3 quando houver (FK opcional, 0768).
 *
 * Cada valor carrega fonte, trecho e confiança. Os caminhos de campo (nunca os
 * valores) vão para o histórico e para o `audit()`.
 */
import { z } from "zod";

export const FICHA_VERSAO = "preliminar-v1" as const;
export const PAPEIS_DA_FICHA = ["inquilino", "solidario", "fiador", "contato"] as const;
export const RELACOES_DE_CONTATO = ["parente", "corretor", "conjuge", "empresa", "outro"] as const;
export const TIPOS_DE_COMPROVANTE = ["holerite", "ctps", "extrato", "outro"] as const;
export const TIPOS_DE_IMOVEL = ["residencial", "comercial"] as const;
export const TIPOS_DE_GARANTIA = ["caucao", "seguro_fianca", "fiador", "mista", "nenhuma"] as const;
export const ORIGENS_DA_FICHA = ["preliminar_ia", "atendente"] as const;

export type PapelDaFicha = (typeof PAPEIS_DA_FICHA)[number];
export type OrigemDaFicha = (typeof ORIGENS_DA_FICHA)[number];

const texto = z.string().trim().max(180);
const trecho = z.string().max(240);

export const lancamentoDaRendaSchema = z.object({
  descricao: z.string().trim().max(180),
  valor: z.number().finite(),
  data: z.string().max(40).nullable(),
  fonte: z.string().max(16).nullable(),
  trecho: trecho.nullable(),
});

export const evidenciaDaRendaSchema = z.object({
  trecho: trecho,
  fonte: z.string().max(16),
});

/** Bloco que o relatório 4.5 consome. Valores em reais. Ausente = seção pendente. */
export const blocoDeRendaCalculadoSchema = z.object({
  comprovada: z.number().finite().nullable(),
  declarada: z.number().finite().nullable(),
  tabela: z.string().max(16000).nullable(),
  motivo_nao_comprovacao: z.string().max(400).nullable(),
  pacote: z.number().finite().nullable(),
  tres_vezes_pacote: z.number().finite().nullable(),
  abaixo_de_3x: z.boolean().nullable(),
});

export type BlocoDeRendaCalculado = z.infer<typeof blocoDeRendaCalculadoSchema>;

const EXCLUIDA_VAZIA = {
  autotransferencias: [] as z.infer<typeof lancamentoDaRendaSchema>[],
  poupanca: [] as z.infer<typeof lancamentoDaRendaSchema>[],
  rende_facil: [] as z.infer<typeof lancamentoDaRendaSchema>[],
  familiares: [] as z.infer<typeof lancamentoDaRendaSchema>[],
  familiares_provaveis: [] as z.infer<typeof lancamentoDaRendaSchema>[],
  estornos: [] as z.infer<typeof lancamentoDaRendaSchema>[],
  emprestimos: [] as z.infer<typeof lancamentoDaRendaSchema>[],
};

export const campoSchema = z.object({
  valor: texto.nullable(),
  fonte: z.string().max(16).nullable(),
  trecho: trecho.nullable(),
  confianca: z.number().min(0).max(1).nullable(),
  message_id: z.string().uuid().nullable(),
});

export const numeroSchema = z.object({
  valor: z.number().finite().nonnegative().nullable(),
  fonte: z.string().max(16).nullable(),
  trecho: trecho.nullable(),
  confianca: z.number().min(0).max(1).nullable(),
  message_id: z.string().uuid().nullable(),
});

export type CampoFicha = z.infer<typeof campoSchema>;
export type NumeroFicha = z.infer<typeof numeroSchema>;

export const CAMPO_VAZIO: CampoFicha = {
  valor: null, fonte: null, trecho: null, confianca: null, message_id: null,
};
export const NUMERO_VAZIO: NumeroFicha = {
  valor: null, fonte: null, trecho: null, confianca: null, message_id: null,
};

const enderecoSchema = z.object({
  logradouro: campoSchema,
  numero: campoSchema,
  complemento: campoSchema,
  bairro: campoSchema,
  cep: campoSchema,
  cidade: campoSchema,
  uf: campoSchema,
});

export const pessoaSchema = z.object({
  papel: z.enum(PAPEIS_DA_FICHA),
  principal: z.boolean(),
  relacao: z.enum(RELACOES_DE_CONTATO).nullable(),
  nome: campoSchema,
  cpf: campoSchema,
  email: campoSchema,
  celular: campoSchema,
  nascimento: campoSchema,
  rg: campoSchema,
  profissao: campoSchema,
  empregador: campoSchema,
  endereco: enderecoSchema,
  renda_individual: numeroSchema,
});

export type PessoaDaFicha = z.infer<typeof pessoaSchema>;

export const fichaPreliminarSchema = z.object({
  versao: z.literal(FICHA_VERSAO),
  pessoas: z.array(pessoaSchema).max(12),
  renda: z.object({
    mensal: numeroSchema,
    proposta_fc: numeroSchema,
    documentos: z.array(z.object({
      fonte: z.string().max(16),
      tipo: z.enum(TIPOS_DE_COMPROVANTE),
      periodo: z.string().max(40).nullable(),
      resumo: z.string().max(500),
      valor_comprovado: z.number().finite().nonnegative().nullable(),
      message_id: z.string().uuid().nullable(),
    })).max(20),
    alertas: z.array(z.string().max(180)).max(20),
    /**
     * Exclusões do motor `lib/locacao/extrato` (classes do #31).
     * Ausente nas fichas antigas → lista vazia. PIX de terceiros NÃO entra aqui.
     */
    excluida: z.object({
      autotransferencias: z.array(lancamentoDaRendaSchema).max(50).default([]),
      poupanca: z.array(lancamentoDaRendaSchema).max(50).default([]),
      rende_facil: z.array(lancamentoDaRendaSchema).max(50).default([]),
      familiares: z.array(lancamentoDaRendaSchema).max(50).default([]),
      familiares_provaveis: z.array(lancamentoDaRendaSchema).max(50).default([]),
      estornos: z.array(lancamentoDaRendaSchema).max(50).default([]),
      emprestimos: z.array(lancamentoDaRendaSchema).max(50).default([]),
    }).default(EXCLUIDA_VAZIA),
    /** Créditos de terceiros (PIX/TED) — entram na comprovada, listados à parte. */
    pix_terceiros: z.array(lancamentoDaRendaSchema).max(50).default([]),
    vendas_cartao: z.array(lancamentoDaRendaSchema).max(50).default([]),
    evidencias: z.array(evidenciaDaRendaSchema).max(20).default([]),
    bloco_calculado: blocoDeRendaCalculadoSchema.nullable().default(null),
  }),
  imovel: z.object({
    codigo_fc: campoSchema,
    tipo: z.enum(TIPOS_DE_IMOVEL).nullable(),
    logradouro: campoSchema,
    numero: campoSchema,
    complemento: campoSchema,
    bairro: campoSchema,
    cep: campoSchema,
    cidade: campoSchema,
    uf: campoSchema,
    aluguel: numeroSchema,
    iptu: numeroSchema,
    condominio: numeroSchema,
  }),
  garantia: z.object({
    tipo: z.enum(TIPOS_DE_GARANTIA).nullable(),
    caucao_valor: numeroSchema,
    seguradora_preferida: campoSchema,
    apolice: campoSchema,
    valor_mensal: numeroSchema,
  }),
  vigencia: z.object({
    inicio: campoSchema,
    fim: campoSchema,
    prazo_meses: numeroSchema,
    dia_vencimento: numeroSchema,
  }),
  contrato: z.object({
    indice_reajuste: campoSchema,
    split: z.boolean().nullable(),
    isencao_multa_meses: numeroSchema,
    taxa_adm: numeroSchema,
    taxa_locacao: numeroSchema,
    observacao: campoSchema,
    iptu_mensal: numeroSchema,
    seguro_fianca_mensal: numeroSchema,
  }),
  documentos: z.object({
    encontrados: z.array(z.object({
      tipo: z.string().max(80),
      fonte: z.string().max(16).nullable(),
      message_id: z.string().uuid().nullable(),
    })).max(30),
    faltantes: z.array(z.string().max(80)).max(20),
  }),
  pendencias: z.array(z.string().max(180)).max(20),
});

export type FichaPreliminar = z.infer<typeof fichaPreliminarSchema>;

export const saidaDoRelatorioSchema = z.object({
  relatorio: z.string().trim().min(1).max(4000),
  ficha: fichaPreliminarSchema,
});

export type SaidaDoRelatorio = z.infer<typeof saidaDoRelatorioSchema>;

export function enderecoVazio(): z.infer<typeof enderecoSchema> {
  return {
    logradouro: { ...CAMPO_VAZIO }, numero: { ...CAMPO_VAZIO }, complemento: { ...CAMPO_VAZIO },
    bairro: { ...CAMPO_VAZIO }, cep: { ...CAMPO_VAZIO }, cidade: { ...CAMPO_VAZIO }, uf: { ...CAMPO_VAZIO },
  };
}

export function pessoaVazia(papel: PapelDaFicha = "inquilino"): PessoaDaFicha {
  return {
    papel,
    principal: papel === "inquilino",
    relacao: null,
    nome: { ...CAMPO_VAZIO },
    cpf: { ...CAMPO_VAZIO },
    email: { ...CAMPO_VAZIO },
    celular: { ...CAMPO_VAZIO },
    nascimento: { ...CAMPO_VAZIO },
    rg: { ...CAMPO_VAZIO },
    profissao: { ...CAMPO_VAZIO },
    empregador: { ...CAMPO_VAZIO },
    endereco: enderecoVazio(),
    renda_individual: { ...NUMERO_VAZIO },
  };
}

export function fichaVazia(): FichaPreliminar {
  return {
    versao: FICHA_VERSAO,
    pessoas: [pessoaVazia("inquilino")],
    renda: {
      mensal: { ...NUMERO_VAZIO }, proposta_fc: { ...NUMERO_VAZIO }, documentos: [], alertas: [],
      excluida: { ...EXCLUIDA_VAZIA },
      pix_terceiros: [], vendas_cartao: [], evidencias: [], bloco_calculado: null,
    },
    imovel: {
      codigo_fc: { ...CAMPO_VAZIO }, tipo: null,
      logradouro: { ...CAMPO_VAZIO }, numero: { ...CAMPO_VAZIO }, complemento: { ...CAMPO_VAZIO },
      bairro: { ...CAMPO_VAZIO }, cep: { ...CAMPO_VAZIO }, cidade: { ...CAMPO_VAZIO }, uf: { ...CAMPO_VAZIO },
      aluguel: { ...NUMERO_VAZIO }, iptu: { ...NUMERO_VAZIO }, condominio: { ...NUMERO_VAZIO },
    },
    garantia: {
      tipo: null, caucao_valor: { ...NUMERO_VAZIO }, seguradora_preferida: { ...CAMPO_VAZIO },
      apolice: { ...CAMPO_VAZIO }, valor_mensal: { ...NUMERO_VAZIO },
    },
    vigencia: {
      inicio: { ...CAMPO_VAZIO }, fim: { ...CAMPO_VAZIO },
      prazo_meses: { ...NUMERO_VAZIO }, dia_vencimento: { ...NUMERO_VAZIO },
    },
    contrato: {
      indice_reajuste: { ...CAMPO_VAZIO }, split: null, isencao_multa_meses: { ...NUMERO_VAZIO },
      taxa_adm: { ...NUMERO_VAZIO }, taxa_locacao: { ...NUMERO_VAZIO }, observacao: { ...CAMPO_VAZIO },
      iptu_mensal: { ...NUMERO_VAZIO }, seguro_fianca_mensal: { ...NUMERO_VAZIO },
    },
    documentos: { encontrados: [], faltantes: [] },
    pendencias: [],
  };
}

function completarCampo(v: unknown): CampoFicha {
  const o = v && typeof v === "object" ? v as Record<string, unknown> : {};
  const parsed = campoSchema.safeParse({
    valor: typeof o.valor === "string" || o.valor === null ? o.valor : null,
    fonte: typeof o.fonte === "string" || o.fonte === null ? o.fonte : null,
    trecho: typeof o.trecho === "string" || o.trecho === null ? o.trecho : null,
    confianca: typeof o.confianca === "number" ? o.confianca : null,
    message_id: typeof o.message_id === "string" || o.message_id === null ? o.message_id : null,
  });
  return parsed.success ? parsed.data : { ...CAMPO_VAZIO };
}

function completarLancamentos(v: unknown): z.infer<typeof lancamentoDaRendaSchema>[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 50).flatMap((item) => {
    const o = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const parsed = lancamentoDaRendaSchema.safeParse({
      descricao: typeof o.descricao === "string" ? o.descricao : "",
      valor: typeof o.valor === "number" ? o.valor : 0,
      data: typeof o.data === "string" ? o.data : null,
      fonte: typeof o.fonte === "string" ? o.fonte : null,
      trecho: typeof o.trecho === "string" ? o.trecho : null,
    });
    return parsed.success && parsed.data.descricao ? [parsed.data] : [];
  });
}

function completarBlocoCalculado(v: unknown): BlocoDeRendaCalculado | null {
  if (v == null || typeof v !== "object") return null;
  const parsed = blocoDeRendaCalculadoSchema.safeParse(v);
  return parsed.success ? parsed.data : null;
}

function completarEvidencias(v: unknown): z.infer<typeof evidenciaDaRendaSchema>[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 20).flatMap((item) => {
    const o = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const parsed = evidenciaDaRendaSchema.safeParse({
      trecho: typeof o.trecho === "string" ? o.trecho : "",
      fonte: typeof o.fonte === "string" ? o.fonte : "",
    });
    return parsed.success && parsed.data.trecho && parsed.data.fonte ? [parsed.data] : [];
  });
}

function completarNumero(v: unknown): NumeroFicha {
  const o = v && typeof v === "object" ? v as Record<string, unknown> : {};
  const parsed = numeroSchema.safeParse({
    valor: typeof o.valor === "number" || o.valor === null ? o.valor : null,
    fonte: typeof o.fonte === "string" || o.fonte === null ? o.fonte : null,
    trecho: typeof o.trecho === "string" || o.trecho === null ? o.trecho : null,
    confianca: typeof o.confianca === "number" ? o.confianca : null,
    message_id: typeof o.message_id === "string" || o.message_id === null ? o.message_id : null,
  });
  return parsed.success ? parsed.data : { ...NUMERO_VAZIO };
}

function completarEndereco(v: unknown): z.infer<typeof enderecoSchema> {
  const o = v && typeof v === "object" ? v as Record<string, unknown> : {};
  return {
    logradouro: completarCampo(o.logradouro),
    numero: completarCampo(o.numero),
    complemento: completarCampo(o.complemento),
    bairro: completarCampo(o.bairro),
    cep: completarCampo(o.cep),
    cidade: completarCampo(o.cidade),
    uf: completarCampo(o.uf),
  };
}

function completarPessoa(v: unknown): PessoaDaFicha {
  const o = v && typeof v === "object" ? v as Record<string, unknown> : {};
  const papel = PAPEIS_DA_FICHA.includes(o.papel as PapelDaFicha) ? o.papel as PapelDaFicha : "inquilino";
  const relacao = RELACOES_DE_CONTATO.includes(o.relacao as (typeof RELACOES_DE_CONTATO)[number])
    ? o.relacao as (typeof RELACOES_DE_CONTATO)[number] : null;
  return {
    papel,
    principal: o.principal === true,
    relacao,
    nome: completarCampo(o.nome),
    cpf: completarCampo(o.cpf),
    email: completarCampo(o.email),
    celular: completarCampo(o.celular),
    nascimento: completarCampo(o.nascimento),
    rg: completarCampo(o.rg),
    profissao: completarCampo(o.profissao),
    empregador: completarCampo(o.empregador),
    endereco: completarEndereco(o.endereco),
    renda_individual: completarNumero(o.renda_individual),
  };
}

/** Completa o que o modelo omitiu para o schema fechar; não inventa valor. */
export function completarFicha(bruto: unknown): FichaPreliminar {
  const o = bruto && typeof bruto === "object" ? bruto as Record<string, unknown> : {};
  const renda = o.renda && typeof o.renda === "object" ? o.renda as Record<string, unknown> : {};
  const imovel = o.imovel && typeof o.imovel === "object" ? o.imovel as Record<string, unknown> : {};
  const garantia = o.garantia && typeof o.garantia === "object" ? o.garantia as Record<string, unknown> : {};
  const vigencia = o.vigencia && typeof o.vigencia === "object" ? o.vigencia as Record<string, unknown> : {};
  const contrato = o.contrato && typeof o.contrato === "object" ? o.contrato as Record<string, unknown> : {};
  const documentos = o.documentos && typeof o.documentos === "object" ? o.documentos as Record<string, unknown> : {};
  const pessoas = Array.isArray(o.pessoas) && o.pessoas.length > 0
    ? o.pessoas.slice(0, 12).map(completarPessoa)
    : [pessoaVazia("inquilino")];
  const docsRenda = Array.isArray(renda.documentos)
    ? renda.documentos.slice(0, 20).flatMap((d) => {
      const item = d && typeof d === "object" ? d as Record<string, unknown> : {};
      const tipo = TIPOS_DE_COMPROVANTE.includes(item.tipo as (typeof TIPOS_DE_COMPROVANTE)[number])
        ? item.tipo as (typeof TIPOS_DE_COMPROVANTE)[number] : "outro";
      if (typeof item.fonte !== "string") return [];
      return [{
        fonte: item.fonte.slice(0, 16),
        tipo,
        periodo: typeof item.periodo === "string" ? item.periodo.slice(0, 40) : null,
        resumo: typeof item.resumo === "string" ? item.resumo.slice(0, 500) : "",
        valor_comprovado: typeof item.valor_comprovado === "number" ? item.valor_comprovado : null,
        message_id: typeof item.message_id === "string" ? item.message_id : null,
      }];
    })
    : [];
  const encontrados = Array.isArray(documentos.encontrados)
    ? documentos.encontrados.slice(0, 30).flatMap((d) => {
      const item = d && typeof d === "object" ? d as Record<string, unknown> : {};
      if (typeof item.tipo !== "string") return [];
      return [{
        tipo: item.tipo.slice(0, 80),
        fonte: typeof item.fonte === "string" ? item.fonte.slice(0, 16) : null,
        message_id: typeof item.message_id === "string" ? item.message_id : null,
      }];
    })
    : [];
  const rascunho: FichaPreliminar = {
    versao: FICHA_VERSAO,
    pessoas,
    renda: {
      mensal: completarNumero(renda.mensal),
      proposta_fc: completarNumero(renda.proposta_fc),
      documentos: docsRenda,
      alertas: Array.isArray(renda.alertas)
        ? renda.alertas.filter((v): v is string => typeof v === "string").map((v) => v.slice(0, 180)).slice(0, 20)
        : [],
      excluida: (() => {
        const ex = renda.excluida && typeof renda.excluida === "object"
          ? (renda.excluida as Record<string, unknown>) : {};
        return {
          autotransferencias: completarLancamentos(ex.autotransferencias),
          poupanca: completarLancamentos(ex.poupanca),
          rende_facil: completarLancamentos(ex.rende_facil),
          familiares: completarLancamentos(ex.familiares),
          familiares_provaveis: completarLancamentos(ex.familiares_provaveis),
          estornos: completarLancamentos(ex.estornos),
          emprestimos: completarLancamentos(ex.emprestimos),
        };
      })(),
      pix_terceiros: completarLancamentos(renda.pix_terceiros),
      vendas_cartao: completarLancamentos(renda.vendas_cartao),
      evidencias: completarEvidencias(renda.evidencias),
      bloco_calculado: completarBlocoCalculado(renda.bloco_calculado),
    },
    imovel: {
      codigo_fc: completarCampo(imovel.codigo_fc),
      tipo: TIPOS_DE_IMOVEL.includes(imovel.tipo as (typeof TIPOS_DE_IMOVEL)[number])
        ? imovel.tipo as (typeof TIPOS_DE_IMOVEL)[number] : null,
      logradouro: completarCampo(imovel.logradouro),
      numero: completarCampo(imovel.numero),
      complemento: completarCampo(imovel.complemento),
      bairro: completarCampo(imovel.bairro),
      cep: completarCampo(imovel.cep),
      cidade: completarCampo(imovel.cidade),
      uf: completarCampo(imovel.uf),
      aluguel: completarNumero(imovel.aluguel),
      iptu: completarNumero(imovel.iptu),
      condominio: completarNumero(imovel.condominio),
    },
    garantia: {
      tipo: TIPOS_DE_GARANTIA.includes(garantia.tipo as (typeof TIPOS_DE_GARANTIA)[number])
        ? garantia.tipo as (typeof TIPOS_DE_GARANTIA)[number] : null,
      caucao_valor: completarNumero(garantia.caucao_valor),
      seguradora_preferida: completarCampo(garantia.seguradora_preferida),
      apolice: completarCampo(garantia.apolice),
      valor_mensal: completarNumero(garantia.valor_mensal),
    },
    vigencia: {
      inicio: completarCampo(vigencia.inicio),
      fim: completarCampo(vigencia.fim),
      prazo_meses: completarNumero(vigencia.prazo_meses),
      dia_vencimento: completarNumero(vigencia.dia_vencimento),
    },
    contrato: {
      indice_reajuste: completarCampo(contrato.indice_reajuste),
      split: typeof contrato.split === "boolean" ? contrato.split : null,
      isencao_multa_meses: completarNumero(contrato.isencao_multa_meses),
      taxa_adm: completarNumero(contrato.taxa_adm),
      taxa_locacao: completarNumero(contrato.taxa_locacao),
      observacao: completarCampo(contrato.observacao),
      iptu_mensal: completarNumero(contrato.iptu_mensal),
      seguro_fianca_mensal: completarNumero(contrato.seguro_fianca_mensal),
    },
    documentos: {
      encontrados,
      faltantes: Array.isArray(documentos.faltantes)
        ? documentos.faltantes.filter((v): v is string => typeof v === "string").map((v) => v.slice(0, 80)).slice(0, 20)
        : [],
    },
    pendencias: Array.isArray(o.pendencias)
      ? o.pendencias.filter((v): v is string => typeof v === "string").map((v) => v.slice(0, 180)).slice(0, 20)
      : [],
  };
  return fichaPreliminarSchema.parse(rascunho);
}

/** Tira cerca de Markdown e devolve o objeto; sem logar o texto. */
export function extrairJsonDaIa(texto: string): unknown {
  const cercado = texto.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const bruto = (cercado?.[1] ?? texto).trim();
  const ini = bruto.indexOf("{");
  const fim = bruto.lastIndexOf("}");
  if (ini < 0 || fim <= ini) throw new Error("json_ausente");
  return JSON.parse(bruto.slice(ini, fim + 1)) as unknown;
}
