/**
 * Classifica lançamentos (correção 20:57):
 * próprias, familiares (ficha/parentesco) e prováveis (sobrenome),
 * resgates/aplicações, estornos, empréstimos, vendas no cartão,
 * salário/pró-labore, terceiros (PIX/TED entram na renda).
 */
import { decidirFamiliar, juntarFamiliares, type FamiliarDaFicha } from "./familiar";
import { cpfDe, nomesDoMesmoTitular, normalizarNome, parecePessoaJuridica } from "./texto";
import type {
  ClasseLancamento,
  Lancamento,
  LancamentoClassificado,
  TitularDoExtrato,
} from "./tipos";

function tem(texto: string, re: RegExp): boolean {
  return re.test(texto);
}

function mesmaPessoa(
  titular: TitularDoExtrato | null | undefined,
  lancamento: Lancamento,
): boolean {
  if (!titular) return false;
  const cpfContra = cpfDe(lancamento.descricao);
  return (
    (titular.cpfDigits != null && cpfContra != null && titular.cpfDigits === cpfContra) ||
    nomesDoMesmoTitular(titular.nome, lancamento.contraparte) ||
    nomesDoMesmoTitular(titular.nome, lancamento.descricao)
  );
}

export function classificarLancamento(
  lancamento: Lancamento,
  titular: TitularDoExtrato,
  familiares: readonly FamiliarDaFicha[] = [],
): ClasseLancamento {
  return classificarDetalhe(lancamento, titular, familiares).classe;
}

export function classificarDetalhe(
  lancamento: Lancamento,
  titular: TitularDoExtrato,
  familiares: readonly FamiliarDaFicha[] = [],
): Pick<LancamentoClassificado, "classe" | "motivoFamiliar"> {
  const d = normalizarNome(lancamento.descricao);
  if (
    tem(d, /\bESTORNO\b|\bDEVOLUCAO\b|\bCHARGEBACK\b|\bREVERSO\b|\bPIX DEVOLVIDO\b|\bTED DEVOLVID/)
  ) {
    return { classe: "estorno_devolucao" };
  }
  if (
    tem(
      d,
      /\bRESGATE\b|\bAPLICACAO\b|\bCDB\b|\bTESOURO\b|\bPOUPANCA\b|\bRENDE FACIL\b|\bRENDA FIXA\b|\bINVESTIMENTO\b|\bFUNDO\b/,
    )
  ) {
    return { classe: "resgate_aplicacao" };
  }
  if (
    tem(
      d,
      /\bEMPRESTIMO\b|\bCONSIGNADO\b|\bCREDITO PESSOAL\b|\bFINANCIAMENTO\b|\bPARCELA EMPREST|\bPAGAMENTO EMPREST/,
    )
  ) {
    return { classe: "emprestimo" };
  }
  if (
    tem(
      d,
      /\bANTECIPACAO\b|\bVENDA STONE\b|\bVENDAS NO CARTAO\b|\bMDR\b|\bRECEBIVEL\b|\bLIQUIDACAO STONE\b|\bSTONE PAGAMENTO\b|\bRECEBIMENTO CARTAO\b|\bMAQUININHA\b/,
    )
  ) {
    return { classe: "venda_cartao" };
  }

  const palavraPropria = tem(
    d,
    /\bTRANSFERENCIA ENTRE CONTAS\b|\bTRANSF ENTRE CONTAS\b|\bTEV\b|\bENVIO ENTRE CONTAS\b|\bCONTA PROPRIA\b|\bMESMA TITULARIDADE\b/,
  );
  if (mesmaPessoa(titular, lancamento) || palavraPropria) return { classe: "propria" };

  const familiar = decidirFamiliar(lancamento, titular, familiares);
  if (familiar) return { classe: familiar.classe, motivoFamiliar: familiar.motivo };

  if (
    tem(
      d,
      /\bSALARIO\b|\bREMUNERACAO\b|\bPRO LABORE\b|\bPROLABORE\b|\bFOLHA DE PAGAMENTO\b|\bFOLHA PAGTO\b|\bPROVENTOS\b|\bHOLERITE\b/,
    )
  ) {
    return { classe: "salario_prolabore" };
  }

  if (lancamento.direcao === "D") return { classe: "saida" };

  if (
    parecePessoaJuridica(lancamento.descricao) ||
    parecePessoaJuridica(lancamento.contraparte ?? "")
  ) {
    return { classe: "terceiro_pj" };
  }
  return { classe: "terceiro_pf" };
}

export function classificarLancamentos(
  lancamentos: readonly Lancamento[],
  titular: TitularDoExtrato,
  familiares: readonly FamiliarDaFicha[] = [],
): LancamentoClassificado[] {
  return lancamentos.map((l) => {
    const detalhe = classificarDetalhe(l, titular, familiares);
    return { ...l, ...detalhe };
  });
}

/**
 * Fora da renda comprovada. familiar_provavel também sai da comprovada, mas
 * entra na renda COM prováveis. venda_cartao NÃO entra aqui: é recebimento
 * de cliente.
 */
export const CLASSES_EXCLUIDAS_DA_RENDA: ReadonlySet<ClasseLancamento> = new Set([
  "propria",
  "conjuge",
  "familiar",
  "familiar_provavel",
  "resgate_aplicacao",
  "estorno_devolucao",
  "emprestimo",
  "saida",
]);

export { juntarFamiliares };
export type { FamiliarDaFicha };
