/**
 * Mapeamento puro da análise FC Score+ (PR 4.3).
 * Sem I/O. Sem passo pago. O CRM monta o payload; o Hub só SALVA (grátis)
 * neste módulo. A cobrança mora em `confirmar_cobranca_fc` (S, clique humano).
 */
import { codigoFc } from "@/lib/locacao/endereco";
import { inquilinoPrincipalDaFicha } from "@/lib/locacao/ficha-telefone";
import type { FichaPreliminar, PapelDaFicha, PessoaDaFicha } from "@/lib/locacao/ficha-schema";
import type { StatusAnaliseInquilino } from "@/lib/locacao/analise/status-hub";
import { hashCpfDoParticipante } from "@/lib/locacao/cpf";
import type { EstadoDaAnaliseFc, PapelDoProcesso } from "@/lib/locacao/vocabulario";
import { exigirObrigatorios, type ValoresDoImovel } from "@/lib/locacao/valores-imovel";

export { lerStatusDoHub, type StatusAnaliseInquilino } from "@/lib/locacao/analise/status-hub";

export const TETO_LAUDO_BYTES = 2 * 1024 * 1024;
export const MIME_LAUDO_PADRAO = "application/pdf";
export const DIAS_REUSO_FC = 90;

/** Papéis que só entram na FC quando um atendente pede (nunca o agente). */
export const PAPEIS_FC_SO_COM_CLIQUE: readonly PapelDoProcesso[] = ["fiador", "solidario"];

const CHAVES_B64 = ["arquivo_b64", "bytes_b64", "conteudo_b64", "laudo_b64", "pdf_b64"] as const;
const MIME_LAUDO = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

const CHAVES_PROIBIDAS_NO_RESULTADO = new Set([
  "cpf",
  "email",
  "telefone",
  "phone",
  "celular",
  "nome",
  "name",
  "cpf_hash",
]);

export type ArgumentosIniciarFc = {
  pedido_id: string;
  conversa_id: string;
  organization_id: string;
  candidato: { nome: string; cpf: string; email: string; telefone: string };
  imovel: { codigo_fc: string; logradouro: string; apartamento: string; aluguel: number };
  renda: { mensal: number };
};

export type FalhaDoPayloadFc = { ok: false; motivo: string };
export type PayloadFcOk = { ok: true; argumentos: ArgumentosIniciarFc };

const MAPA_ESTADO_HUB: Record<string, EstadoDaAnaliseFc> = {
  solicitada: "solicitada",
  recebido: "solicitada",
  renda_preliminar: "solicitada",
  aguardando_renda: "solicitada",
  dados_para_confirmar: "solicitada",
  fc_salvo_pendente: "aguardando_cobranca",
  aguardando_cobranca_fc: "aguardando_cobranca",
  aguardando_cobranca: "aguardando_cobranca",
  aguardando_confirmacao: "aguardando_cobranca",
  cobrando: "cobrando",
  fc_processado: "cobrando",
  concluido: "concluida",
  concluida: "concluida",
  reaproveitada: "reaproveitada",
  erro: "erro",
  login_necessario: "login_necessario",
  cancelada: "cancelada",
  cancelado: "cancelada",
};

export function mapearEstadoHubFc(bruto: unknown): EstadoDaAnaliseFc {
  if (typeof bruto !== "string") return "solicitada";
  return MAPA_ESTADO_HUB[bruto.trim().toLowerCase()] ?? "solicitada";
}

export function papelExigeCliqueHumano(papel: string | null | undefined): boolean {
  return PAPEIS_FC_SO_COM_CLIQUE.includes(papel as PapelDoProcesso);
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

function telefoneValido(bruto: string | null | undefined): string | null {
  const s = (bruto ?? "").trim();
  const d = s.replace(/\D/g, "");
  if (d.length < 8) return null;
  return s;
}

export function pessoaDaFichaParaFc(
  ficha: FichaPreliminar,
  opts: { papelFicha?: PapelDaFicha; cpfHash?: string | null } = {},
): PessoaDaFicha | null {
  if (opts.cpfHash) {
    // Hash informado que não casa: recusa. Não escolhe outra pessoa pelo papel —
    // gravar a ficha não atualiza cpf_hash do participante; misturar identidades
    // reaproveitaria o FC da pessoa antiga ou gravaria o laudo no hash errado.
    return ficha.pessoas.find((p) => hashCpfDoParticipante(p.cpf.valor ?? "") === opts.cpfHash) ?? null;
  }
  if (opts.papelFicha) {
    const doPapel = ficha.pessoas.filter((p) => p.papel === opts.papelFicha);
    return doPapel.find((p) => p.principal) ?? doPapel[0] ?? null;
  }
  return inquilinoPrincipalDaFicha(ficha);
}

export function papelFichaDoProcesso(papel: PapelDoProcesso | string | null | undefined): PapelDaFicha {
  if (papel === "locatario") return "inquilino";
  if (papel === "solidario" || papel === "fiador" || papel === "contato") return papel;
  return "inquilino";
}

export function pendenciaDoPayloadFc(
  ficha: FichaPreliminar,
  pessoa: PessoaDaFicha | null,
  telefone: string | null,
  valores: ValoresDoImovel,
): string | null {
  if (!pessoa) {
    return "Inclua o inquilino principal como locatário no processo antes de analisar a FC.";
  }
  if (!telefoneValido(telefone ?? pessoa.celular.valor)) {
    return "Informe o celular desta pessoa na ficha antes de analisar a FC.";
  }
  if (!pessoa.nome.valor?.trim()) {
    return "Informe o nome desta pessoa na ficha antes de analisar a FC.";
  }
  if (!soDigitosCpf(pessoa.cpf.valor ?? "")) {
    return "Informe o CPF desta pessoa na ficha antes de analisar a FC.";
  }
  if (!emailValido(pessoa.email.valor ?? "")) {
    return "Informe o e-mail desta pessoa na ficha antes de analisar a FC.";
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
  if (!codigo || !logradouro) {
    return "Informe o imóvel (endereço) na ficha antes de analisar a FC.";
  }
  const faltaValor = exigirObrigatorios(valores, "fc");
  if (faltaValor) return faltaValor;
  const renda = ficha.renda.proposta_fc.valor ?? ficha.renda.mensal.valor;
  if (typeof renda !== "number") {
    return "Confirme a renda antes de analisar o seguro-fiança ou a FC.";
  }
  return null;
}

export function montarArgumentosFc(input: {
  ficha: FichaPreliminar;
  pessoa: PessoaDaFicha;
  pedidoId: string;
  conversaId: string;
  orgId: string;
  telefone: string;
  valores: ValoresDoImovel;
}): PayloadFcOk | FalhaDoPayloadFc {
  const motivo = pendenciaDoPayloadFc(input.ficha, input.pessoa, input.telefone, input.valores);
  if (motivo) return { ok: false, motivo };
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
  // Sem comprovada o motor do #31 deixa mensal/proposta null. Não assumir
  // valor: a pendência já recusou; se chegar aqui sem número, recusa de novo.
  const renda = input.ficha.renda.proposta_fc.valor ?? input.ficha.renda.mensal.valor;
  if (typeof renda !== "number") {
    return { ok: false, motivo: "Confirme a renda antes de analisar o seguro-fiança ou a FC." };
  }
  return {
    ok: true,
    argumentos: {
      pedido_id: input.pedidoId,
      conversa_id: input.conversaId,
      organization_id: input.orgId,
      candidato: {
        nome: input.pessoa.nome.valor!.trim(),
        cpf: soDigitosCpf(input.pessoa.cpf.valor ?? "")!,
        email: emailValido(input.pessoa.email.valor ?? "")!,
        telefone: input.telefone,
      },
      imovel: {
        codigo_fc: codigo,
        logradouro,
        apartamento,
        aluguel: input.valores.aluguel.valor!,
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
    if (CHAVES_PROIBIDAS_NO_RESULTADO.has(chave.toLowerCase())) continue;
    saida[chave] = sanitizarValor(item);
  }
  return saida;
}

export type ResultadoDaFc = {
  score: number | string | null;
  risco: string | null;
  id_fc: string | null;
  laudo_disponivel: boolean;
  reconfirmacao: StatusAnaliseInquilino["reconfirmacao"];
  cobranca: "ja_cobrado" | "incerta" | null;
};

export function resultadoDaFc(
  status: StatusAnaliseInquilino,
  cobranca: ResultadoDaFc["cobranca"] = null,
): ResultadoDaFc {
  return {
    score: status.score,
    risco: status.risco,
    id_fc: status.id_fc,
    laudo_disponivel: status.laudo_disponivel,
    reconfirmacao: status.reconfirmacao,
    cobranca,
  };
}

export function sanitizarResultadoFc(bruto: unknown): ResultadoDaFc {
  const o = bruto && typeof bruto === "object" ? (bruto as Record<string, unknown>) : {};
  const limpo = sanitizarValor(o) as Record<string, unknown>;
  const cobranca = limpo.cobranca === "ja_cobrado" || limpo.cobranca === "incerta"
    ? limpo.cobranca
    : null;
  return {
    score: comoScore(limpo.score),
    risco: typeof limpo.risco === "string" ? limpo.risco.slice(0, 40) : null,
    id_fc: typeof limpo.id_fc === "string" ? limpo.id_fc.slice(0, 80) : null,
    laudo_disponivel: limpo.laudo_disponivel === true,
    reconfirmacao: limpo.reconfirmacao && typeof limpo.reconfirmacao === "object"
      ? {
          necessaria: (limpo.reconfirmacao as { necessaria?: unknown }).necessaria === true,
          motivo: typeof (limpo.reconfirmacao as { motivo?: unknown }).motivo === "string"
            ? String((limpo.reconfirmacao as { motivo: string }).motivo).slice(0, 80)
            : null,
        }
      : null,
    cobranca,
  };
}

function comoScore(valor: unknown): number | string | null {
  if (typeof valor === "number" && Number.isFinite(valor)) return valor;
  if (typeof valor === "string" && valor.trim()) return valor.trim().slice(0, 40);
  return null;
}

export type LaudoDecodificado = {
  bytes: Buffer;
  mime: string;
  ext: "pdf" | "png" | "jpg" | "webp";
};

function mimeParaExt(mime: string): LaudoDecodificado["ext"] {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "pdf";
}

export function decodificarLaudo(dados: unknown): LaudoDecodificado | null {
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
  if (bytes.length === 0 || bytes.length > TETO_LAUDO_BYTES) return null;
  const mimeBruto = typeof o.mime === "string" ? o.mime : (typeof o.content_type === "string" ? o.content_type : MIME_LAUDO_PADRAO);
  const mime = MIME_LAUDO.has(mimeBruto) ? mimeBruto : MIME_LAUDO_PADRAO;
  return { bytes, mime, ext: mimeParaExt(mime) };
}

export type ResultadoDaCobrancaHub =
  | { tipo: "ok"; estado?: string | null; job_id?: string | null }
  | { tipo: "ja_cobrado" }
  | { tipo: "cobranca_incerta" }
  | { tipo: "login_necessario" }
  | { tipo: "indisponivel" }
  | { tipo: "erro"; motivo: string };

export function lerResultadoDaCobranca(dados: unknown): ResultadoDaCobrancaHub {
  const o = dados && typeof dados === "object" ? (dados as Record<string, unknown>) : {};
  const resultado = typeof o.resultado === "string" ? o.resultado.trim().toLowerCase() : "";
  const estado = typeof o.estado === "string" ? o.estado.trim().toLowerCase() : "";
  if (resultado === "ja_cobrado" || estado === "ja_cobrado") return { tipo: "ja_cobrado" };
  if (resultado === "cobranca_incerta" || estado === "cobranca_incerta") return { tipo: "cobranca_incerta" };
  if (resultado === "login_necessario" || estado === "login_necessario") return { tipo: "login_necessario" };
  if (resultado === "indisponivel" || resultado === "indisponível") return { tipo: "indisponivel" };
  if (resultado === "aceito" || resultado === "confirmado" || resultado === "ok" || resultado === "cobrando") {
    return {
      tipo: "ok",
      estado: typeof o.estado === "string" ? o.estado : resultado,
      job_id: typeof o.job_id === "string" ? o.job_id : (typeof o.hub_job_id === "string" ? o.hub_job_id : null),
    };
  }
  if (!resultado && (estado === "cobrando" || estado === "fc_processado" || estado === "concluido")) {
    return { tipo: "ok", estado, job_id: typeof o.job_id === "string" ? o.job_id : null };
  }
  return { tipo: "erro", motivo: "O Brisa Hub não confirmou a cobrança da FC." };
}
