/**
 * Contrato do Hub para `consultar_contrato_inquilino` (PR brisa-hub#26):
 * `{ resultado, encontrado, status, contrato?, inquilino_situacao? }`.
 *
 * `encontrado` só é true em `status=ok`. Qualquer outro status (ou
 * `encontrado:false`) é "não encontrado" para o painel e para a IA — nunca
 * sucesso de negócio. A IA não afirma ao cliente que ele não tem contrato
 * com base em `nao_encontrado` ou `indisponivel`.
 */
export const STATUS_CONTRATO_HUB = [
  "ok",
  "nao_encontrado",
  "pedido_invalido",
  "multiplos_contratos",
  "indisponivel",
  "nao_permitido",
] as const;

export type StatusContratoHub = (typeof STATUS_CONTRATO_HUB)[number];

export const INSTRUCAO_IA_SEM_CONTRATO =
  "Não afirme ao cliente que ele não tem contrato. A consulta não encontrou ou está indisponível; peça à equipe para conferir no SuperLógica.";

const MENSAGEM: Record<Exclude<StatusContratoHub, "ok">, string> = {
  nao_encontrado:
    "Nenhum contrato encontrado para este contato no SuperLógica. Isso não prova que o cliente não tem contrato — confira no cadastro.",
  pedido_invalido:
    "A consulta de contrato foi recusada: o pedido está inválido. Confira o vínculo Superlógica e tente de novo.",
  multiplos_contratos:
    "Há mais de um contrato para este contato. Confira no SuperLógica antes de falar com o cliente.",
  indisponivel:
    "A consulta de contrato está indisponível agora. Não afirme ao cliente que ele não tem contrato; tente de novo ou confira no SuperLógica.",
  nao_permitido:
    "A consulta de contrato não está permitida nesta instalação. Peça à administração para conferir a integração.",
};

export type LeituraContratoHub = {
  status: StatusContratoHub;
  encontrado: boolean;
  resultado: string;
  contrato: Record<string, unknown> | null;
  inquilinoSituacao: string | null;
  textoParaAtendente: string;
  instrucaoIa: string | null;
};

function ehStatus(v: unknown): v is StatusContratoHub {
  return typeof v === "string" && (STATUS_CONTRATO_HUB as readonly string[]).includes(v);
}

export function interpretarContratoHub(dados: unknown): LeituraContratoHub | null {
  if (!dados || typeof dados !== "object" || Array.isArray(dados)) return null;
  const d = dados as Record<string, unknown>;
  const statusBruto = d.status ?? d.resultado;
  const contrato =
    d.contrato && typeof d.contrato === "object" && !Array.isArray(d.contrato)
      ? (d.contrato as Record<string, unknown>)
      : null;
  const status: StatusContratoHub = ehStatus(statusBruto)
    ? statusBruto
    : contrato
      ? "ok"
      : "indisponivel";
  const encontradoExplicito = d.encontrado === true;
  const encontradoNegado = d.encontrado === false;
  const encontradoOk = !encontradoNegado && status === "ok" && (encontradoExplicito || (d.encontrado === undefined && !!contrato));
  const resultado = typeof d.resultado === "string" ? d.resultado : status;
  const inquilinoSituacao = typeof d.inquilino_situacao === "string" ? d.inquilino_situacao : null;

  if (!encontradoOk) {
    const statusFalha: Exclude<StatusContratoHub, "ok"> = status === "ok" ? "nao_encontrado" : status;
    return {
      status: statusFalha,
      encontrado: false,
      resultado,
      contrato: null,
      inquilinoSituacao: null,
      textoParaAtendente: MENSAGEM[statusFalha],
      instrucaoIa: INSTRUCAO_IA_SEM_CONTRATO,
    };
  }
  if (!contrato) return null;
  return {
    status: "ok",
    encontrado: true,
    resultado,
    contrato,
    inquilinoSituacao,
    textoParaAtendente: "",
    instrucaoIa: null,
  };
}

export function motivoDoVazioDoContratoHub(resultado: unknown): string | null {
  if (!resultado || typeof resultado !== "object" || Array.isArray(resultado)) return null;
  const r = resultado as Record<string, unknown>;
  const d =
    r.dados && typeof r.dados === "object" && !Array.isArray(r.dados)
      ? (r.dados as Record<string, unknown>)
      : r;
  if (d.encontrado === false) {
    return typeof d.status === "string" ? d.status : "nao_encontrado";
  }
  if (ehStatus(d.status) && d.status !== "ok") return d.status;
  return null;
}

export const NOMES_CONTRATO_HUB = ["consultar_contrato_inquilino", "buscar_contrato"] as const;

export function ehFerramentaDeContratoHub(nome: string): boolean {
  return (NOMES_CONTRATO_HUB as readonly string[]).includes(nome);
}
