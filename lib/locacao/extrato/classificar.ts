/**
 * Classifica lançamentos: próprias, resgates/aplicações, estornos,
 * empréstimos, vendas no cartão/antecipações, salário/pró-labore, terceiros.
 */
import { cpfDe, nomesDoMesmoTitular, normalizarNome, soDigitos } from "./texto";
import type {
  ClasseLancamento,
  Lancamento,
  LancamentoClassificado,
  TitularDoExtrato,
} from "./tipos";

function tem(texto: string, re: RegExp): boolean {
  return re.test(texto);
}

function cpfDaDescricao(descricao: string): string | null {
  return cpfDe(descricao);
}

function cnpjNaDescricao(descricao: string): boolean {
  if (/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/.test(descricao)) return true;
  const d = soDigitos(descricao);
  return d.length === 14;
}

function parecePj(descricao: string): boolean {
  if (cnpjNaDescricao(descricao)) return true;
  return /\b(ltda|s\.?\s*a\.?|eireli|mei|me\b|epp|ss\b|associacao|associação|cooperativa|autarquia)\b/i.test(
    descricao,
  );
}

export function classificarLancamento(
  lancamento: Lancamento,
  titular: TitularDoExtrato,
): ClasseLancamento {
  const d = normalizarNome(lancamento.descricao);
  if (
    tem(d, /\bESTORNO\b|\bDEVOLUCAO\b|\bCHARGEBACK\b|\bREVERSO\b|\bPIX DEVOLVIDO\b|\bTED DEVOLVID/)
  ) {
    return "estorno_devolucao";
  }
  if (
    tem(
      d,
      /\bRESGATE\b|\bAPLICACAO\b|\bCDB\b|\bTESOURO\b|\bPOUPANCA\b|\bRENDE FACIL\b|\bRENDA FIXA\b|\bINVESTIMENTO\b|\bFUNDO\b/,
    )
  ) {
    return "resgate_aplicacao";
  }
  if (
    tem(
      d,
      /\bEMPRESTIMO\b|\bCONSIGNADO\b|\bCREDITO PESSOAL\b|\bFINANCIAMENTO\b|\bPARCELA EMPREST|\bPAGAMENTO EMPREST/,
    )
  ) {
    return "emprestimo";
  }
  if (
    tem(
      d,
      /\bANTECIPACAO\b|\bVENDA STONE\b|\bVENDAS NO CARTAO\b|\bMDR\b|\bRECEBIVEL\b|\bLIQUIDACAO STONE\b|\bSTONE PAGAMENTO\b|\bRECEBIMENTO CARTAO\b/,
    )
  ) {
    return "venda_cartao";
  }

  const cpfContra = cpfDaDescricao(lancamento.descricao);
  const mesmaPessoa =
    (titular.cpfDigits != null && cpfContra != null && titular.cpfDigits === cpfContra) ||
    nomesDoMesmoTitular(titular.nome, lancamento.contraparte) ||
    nomesDoMesmoTitular(titular.nome, lancamento.descricao);
  const palavraPropria = tem(
    d,
    /\bTRANSFERENCIA ENTRE CONTAS\b|\bTRANSF ENTRE CONTAS\b|\bTEV\b|\bENVIO ENTRE CONTAS\b|\bCONTA PROPRIA\b|\bMESMA TITULARIDADE\b/,
  );
  if (mesmaPessoa || palavraPropria) return "propria";

  if (
    tem(
      d,
      /\bSALARIO\b|\bPRO LABORE\b|\bPROLABORE\b|\bFOLHA DE PAGAMENTO\b|\bFOLHA PAGTO\b|\bPROVENTOS\b|\bHOLERITE\b/,
    )
  ) {
    return "salario_prolabore";
  }

  if (lancamento.direcao === "D") return "saida";

  if (parecePj(lancamento.descricao) || parecePj(lancamento.contraparte ?? ""))
    return "terceiro_pj";
  return "terceiro_pf";
}

export function classificarLancamentos(
  lancamentos: readonly Lancamento[],
  titular: TitularDoExtrato,
): LancamentoClassificado[] {
  return lancamentos.map((l) => ({ ...l, classe: classificarLancamento(l, titular) }));
}

export const CLASSES_EXCLUIDAS_DA_RENDA: ReadonlySet<ClasseLancamento> = new Set([
  "propria",
  "resgate_aplicacao",
  "estorno_devolucao",
  "emprestimo",
  "venda_cartao",
  "saida",
]);
