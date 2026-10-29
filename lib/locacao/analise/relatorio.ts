/**
 * Relatório financeiro de 6 seções (PR 4.5). Montagem determinística a
 * partir dos blocos já gravados. Sem Hub, sem passo pago, sem envio ao
 * cliente. Risco só baixo/moderado/alto — nunca "alugue" / "não alugue".
 *
 * A seção de renda consome um bloco já calculado (tabela mensal +
 * comprovada, ou motivo de não comprovação). Sem bloco, fica pendente.
 * Motor e prompt de renda não moram aqui — ver `bloco-de-renda.ts`.
 */
import { mascararPessoaNoTexto } from "@/lib/painel/mascarar";
import {
  TEXTO_BLOCO_RENDA_AUSENTE,
  aceitarBlocoDeRenda,
  type BlocoDeRendaCalculado,
} from "@/lib/locacao/analise/bloco-de-renda";
import { sanitizarResultadoFc, type ResultadoDaFc } from "@/lib/locacao/analise/fc";
import { sanitizarCards } from "@/lib/locacao/analise/seguro";
import { completarFicha, type FichaPreliminar } from "@/lib/locacao/ficha-schema";

export const SECOES_DO_RELATORIO = [
  "identificacao",
  "resumo",
  "credito",
  "renda",
  "financeira",
  "risco",
] as const;

export type SecaoDoRelatorio = (typeof SECOES_DO_RELATORIO)[number];
export const RISCOS_DO_RELATORIO = ["baixo", "moderado", "alto"] as const;
export type RiscoDoRelatorio = (typeof RISCOS_DO_RELATORIO)[number];

export const TEXTO_SECAO_PENDENTE = "Pendente — este bloco ainda não foi gravado. Nenhum número foi inventado.";
export const FRASE_PROIBIDA = /n[aã]o\s+alugue|\balugue\b/i;

const RG = /\b\d{1,2}\.?\d{3}\.?\d{3}-?[0-9Xx]\b/g;

export function mascararRelatorio(texto: string): string {
  return mascararPessoaNoTexto(texto).replace(RG, "[rg]");
}

export function recusarFraseDeAluguel(texto: string): string {
  return texto.replace(FRASE_PROIBIDA, "[risco]");
}

export function normalizarRisco(bruto: string | null | undefined): RiscoDoRelatorio | null {
  if (!bruto) return null;
  const t = bruto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
  if (t === "baixo" || t === "low") return "baixo";
  if (t === "moderado" || t === "medio" || t === "medium") return "moderado";
  if (t === "alto" || t === "high") return "alto";
  return null;
}

/**
 * Sem comprovada, nunca "baixo". Sem FC e sem comprovada: risco pendente.
 * Padrão conservador, sujeito à revisão do Felipe.
 */
export function classificarRisco(input: {
  fcRisco: string | null;
  renda: BlocoDeRendaCalculado;
}): { risco: RiscoDoRelatorio | null; pendente: boolean } {
  const fc = normalizarRisco(input.fcRisco);
  const rendaPendente = input.renda.comprovada === null;
  if (rendaPendente && !fc) return { risco: null, pendente: true };
  if (fc === "alto" || input.renda.abaixo_de_3x === true) {
    return { risco: "alto", pendente: rendaPendente };
  }
  if (fc === "moderado" || rendaPendente) return { risco: "moderado", pendente: rendaPendente };
  if (fc === "baixo" && !rendaPendente && input.renda.abaixo_de_3x === false) {
    return { risco: "baixo", pendente: false };
  }
  return { risco: "moderado", pendente: true };
}

export type BlocoDoRelatorio = {
  ficha: FichaPreliminar | null;
  relatorioPreliminar: string | null;
  rendaConfirmada: boolean;
  renda: BlocoDeRendaCalculado | null;
  fc: ResultadoDaFc | null;
  fcEstado: string | null;
  seguroCards: ReturnType<typeof sanitizarCards>;
  seguroEstado: string | null;
};

export type SecaoMontada = {
  id: SecaoDoRelatorio;
  titulo: string;
  pendente: boolean;
  texto: string;
};

export type RelatorioFinanceiro = {
  secoes: SecaoMontada[];
  risco: RiscoDoRelatorio | null;
  renda: BlocoDeRendaCalculado;
  texto: string;
};

function titulo(id: SecaoDoRelatorio): string {
  if (id === "identificacao") return "1. Identificação";
  if (id === "resumo") return "2. Resumo";
  if (id === "credito") return "3. Crédito";
  if (id === "renda") return "4. Renda";
  if (id === "financeira") return "5. Financeira / Despesas";
  return "6. Risco para locação";
}

function campo(valor: string | null | undefined): string {
  return valor && valor.trim() ? mascararRelatorio(valor.trim()) : "—";
}

function dinheiro(valor: number | null | undefined): string {
  return typeof valor === "number" && Number.isFinite(valor) ? `R$ ${valor.toFixed(2)}` : "—";
}

function secao(
  id: SecaoDoRelatorio,
  linhas: string[],
  pendente = false,
): SecaoMontada {
  const texto = recusarFraseDeAluguel(mascararRelatorio(linhas.filter(Boolean).join("\n")));
  return { id, titulo: titulo(id), pendente, texto };
}

export function montarRelatorioFinanceiro(bloco: BlocoDoRelatorio): RelatorioFinanceiro {
  const ficha = bloco.ficha ? completarFicha(bloco.ficha) : null;
  const inquilino = ficha?.pessoas.find((p) => p.papel === "inquilino" && p.principal)
    ?? ficha?.pessoas.find((p) => p.papel === "inquilino")
    ?? null;
  const renda = aceitarBlocoDeRenda(bloco.renda);
  const fc = bloco.fc ? sanitizarResultadoFc(bloco.fc) : null;
  const risco = classificarRisco({ fcRisco: fc?.risco ?? null, renda });

  const identificacao = !ficha || !inquilino
    ? secao("identificacao", [TEXTO_SECAO_PENDENTE], true)
    : secao("identificacao", [
      `Nome: ${campo(inquilino.nome.valor)}`,
      `CPF: ${campo(inquilino.cpf.valor)}`,
      `RG: ${campo(inquilino.rg.valor)}`,
      `Celular: ${campo(inquilino.celular.valor)}`,
      `E-mail: ${campo(inquilino.email.valor)}`,
      `Profissão: ${campo(inquilino.profissao.valor)}`,
      `Imóvel: ${campo(ficha.imovel.logradouro.valor)} ${campo(ficha.imovel.numero.valor)} ${campo(ficha.imovel.complemento.valor)}`.trim(),
    ]);

  const creditoPronto = fc && (bloco.fcEstado === "concluida" || bloco.fcEstado === "reaproveitada");
  const credito = !creditoPronto
    ? secao("credito", [TEXTO_SECAO_PENDENTE], true)
    : secao("credito", [
      `ID-FC: ${campo(fc.id_fc)}`,
      `Score: ${fc.score == null ? "—" : String(fc.score)}`,
      `Risco da FC: ${campo(fc.risco)}`,
    ]);

  const rendaPendente = renda.comprovada === null;
  const rendaSecao = rendaPendente
    ? secao("renda", [renda.motivo_nao_comprovacao ?? TEXTO_BLOCO_RENDA_AUSENTE], true)
    : secao("renda", [
      `Renda comprovada (extrato): ${dinheiro(renda.comprovada)}`,
      `Renda declarada: ${dinheiro(renda.declarada)}`,
      `Pacote (aluguel + condomínio + IPTU + seguro-incêndio): ${dinheiro(renda.pacote)}`,
      `3× o pacote: ${dinheiro(renda.tres_vezes_pacote)}`,
      renda.abaixo_de_3x === true ? "A comprovada ficou abaixo de 3× o pacote." : "",
      renda.declarada !== null && renda.comprovada !== null && renda.comprovada < renda.declarada
        ? "A comprovada ficou abaixo da declarada."
        : "",
      bloco.rendaConfirmada ? "Renda confirmada pelo atendente." : "Renda ainda não confirmada pelo atendente.",
      "",
      renda.tabela ?? "",
    ]);

  const cards = sanitizarCards(bloco.seguroCards);
  const seguroPronto = bloco.seguroEstado === "concluida" && cards.length > 0;
  const financeira = !ficha
    ? secao("financeira", [TEXTO_SECAO_PENDENTE], true)
    : secao("financeira", [
      `Aluguel: ${dinheiro(ficha.imovel.aluguel.valor)}`,
      `Condomínio: ${dinheiro(ficha.imovel.condominio.valor)}`,
      `IPTU: ${dinheiro(ficha.imovel.iptu.valor)}`,
      seguroPronto
        ? `Seguro-fiança: ${cards.slice(0, 8).map((c) => {
          const o = c && typeof c === "object" ? (c as Record<string, unknown>) : {};
          return [o.seguradora, o.codigo ?? o.codigo_cotacao, o.status, o.plano].filter(Boolean).join(" · ");
        }).join("; ")}`
        : "Seguro-fiança: pendente — cotação ainda não gravada.",
    ], !seguroPronto && !ficha.imovel.aluguel.valor);

  const riscoSecao = risco.pendente && !risco.risco
    ? secao("risco", [TEXTO_SECAO_PENDENTE], true)
    : secao("risco", [
      `Classificação: ${risco.risco ?? "pendente"}`,
      "Esta classificação não recomenda alugar nem recusar. Só informa o risco (baixo, moderado ou alto) a partir dos blocos gravados.",
    ], risco.pendente);

  const resumo = secao("resumo", [
    identificacao.pendente ? "Identificação pendente." : `Candidato: ${campo(inquilino?.nome.valor)}.`,
    rendaPendente ? "Renda pendente (bloco de renda ausente)." : `Renda comprovada: ${dinheiro(renda.comprovada)}.`,
    credito.pendente ? "Crédito pendente." : `FC: score ${fc?.score == null ? "—" : String(fc.score)}, risco ${campo(fc?.risco)}.`,
    risco.risco ? `Risco para locação: ${risco.risco}.` : "Risco pendente.",
    bloco.relatorioPreliminar
      ? `Preliminar: ${mascararRelatorio(bloco.relatorioPreliminar).slice(0, 400)}`
      : "",
  ], identificacao.pendente && rendaPendente && credito.pendente);

  const secoes: SecaoMontada[] = [identificacao, resumo, credito, rendaSecao, financeira, riscoSecao];
  const texto = recusarFraseDeAluguel(
    mascararRelatorio(secoes.map((s) => `## ${s.titulo}\n${s.texto}`).join("\n\n")),
  );
  return { secoes, risco: risco.risco, renda, texto };
}
