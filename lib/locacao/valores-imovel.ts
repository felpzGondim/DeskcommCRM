/**
 * Valores mensais do imóvel no processo (reais). Snapshot por processo.
 * 3× = aluguel + condomínio (inclui rateio) + IPTU + seguro-incêndio.
 * Seguro-fiança é informativo: não entra no 3× e não bloqueia FC/Migra.
 * Sem I/O. Sem dado pessoal.
 */
import type { FichaPreliminar } from "@/lib/locacao/ficha-schema";
import { ORIGENS_DO_VALOR_DO_IMOVEL } from "@/lib/locacao/vocabulario";
import { lerSeguroIncendioNoTexto } from "@/lib/locacao/extrato/pacote";

export { ORIGENS_DO_VALOR_DO_IMOVEL };
export type OrigemDoValorDoImovel = (typeof ORIGENS_DO_VALOR_DO_IMOVEL)[number];

export const CAMPOS_DO_VALOR_DO_IMOVEL = [
  "aluguel",
  "condominio",
  "iptu",
  "seguro_incendio",
  "seguro_fianca",
] as const;
export type CampoDoValorDoImovel = (typeof CAMPOS_DO_VALOR_DO_IMOVEL)[number];

/** Os quatro do pacote / 3×. Seguro-fiança fica de fora. */
export const CAMPOS_OBRIGATORIOS_DO_PACOTE = [
  "aluguel",
  "condominio",
  "iptu",
  "seguro_incendio",
] as const;
export type CampoObrigatorioDoPacote = (typeof CAMPOS_OBRIGATORIOS_DO_PACOTE)[number];

export const COLUNAS_SQL_VALORES_DO_IMOVEL = CAMPOS_DO_VALOR_DO_IMOVEL
  .flatMap((c) => [c, `${c}_origem`, `${c}_editado_por`, `${c}_editado_em`])
  .join(",");

export type ValorDoImovel = {
  valor: number | null;
  origem: OrigemDoValorDoImovel | null;
  editado_por: string | null;
  editado_em: string | null;
};

export type ValoresDoImovel = Record<CampoDoValorDoImovel, ValorDoImovel>;

export type FonteNumerica = Partial<Record<CampoDoValorDoImovel, number | null>>;

const ROTULO_CAMPO: Record<CampoDoValorDoImovel, string> = {
  aluguel: "aluguel",
  condominio: "condomínio (inclui rateio)",
  iptu: "IPTU",
  seguro_incendio: "seguro-incêndio",
  seguro_fianca: "seguro-fiança",
};

const ROTULO_ORIGEM: Record<OrigemDoValorDoImovel, string> = {
  superlogica: "Superlógica",
  conversa: "conversa/ficha",
  manual: "editado",
};

function prioridade(origem: OrigemDoValorDoImovel | null): number {
  if (origem === "manual") return 3;
  if (origem === "superlogica") return 2;
  if (origem === "conversa") return 1;
  return 0;
}

export function rotuloDoCampoDoImovel(campo: CampoDoValorDoImovel): string {
  return ROTULO_CAMPO[campo];
}

export function rotuloDaOrigemDoValor(origem: OrigemDoValorDoImovel | null): string {
  if (!origem) return "ausente";
  return ROTULO_ORIGEM[origem];
}

export function parseNumeroReais(bruto: unknown): number | null {
  if (typeof bruto === "number" && Number.isFinite(bruto) && bruto >= 0) {
    return Math.round(bruto * 100) / 100;
  }
  if (typeof bruto === "string" && bruto.trim()) {
    const n = Number(bruto.replace(",", "."));
    if (Number.isFinite(n) && n >= 0) return Math.round(n * 100) / 100;
  }
  return null;
}

export function parseOrigemDoValor(bruto: unknown): OrigemDoValorDoImovel | null {
  if (typeof bruto !== "string") return null;
  return (ORIGENS_DO_VALOR_DO_IMOVEL as readonly string[]).includes(bruto)
    ? (bruto as OrigemDoValorDoImovel)
    : null;
}

export function valorVazio(): ValorDoImovel {
  return { valor: null, origem: null, editado_por: null, editado_em: null };
}

export function valoresVazios(): ValoresDoImovel {
  return {
    aluguel: valorVazio(),
    condominio: valorVazio(),
    iptu: valorVazio(),
    seguro_incendio: valorVazio(),
    seguro_fianca: valorVazio(),
  };
}

export function lerValoresDaLinha(row: Record<string, unknown> | null | undefined): ValoresDoImovel {
  const r = row ?? {};
  const saida = valoresVazios();
  for (const campo of CAMPOS_DO_VALOR_DO_IMOVEL) {
    const valor = parseNumeroReais(r[campo]);
    const origem = parseOrigemDoValor(r[`${campo}_origem`]);
    saida[campo] = {
      valor,
      origem: valor == null ? null : origem,
      editado_por: typeof r[`${campo}_editado_por`] === "string"
        ? String(r[`${campo}_editado_por`])
        : null,
      editado_em: typeof r[`${campo}_editado_em`] === "string"
        ? String(r[`${campo}_editado_em`])
        : null,
    };
  }
  return saida;
}

export function centavosParaReais(centavos: number | null | undefined): number | null {
  if (centavos == null || !Number.isFinite(centavos)) return null;
  return Math.round(centavos) / 100;
}

function numeroDaFicha(campo: { valor: number | null } | null | undefined): number | null {
  return parseNumeroReais(campo?.valor);
}

/** Conversa/ficha/relatório preliminar. Seguro-incêndio pode vir só do texto. */
export function extrairValoresDaConversa(input: {
  ficha?: FichaPreliminar | null;
  relatorio?: string | null;
}): FonteNumerica {
  const ficha = input.ficha;
  const incendioTexto = input.relatorio ? lerSeguroIncendioNoTexto(input.relatorio) : null;
  return {
    aluguel: numeroDaFicha(ficha?.imovel.aluguel),
    condominio: numeroDaFicha(ficha?.imovel.condominio),
    iptu: numeroDaFicha(ficha?.imovel.iptu) ?? numeroDaFicha(ficha?.contrato.iptu_mensal),
    seguro_incendio: centavosParaReais(incendioTexto),
    seguro_fianca:
      numeroDaFicha(ficha?.garantia.valor_mensal)
      ?? numeroDaFicha(ficha?.contrato.seguro_fianca_mensal),
  };
}

/**
 * Manual vence. Superlógica vence conversa. Pré-preenchimento posterior
 * nunca sobrescreve origem manual.
 */
export function preencherValores(input: {
  atuais: ValoresDoImovel;
  superlogica?: FonteNumerica | null;
  conversa?: FonteNumerica | null;
  agora?: string;
}): { valores: ValoresDoImovel; campos: CampoDoValorDoImovel[] } {
  const agora = input.agora ?? new Date().toISOString();
  const saida: ValoresDoImovel = {
    aluguel: { ...input.atuais.aluguel },
    condominio: { ...input.atuais.condominio },
    iptu: { ...input.atuais.iptu },
    seguro_incendio: { ...input.atuais.seguro_incendio },
    seguro_fianca: { ...input.atuais.seguro_fianca },
  };
  const campos: CampoDoValorDoImovel[] = [];
  for (const campo of CAMPOS_DO_VALOR_DO_IMOVEL) {
    const atual = saida[campo];
    const candidatos: Array<{ valor: number; origem: OrigemDoValorDoImovel }> = [];
    const sl = parseNumeroReais(input.superlogica?.[campo]);
    if (sl != null) candidatos.push({ valor: sl, origem: "superlogica" });
    const cv = parseNumeroReais(input.conversa?.[campo]);
    if (cv != null) candidatos.push({ valor: cv, origem: "conversa" });
    let melhor: { valor: number; origem: OrigemDoValorDoImovel } | null = null;
    for (const c of candidatos) {
      if (!melhor || prioridade(c.origem) > prioridade(melhor.origem)) melhor = c;
    }
    if (!melhor) continue;
    if (prioridade(melhor.origem) <= prioridade(atual.origem)) continue;
    saida[campo] = {
      valor: melhor.valor,
      origem: melhor.origem,
      editado_por: null,
      editado_em: agora,
    };
    campos.push(campo);
  }
  return { valores: saida, campos };
}

export function aplicarEdicaoManual(
  atuais: ValoresDoImovel,
  patch: Partial<Record<CampoDoValorDoImovel, number>>,
  quem: string,
  agora?: string,
): { valores: ValoresDoImovel; campos: CampoDoValorDoImovel[] } {
  const quando = agora ?? new Date().toISOString();
  const saida: ValoresDoImovel = {
    aluguel: { ...atuais.aluguel },
    condominio: { ...atuais.condominio },
    iptu: { ...atuais.iptu },
    seguro_incendio: { ...atuais.seguro_incendio },
    seguro_fianca: { ...atuais.seguro_fianca },
  };
  const campos: CampoDoValorDoImovel[] = [];
  for (const campo of CAMPOS_DO_VALOR_DO_IMOVEL) {
    const n = parseNumeroReais(patch[campo]);
    if (n == null) continue;
    saida[campo] = {
      valor: n,
      origem: "manual",
      editado_por: quem,
      editado_em: quando,
    };
    campos.push(campo);
  }
  return { valores: saida, campos };
}

export function patchSqlDosValores(
  valores: ValoresDoImovel,
  campos: readonly CampoDoValorDoImovel[],
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const campo of campos) {
    const v = valores[campo];
    patch[campo] = v.valor;
    patch[`${campo}_origem`] = v.origem;
    patch[`${campo}_editado_por`] = v.editado_por;
    patch[`${campo}_editado_em`] = v.editado_em;
  }
  return patch;
}

export type ContextoDeRecusaDeValores = "fc" | "seguro";

export function exigirObrigatorios(
  valores: ValoresDoImovel,
  contexto: ContextoDeRecusaDeValores,
): string | null {
  const acao = contexto === "fc"
    ? "antes de analisar a FC"
    : "antes de cotar o seguro";
  for (const campo of CAMPOS_OBRIGATORIOS_DO_PACOTE) {
    if (valores[campo].valor == null) {
      return `Informe o ${ROTULO_CAMPO[campo]} no processo ${acao}.`;
    }
  }
  return null;
}

export type Pacote3x =
  | { ok: true; total: number; vezes3: number }
  | { ok: false; faltantes: CampoObrigatorioDoPacote[] };

/** 3× só fecha com os quatro. Seguro-fiança não entra, mesmo preenchido. */
export function pacote3x(valores: ValoresDoImovel): Pacote3x {
  const faltantes = CAMPOS_OBRIGATORIOS_DO_PACOTE.filter((c) => valores[c].valor == null);
  if (faltantes.length > 0) return { ok: false, faltantes };
  const total =
    valores.aluguel.valor!
    + valores.condominio.valor!
    + valores.iptu.valor!
    + valores.seguro_incendio.valor!;
  return { ok: true, total: Math.round(total * 100) / 100, vezes3: Math.round(total * 3 * 100) / 100 };
}

export function valoresParaJson(valores: ValoresDoImovel): Record<string, {
  valor: number | null;
  origem: OrigemDoValorDoImovel | null;
  editado_em: string | null;
}> {
  const saida: Record<string, {
    valor: number | null;
    origem: OrigemDoValorDoImovel | null;
    editado_em: string | null;
  }> = {};
  for (const campo of CAMPOS_DO_VALOR_DO_IMOVEL) {
    saida[campo] = {
      valor: valores[campo].valor,
      origem: valores[campo].origem,
      editado_em: valores[campo].editado_em,
    };
  }
  return saida;
}
