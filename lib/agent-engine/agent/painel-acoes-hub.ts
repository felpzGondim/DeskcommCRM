/** Único contrato entre os botões do painel e as ferramentas anunciadas pelo Hub. */
import type { FerramentaRemota, ResultadoRemoto } from "@/lib/mcp/servidor-externo/chamada";

export const ACOES_HUB = {
  boletos: { rotulo: "Buscar boletos", ferramentas: ["segunda_via_boleto", "buscar_boletos"] },
  contrato: { rotulo: "Consultar contrato e inquilino", ferramentas: ["consultar_contrato_inquilino", "buscar_contrato"] },
  ficha: { rotulo: "Ficha cadastral / pedir documentos", ferramentas: ["buscar_cadastro", "buscar_ficha_cadastral"] },
  analise: { rotulo: "Iniciar análise de inquilino", ferramentas: ["brisa-hub-analise", "brisa_hub_analise", "iniciar_analise_inquilino"] },
} as const;

export type AcaoHub = keyof typeof ACOES_HUB;

export function ferramentaDaAcao(acao: AcaoHub, anunciadas: readonly FerramentaRemota[]): FerramentaRemota | null {
  const nomes: readonly string[] = ACOES_HUB[acao].ferramentas;
  return anunciadas.find((f) => nomes.includes(f.name)) ?? null;
}

export function ferramentaDoInquilino(anunciadas: readonly FerramentaRemota[]): FerramentaRemota | null {
  return anunciadas.find((f) => f.name === "buscar_inquilino") ?? null;
}

/** O Hub deve devolver structuredContent. Texto livre não é exibido para evitar PII acidental. */
export function apresentarResultado(acao: Exclude<AcaoHub, "analise">, resultado: ResultadoRemoto): {
  resumo: string;
  sugestao?: string;
} | null {
  const dados = resultado.dados;
  if (!dados || typeof dados !== "object" || Array.isArray(dados)) return null;
  const d = dados as Record<string, unknown>;
  const curto = (v: unknown) => typeof v === "string" ? v.slice(0, 100) : "";
  const data = (v: unknown) => typeof v === "string" && /^\d{2}\/\d{2}\/\d{4}$|^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
  const situacao = (v: unknown) => typeof v === "string" && /^(em aberto|vencido|pago|ativo|encerrado|pendente)$/i.test(v) ? v : "";
  const valor = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? `R$ ${v.toFixed(2)}` : "";
  if (acao === "boletos") {
    if (!Array.isArray(d.boletos)) return null;
    const lista = Array.isArray(d.boletos) ? d.boletos.slice(0, 10) : [];
    return { resumo: lista.length ? lista.map((v, i) => {
      const b = v && typeof v === "object" ? v as Record<string, unknown> : {};
      return `${i + 1}. ${situacao(b.situacao) || "Em aberto"} · ${data(b.vencimento)} · ${valor(b.valor)}`;
    }).join("\n") : "Nenhum boleto em aberto encontrado." };
  }
  if (acao === "contrato") {
    if (!d.contrato || typeof d.contrato !== "object") return null;
    const c = d.contrato && typeof d.contrato === "object" ? d.contrato as Record<string, unknown> : d;
    return { resumo: [
      `Imóvel: ${curto(c.imovel) || "não informado"}`,
      `Aluguel: ${valor(c.valor) || "não informado"}`,
      `Vencimento: ${data(c.vencimento) || "não informado"}`,
      `Situação: ${situacao(c.situacao) || "não informada"}`,
      `Inquilino: ${situacao(d.inquilino_situacao) || "vinculado ao telefone da conversa"}`,
    ].join("\n") };
  }
  if (!Array.isArray(d.documentos_faltantes)) return null;
  const faltantes = Array.isArray(d.documentos_faltantes)
    ? d.documentos_faltantes.filter((v): v is string => typeof v === "string").slice(0, 15)
    : [];
  const tipos = faltantes.map((v) => {
    const normal = v.toLowerCase();
    if (/comprovante de renda/.test(normal)) return "comprovante de renda";
    if (/comprovante de resid/.test(normal)) return "comprovante de residência";
    if (/documento de identidade|\brg\b/.test(normal)) return "documento de identidade";
    if (/\bcpf\b/.test(normal)) return "CPF";
    if (/extrato banc/.test(normal)) return "extrato bancário";
    return "";
  }).filter(Boolean);
  return {
    resumo: tipos.length ? `Documentos pendentes: ${tipos.join(", ")}.` : "Nenhum documento pendente informado pelo Hub.",
    ...(tipos.length ? { sugestao: `Olá! Para dar continuidade ao seu cadastro, por favor envie: ${tipos.join(", ")}. Obrigado!` } : {}),
  };
}
