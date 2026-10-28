/**
 * Mapeamento puro da cotação de seguro-fiança (PR 4.2).
 * Sem I/O. Sem Contratar. Sem passo pago. O CRM monta o payload; o Hub cotiza.
 *
 * O contrato de `status_analise_inquilino` (score/risco opcionais) mora em
 * `status-hub.ts` — a 4.3 reusa. Aqui só se descarta: tela e jsonb da cotação
 * não exibem score nem risco.
 */
import { codigoFc } from "@/lib/locacao/endereco";
import { inquilinoPrincipalDaFicha } from "@/lib/locacao/ficha-telefone";
import type { FichaPreliminar } from "@/lib/locacao/ficha-schema";
import type { StatusAnaliseInquilino } from "@/lib/locacao/analise/status-hub";
import type { EstadoDaAnaliseSeguro } from "@/lib/locacao/vocabulario";

export { lerStatusDoHub, type StatusAnaliseInquilino } from "@/lib/locacao/analise/status-hub";

export const TETO_PRINT_BYTES = 2 * 1024 * 1024;
export const MIME_PRINT_PADRAO = "image/png";
export const TIPOS_BAIXAR_ANALISE = ["print_migra", "laudo"] as const;
export type TipoBaixarAnalise = (typeof TIPOS_BAIXAR_ANALISE)[number];

const CHAVES_B64 = ["arquivo_b64", "bytes_b64", "conteudo_b64", "print_b64"] as const;
const MIME_PRINT = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);

const CHAVES_PROIBIDAS_NO_CARD = new Set([
  "score",
  "risco",
  "cpf",
  "email",
  "telefone",
  "phone",
  "celular",
  "nome",
  "name",
  "cpf_hash",
]);

export type ArgumentosIniciarSeguro = {
  pedido_id: string;
  conversa_id: string;
  organization_id: string;
  candidato: { nome: string; cpf: string; email: string; telefone: string };
  imovel: { codigo_fc: string; logradouro: string; apartamento: string; aluguel: number };
  renda: { mensal: number };
};

export type FalhaDoPayloadSeguro = { ok: false; motivo: string };
export type PayloadSeguroOk = { ok: true; argumentos: ArgumentosIniciarSeguro };

const MAPA_ESTADO_HUB: Record<string, EstadoDaAnaliseSeguro> = {
  solicitada: "solicitada",
  cotando: "cotando",
  migra_cotando: "cotando",
  recebido: "cotando",
  renda_preliminar: "cotando",
  aguardando_renda: "cotando",
  dados_para_confirmar: "cotando",
  aguardando_confirmacao: "cotando",
  fc_salvo_pendente: "cotando",
  aguardando_cobranca_fc: "cotando",
  fc_processado: "cotando",
  concluido: "concluida",
  concluida: "concluida",
  erro: "erro",
  login_necessario: "login_necessario",
  cancelada: "cancelada",
  cancelado: "cancelada",
};

export function mapearEstadoHub(bruto: unknown): EstadoDaAnaliseSeguro {
  if (typeof bruto !== "string") return "cotando";
  return MAPA_ESTADO_HUB[bruto.trim().toLowerCase()] ?? "cotando";
}

function soDigitosCpf(bruto: string): string | null {
  const d = bruto.replace(/\D/g, "");
  return d.length === 11 ? d : null;
}

function emailValido(bruto: string): string | null {
  const s = bruto.trim();
  if (s.length < 5 || s.length > 180) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return null;
  return s;
}

export function pendenciaDoPayloadSeguro(
  ficha: FichaPreliminar,
  telefone: string | null,
): string | null {
  if (!telefone) {
    return "Informe o celular do inquilino principal na ficha antes de cotar o seguro.";
  }
  const pessoa = inquilinoPrincipalDaFicha(ficha);
  if (!pessoa?.nome.valor?.trim()) {
    return "Informe o nome do inquilino principal na ficha antes de cotar o seguro.";
  }
  if (!soDigitosCpf(pessoa.cpf.valor ?? "")) {
    return "Informe o CPF do inquilino principal na ficha antes de cotar o seguro.";
  }
  if (!emailValido(pessoa.email.valor ?? "")) {
    return "Informe o e-mail do inquilino principal na ficha antes de cotar o seguro.";
  }
  const imovel = ficha.imovel;
  const logradouro = imovel.logradouro.valor?.trim() ?? "";
  const codigo =
    imovel.codigo_fc.valor?.trim()
    || codigoFc({
      logradouro,
      numero: imovel.numero.valor,
      complemento: imovel.complemento.valor,
    });
  if (!codigo || !logradouro || typeof imovel.aluguel.valor !== "number") {
    return "Informe o imóvel (endereço e aluguel) na ficha antes de cotar o seguro.";
  }
  const renda = ficha.renda.proposta_fc.valor ?? ficha.renda.mensal.valor;
  if (typeof renda !== "number") {
    return "Confirme a renda antes de analisar o seguro-fiança ou a FC.";
  }
  return null;
}

export function montarArgumentosSeguro(input: {
  ficha: FichaPreliminar;
  pedidoId: string;
  conversaId: string;
  orgId: string;
  telefone: string;
}): PayloadSeguroOk | FalhaDoPayloadSeguro {
  const motivo = pendenciaDoPayloadSeguro(input.ficha, input.telefone);
  if (motivo) return { ok: false, motivo };
  const pessoa = inquilinoPrincipalDaFicha(input.ficha)!;
  const imovel = input.ficha.imovel;
  const logradouro = imovel.logradouro.valor!.trim();
  const codigo =
    imovel.codigo_fc.valor?.trim()
    || codigoFc({
      logradouro,
      numero: imovel.numero.valor,
      complemento: imovel.complemento.valor,
    });
  const apartamento = imovel.complemento.valor?.trim() || imovel.numero.valor?.trim() || "";
  const renda = (input.ficha.renda.proposta_fc.valor ?? input.ficha.renda.mensal.valor)!;
  return {
    ok: true,
    argumentos: {
      pedido_id: input.pedidoId,
      conversa_id: input.conversaId,
      organization_id: input.orgId,
      candidato: {
        nome: pessoa.nome.valor!.trim(),
        cpf: soDigitosCpf(pessoa.cpf.valor ?? "")!,
        email: emailValido(pessoa.email.valor ?? "")!,
        telefone: input.telefone,
      },
      imovel: {
        codigo_fc: codigo,
        logradouro,
        apartamento,
        aluguel: imovel.aluguel.valor!,
      },
      renda: { mensal: renda },
    },
  };
}

function sanitizarValor(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(sanitizarValor);
  if (!valor || typeof valor !== "object") return valor;
  const saida: Record<string, unknown> = {};
  for (const [chave, item] of Object.entries(valor as Record<string, unknown>)) {
    if (CHAVES_PROIBIDAS_NO_CARD.has(chave.toLowerCase())) continue;
    saida[chave] = sanitizarValor(item);
  }
  return saida;
}

/** Cards da cotação: sem score/risco (FC) e sem PII. */
export function sanitizarCards(bruto: unknown): unknown[] {
  if (!Array.isArray(bruto)) return [];
  return bruto.map(sanitizarValor).slice(0, 20);
}

export type PrintDecodificado = {
  bytes: Buffer;
  mime: string;
  ext: "png" | "jpg" | "webp" | "pdf";
};

function mimeParaExt(mime: string): PrintDecodificado["ext"] {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  if (mime === "application/pdf") return "pdf";
  return "png";
}

export function decodificarPrint(dados: unknown): PrintDecodificado | null {
  const o = dados && typeof dados === "object" ? (dados as Record<string, unknown>) : {};
  let b64: string | null = null;
  for (const chave of CHAVES_B64) {
    const v = o[chave];
    if (typeof v === "string" && v.trim()) {
      b64 = v.trim();
      break;
    }
  }
  if (!b64) return null;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(b64, "base64");
  } catch {
    return null;
  }
  if (bytes.length === 0 || bytes.length > TETO_PRINT_BYTES) return null;
  const mimeBruto = typeof o.mime === "string" ? o.mime : (typeof o.content_type === "string" ? o.content_type : MIME_PRINT_PADRAO);
  const mime = MIME_PRINT.has(mimeBruto) ? mimeBruto : MIME_PRINT_PADRAO;
  return { bytes, mime, ext: mimeParaExt(mime) };
}

export function resultadoDaCotacao(status: StatusAnaliseInquilino): Record<string, unknown> {
  return {
    cards: sanitizarCards(status.cards),
    print_disponivel: status.print_disponivel,
  };
}
