/**
 * Fonte de casamento Superlógica. O Hub (módulo `vinculo/`) é quem lê a API;
 * aqui o CRM só manda `{contact_id, chave}` e recebe ids. Sem GET quando a
 * fonte não está configurada — a simulação conta `fora`/`sem_casamento`.
 *
 * Nenhuma escrita na Superlógica. Nenhum endpoint de boleto.
 */
export interface PessoaCandidata {
  superlogica_pessoa_id: string;
  tipo: string;
  ativo: boolean;
}

export interface FonteDeVinculo {
  casar(lotes: Array<{ contact_id: string; chave: string }>): Promise<
    Array<{ contact_id: string; pessoas: PessoaCandidata[] }>
  >;
}

/** Fonte vazia: usada nos testes e quando o Hub ainda não anunciou a rota. */
export function fonteVazia(): FonteDeVinculo {
  return {
    async casar(lotes) {
      return lotes.map((l) => ({ contact_id: l.contact_id, pessoas: [] }));
    },
  };
}
