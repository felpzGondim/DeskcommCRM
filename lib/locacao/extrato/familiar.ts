/**
 * Familiares na renda comprovada (correção 20:57).
 *
 * Confirmado — sai da renda, volume à parte:
 * - nome ou CPF da ficha (cônjuge, pais/parente) bate com o lançamento
 *   (nome igual ou primeiro+último);
 * - palavra de parentesco direto (pai, mãe, cônjuge, filhos, tios).
 *
 * Provável — sai da comprovada, entra na renda COM prováveis, lista
 * "familiar provável — conferir" (nunca descarte silencioso):
 * - só sobrenome em comum com o titular;
 * - sobrenome muito frequente (SILVA, SANTOS, …);
 * - nome parcial (um token só, match incompleto).
 *
 * Terceiros (empregador, clientes, PIX avulso) não passam por aqui.
 */
import { cpfDe, normalizarNome, parecePessoaJuridica, tokensDeNome } from "./texto";
import type { Lancamento, MotivoFamiliar, TitularDoExtrato } from "./tipos";

export type PapelFamiliar = "conjuge" | "parente";

export type { MotivoFamiliar };

export interface FamiliarDaFicha {
  nome: string | null;
  cpfDigits: string | null;
  papel: PapelFamiliar;
}

export interface DecisaoFamiliar {
  classe: "conjuge" | "familiar" | "familiar_provavel";
  motivo: MotivoFamiliar;
}

/** Sobrenomes demais comuns no Brasil para cravar parentesco só por eles. */
export const SOBRENOMES_FREQUENTES: ReadonlySet<string> = new Set([
  "SILVA",
  "SANTOS",
  "OLIVEIRA",
  "SOUZA",
  "SOUSA",
  "PEREIRA",
  "LIMA",
  "CARVALHO",
  "FERREIRA",
  "RODRIGUES",
  "ALMEIDA",
  "COSTA",
  "GOMES",
  "MARTINS",
  "ARAUJO",
  "MELO",
  "BARBOSA",
  "RIBEIRO",
  "ALVES",
  "NASCIMENTO",
  "ROCHA",
  "MACHADO",
  "ANDRADE",
]);

const PALAVRAS_NAO_SOBRENOME = new Set([
  "PIX",
  "TED",
  "DOC",
  "TEV",
  "BANCO",
  "STONE",
  "PAGBANK",
  "NUBANK",
  "ITAU",
  "BRADESCO",
  "CAIXA",
  "SANTANDER",
  "RECEBIDO",
  "ENVIADO",
  "TRANSFERENCIA",
  "CREDITO",
  "DEBITO",
  "PAGAMENTO",
  "SALARIO",
  "FOLHA",
  "PAGTO",
  "ANTECIPACAO",
  "CARTAO",
  "TITULAR",
]);

const PARENTESCO =
  /\b(PAI|MAE|FILHO|FILHA|TIO|TIA|ESPOSO|ESPOSA|MARIDO|CONJUGE|PADRASTO|MADRASTA|GENRO|NORA|SOGRO|SOGRA)\b/;
const CONJUGE_PALAVRA = /\b(ESPOSO|ESPOSA|MARIDO|CONJUGE)\b/;

export function forcaDoNome(
  a: string | null,
  b: string | null,
): "exato" | "primeiro_ultimo" | "parcial" | null {
  if (!a || !b) return null;
  const na = normalizarNome(a);
  const nb = normalizarNome(b);
  if (na.length === 0 || nb.length === 0) return null;
  if (na === nb) return "exato";
  const ta = tokensDeNome(a);
  const tb = tokensDeNome(b);
  if (ta.length === 0 || tb.length === 0) return null;
  const primeiroA = ta[0];
  const primeiroB = tb[0];
  const ultimoA = ta[ta.length - 1];
  const ultimoB = tb[tb.length - 1];
  if (
    ta.length >= 2 &&
    tb.length >= 2 &&
    primeiroA &&
    primeiroB &&
    ultimoA &&
    ultimoB &&
    primeiroA === primeiroB &&
    ultimoA === ultimoB
  ) {
    return "primeiro_ultimo";
  }
  const [curto, longo] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (curto.length >= 2 && curto.every((t) => longo.includes(t))) return "primeiro_ultimo";
  if (curto.length === 1 && longo.includes(curto[0]!)) return "parcial";
  if (na.includes(nb) || nb.includes(na)) return "parcial";
  return null;
}

export function sobrenomeDe(nome: string | null): string | null {
  const tokens = tokensDeNome(nome ?? "");
  const last = tokens[tokens.length - 1];
  if (!last || last.length < 3 || PALAVRAS_NAO_SOBRENOME.has(last)) return null;
  if (/^\d+$/.test(last)) return null;
  return last;
}

const PREFIXO_LANC = /^(PIX|TED|DOC|TEV|TRANSFERENCIA)\s+(RECEBIDO|ENVIADO|ENVIADA)?\s*/i;

export function nomeDoPagador(lancamento: Lancamento): string {
  const bruto = (lancamento.contraparte && lancamento.contraparte.trim()) || lancamento.descricao;
  return bruto
    .replace(PREFIXO_LANC, "")
    .replace(/^CPF\s+[\d.\-]+\s*/i, "")
    .trim();
}

function textoContra(lancamento: Lancamento): string {
  return `${lancamento.contraparte ?? ""} ${lancamento.descricao}`;
}

function cpfDoLancamento(lancamento: Lancamento): string | null {
  return (
    cpfDe(lancamento.descricao) ?? (lancamento.contraparte ? cpfDe(lancamento.contraparte) : null)
  );
}

function classeDoPapel(papel: PapelFamiliar): "conjuge" | "familiar" {
  return papel === "conjuge" ? "conjuge" : "familiar";
}

/**
 * Decide se o crédito é familiar confirmado, familiar provável, ou ninguém.
 * Não classifica PJ. Débitos não entram — o chamador já filtrou.
 */
export function decidirFamiliar(
  lancamento: Lancamento,
  titular: TitularDoExtrato,
  familiares: readonly FamiliarDaFicha[],
): DecisaoFamiliar | null {
  if (lancamento.direcao !== "C") return null;
  const contra = textoContra(lancamento);
  if (parecePessoaJuridica(contra)) return null;

  const cpfContra = cpfDoLancamento(lancamento);
  const pagador = nomeDoPagador(lancamento);
  for (const fam of familiares) {
    if (fam.cpfDigits && cpfContra && fam.cpfDigits === cpfContra) {
      return { classe: classeDoPapel(fam.papel), motivo: "cpf_ficha" };
    }
    const forca =
      forcaDoNome(fam.nome, lancamento.contraparte) ??
      forcaDoNome(fam.nome, pagador) ??
      forcaDoNome(fam.nome, lancamento.descricao);
    if (forca === "exato" || forca === "primeiro_ultimo") {
      return { classe: classeDoPapel(fam.papel), motivo: "ficha" };
    }
    if (forca === "parcial") {
      return { classe: "familiar_provavel", motivo: "nome_parcial" };
    }
  }

  const d = normalizarNome(contra);
  if (PARENTESCO.test(d)) {
    return {
      classe: CONJUGE_PALAVRA.test(d) ? "conjuge" : "familiar",
      motivo: "parentesco",
    };
  }

  const sobrenomeTitular = sobrenomeDe(titular.nome);
  const sobrenomePago =
    sobrenomeDe(lancamento.contraparte) ??
    sobrenomeDe(pagador) ??
    sobrenomeDe(lancamento.descricao);
  if (sobrenomeTitular && sobrenomePago && sobrenomeTitular === sobrenomePago) {
    const tokensPago = tokensDeNome(lancamento.contraparte || pagador || lancamento.descricao);
    const frequente = SOBRENOMES_FREQUENTES.has(sobrenomePago);
    if (tokensPago.length < 2) {
      return { classe: "familiar_provavel", motivo: "nome_parcial" };
    }
    return {
      classe: "familiar_provavel",
      motivo: frequente ? "sobrenome_comum" : "sobrenome",
    };
  }

  return null;
}

export function familiaresDeConjuge(
  conjuge: TitularDoExtrato | null | undefined,
): FamiliarDaFicha[] {
  if (!conjuge || (!conjuge.nome && !conjuge.cpfDigits)) return [];
  return [{ nome: conjuge.nome, cpfDigits: conjuge.cpfDigits, papel: "conjuge" }];
}

export function juntarFamiliares(
  familiares: readonly FamiliarDaFicha[] | null | undefined,
  conjuge?: TitularDoExtrato | null,
): FamiliarDaFicha[] {
  const saida = [...(familiares ?? [])];
  for (const extra of familiaresDeConjuge(conjuge)) {
    const ja = saida.some(
      (f) =>
        (extra.cpfDigits && f.cpfDigits === extra.cpfDigits) ||
        (extra.nome && f.nome && normalizarNome(f.nome) === normalizarNome(extra.nome)),
    );
    if (!ja) saida.push(extra);
  }
  return saida;
}
