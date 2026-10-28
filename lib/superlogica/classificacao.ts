/**
 * Classificação do casamento contato ↔ Superlógica (Fase 3.5 §4).
 * Padrão sujeito à revisão do Felipe: pergunta 1 = (a) só únicos exatos ligam
 * sozinhos; o resto vai para a lista de revisão.
 */
import type { CategoriaDeCasamento, QualidadeDoVinculo } from "@/lib/locacao/vocabulario";

export interface CandidatoDaSuperlogica {
  superlogica_pessoa_id: string;
  tipo: string;
  ativo: boolean;
  qualidade: QualidadeDoVinculo;
}

export interface ContatoParaCasar {
  contact_id: string;
  chave: string;
  vinculoAtivoPessoaId: string | null;
}

export interface ClassificacaoDoCasamento {
  categoria: CategoriaDeCasamento;
  candidatos: CandidatoDaSuperlogica[];
  ligaSozinho: boolean;
}

export function classificarCasamento(
  contato: ContatoParaCasar,
  pessoas: CandidatoDaSuperlogica[],
  opts?: { ligarUnicoExato?: boolean },
): ClassificacaoDoCasamento {
  const ligarUnicoExato = opts?.ligarUnicoExato !== false;
  const ids = [...new Set(pessoas.map((p) => p.superlogica_pessoa_id))];

  if (contato.vinculoAtivoPessoaId) {
    const igual = pessoas.some((p) => p.superlogica_pessoa_id === contato.vinculoAtivoPessoaId);
    if (igual && ids.length <= 1) {
      return { categoria: "ja_vinculado_igual", candidatos: pessoas, ligaSozinho: false };
    }
    if (!igual && pessoas.length === 0) {
      return { categoria: "numero_mudou", candidatos: [], ligaSozinho: false };
    }
    if (!igual) {
      return { categoria: "ja_vinculado_diferente", candidatos: pessoas, ligaSozinho: false };
    }
  }

  if (pessoas.length === 0) {
    return { categoria: "sem_casamento", candidatos: [], ligaSozinho: false };
  }
  if (ids.length > 1) {
    return { categoria: "varias_pessoas_um_numero", candidatos: pessoas, ligaSozinho: false };
  }
  const unico = pessoas[0]!;
  if (unico.qualidade === "exato") {
    return {
      categoria: "unico_exato",
      candidatos: pessoas,
      ligaSozinho: ligarUnicoExato,
    };
  }
  return { categoria: "unico_parcial", candidatos: pessoas, ligaSozinho: false };
}

export function categoriaUmaPessoaVariosContatos(): CategoriaDeCasamento {
  return "uma_pessoa_varios_contatos";
}
