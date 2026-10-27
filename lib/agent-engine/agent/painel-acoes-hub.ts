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

/** Ferramenta conhecida do Hub, descrita como leitura mesmo se a annotation faltar. */
export function leituraPermitida(acao: Exclude<AcaoHub, "analise">, ferramenta: FerramentaRemota): boolean {
  return ferramenta.somenteLeitura === true || (acao === "boletos" && ferramenta.name === "segunda_via_boleto");
}

/** Usa apenas a resposta recente do próprio cliente; nunca extrai CPF completo. */
export function tresDigitosDoCliente(body: unknown, sentAt: unknown, agora = Date.now()): string | null {
  if (typeof body !== "string" || !/^\s*[0-9]{3}\s*$/.test(body)) return null;
  const enviadoEm = typeof sentAt === "string" ? Date.parse(sentAt) : NaN;
  if (!Number.isFinite(enviadoEm) || enviadoEm > agora || agora - enviadoEm > 30 * 60_000) return null;
  return body.trim();
}

/** Retrato efêmero da conversa para o Hub; não inclui URL, storage path ou IDs de anexos. */
export function montarFichaTemporaria(linhas: readonly Record<string, unknown>[]): {
  anexos: Array<{ nome: string; mime: string; legenda: string }>;
} {
  const anexos: Array<{ nome: string; mime: string; legenda: string }> = [];
  for (const linha of linhas.slice(0, 60)) {
    if (linha.revoked_at) continue;
    const texto = typeof linha.body === "string" ? linha.body.trim().slice(0, 500) : "";
    const tipo = typeof linha.type === "string" ? linha.type : "";
    if (["document", "image"].includes(tipo)) {
      const meta = linha.metadata && typeof linha.metadata === "object" ? linha.metadata as Record<string, unknown> : {};
      anexos.push({
        nome: typeof meta.media_filename === "string" ? meta.media_filename.slice(0, 120) : "",
        mime: typeof linha.media_mime === "string" ? linha.media_mime.slice(0, 80) : "",
        legenda: texto,
      });
    }
  }
  return { anexos: anexos.slice(0, 30) };
}

/** O Hub deve devolver structuredContent. Texto livre não é exibido para evitar PII acidental. */
export function apresentarResultado(acao: Exclude<AcaoHub, "analise">, resultado: ResultadoRemoto): {
  resumo: string;
  sugestao?: string;
  links?: Array<{ rotulo: string; url: string }>;
} | null {
  // Alguns servidores MCP devolvem o objeto em structuredContent; outros o
  // serializam num bloco text. Só aceitamos JSON e selecionamos campos abaixo.
  let dados = resultado.dados;
  if (dados === undefined && resultado.texto.trim().startsWith("{")) {
    try { dados = JSON.parse(resultado.texto); } catch { return null; }
  }
  if (!dados || typeof dados !== "object" || Array.isArray(dados)) return null;
  const d = dados as Record<string, unknown>;
  const curto = (v: unknown) => typeof v === "string" ? v.slice(0, 100) : "";
  const data = (v: unknown) => typeof v === "string" && /^\d{2}\/\d{2}\/\d{4}$|^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
  const situacao = (v: unknown) => typeof v === "string" && /^(em aberto|a vencer|vencido|pago|ativo|encerrado|pendente)$/i.test(v) ? v : "";
  const valor = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) return `R$ ${v.toFixed(2)}`;
    return typeof v === "string" && /^R\$ \d{1,3}(?:\.\d{3})*,\d{2}$/.test(v) ? v : "";
  };
  if (acao === "boletos") {
    if (d.resultado === "precisa_cpf") return {
      resumo: "Para consultar boletos, o cliente precisa informar os três primeiros dígitos do CPF do titular. O atendente não digita CPF neste painel.",
      sugestao: "Para localizar sua 2ª via, por favor informe somente os três primeiros dígitos do CPF do titular do contrato. Não envie o CPF completo.",
    };
    if (d.resultado === "sem_boletos") return { resumo: "Nenhum boleto em aberto encontrado para esta conversa." };
    if (d.resultado === "nao_encontrado") return { resumo: "O telefone desta conversa não foi encontrado em um contrato ativo no Brisa Hub." };
    if (d.resultado === "bloqueado" || d.resultado === "limite_consultas") return {
      resumo: "A consulta automática de boletos está temporariamente bloqueada no Brisa Hub. Encaminhe o caso à equipe responsável.",
    };
    if (d.resultado !== undefined && d.resultado !== "ok") return {
      resumo: "O Brisa Hub não conseguiu consultar boletos agora. Encaminhe o caso à equipe responsável.",
    };
    if (!Array.isArray(d.boletos)) return null;
    const lista = Array.isArray(d.boletos) ? d.boletos.slice(0, 10) : [];
    const links: Array<{ rotulo: string; url: string }> = [];
    const resumo = lista.length ? lista.map((v, i) => {
      const b = v && typeof v === "object" ? v as Record<string, unknown> : {};
      if (typeof b.link === "string") {
        try {
          const url = new URL(b.link);
          if (url.protocol === "https:" && !url.username && !url.password) {
            links.push({ rotulo: `Abrir 2ª via do boleto ${i + 1}`, url: url.href });
          }
        } catch { /* link inválido: não aparece */ }
      }
      return `${i + 1}. ${situacao(b.situacao) || "Em aberto"} · ${data(b.vencimento)} · ${valor(b.valor)}`;
    }).join("\n") : "Nenhum boleto em aberto encontrado.";
    return { resumo, links };
  }
  if (acao === "contrato") {
    if (d.resultado === "nao_encontrado") return { resumo: "Nenhum contrato ativo vinculado ao telefone desta conversa foi encontrado no Brisa Hub." };
    if (d.resultado === "multiplos_contratos") return { resumo: "Há mais de um contrato vinculado a este telefone. Confira o cadastro no Brisa Hub antes de prosseguir." };
    if (d.resultado === "indisponivel") return { resumo: "A consulta ao contrato está indisponível no Brisa Hub. Tente novamente." };
    if (!d.contrato || typeof d.contrato !== "object") return null;
    const c = d.contrato && typeof d.contrato === "object" ? d.contrato as Record<string, unknown> : d;
    const dia = typeof c.dia_vencimento === "string" && /^(?:[1-9]|[12][0-9]|3[01])$/.test(c.dia_vencimento) ? `dia ${c.dia_vencimento}` : "";
    return { resumo: [
      `Imóvel: ${curto(c.imovel) || "não informado"}`,
      `Aluguel: ${valor(c.valor) || "não informado"}`,
      `Vencimento: ${dia || data(c.vencimento) || "não informado"}`,
      `Situação: ${situacao(c.situacao) || "não informada"}`,
      `Inquilino: ${situacao(d.inquilino_situacao) || "vinculado ao telefone da conversa"}`,
    ].join("\n") };
  }
  if (d.resultado !== undefined && d.resultado !== "ok") return null;
  if (!Array.isArray(d.documentos_faltantes)) return null;
  const faltantes = Array.isArray(d.documentos_faltantes)
    ? d.documentos_faltantes.filter((v): v is string => typeof v === "string").slice(0, 15)
    : [];
  const tipos = faltantes.map((v) => {
    const normal = v.toLowerCase();
    if (/comprovante de renda/.test(normal)) return "comprovante de renda (holerite, CTPS ou extrato bancário)";
    if (/documento de identidade|\brg\b/.test(normal)) return "documento de identidade";
    return "";
  }).filter(Boolean);
  return {
    resumo: tipos.length ? `Documentos não identificados nos anexos recentes: ${tipos.join(", ")}. Confira a ficha antes de enviar o pedido.` : "Os documentos exigidos foram identificados pelos nomes ou legendas dos anexos. Confira os arquivos antes de prosseguir.",
    ...(tipos.length ? { sugestao: `Olá! Para dar continuidade ao seu cadastro, por favor envie: ${tipos.join(", ")}. Obrigado!` } : {}),
  };
}
