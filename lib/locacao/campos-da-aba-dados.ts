/**
 * Campos da aba Dados que "Preencher pela conversa" tem de gravar.
 * Tela ↔ caminho na ficha ↔ chave no JSON da IA. Sem dado pessoal.
 * Pacote (aluguel+condomínio+IPTU) aparece só no bloco
 * com origem (`CamposImovelProcesso`), não de novo na ficha.
 */
export const CAMPOS_DA_ABA_DADOS = [
  { tela: "Endereço do imóvel", path: "imovel.logradouro", json: "logradouro", tipo: "campo", superficie: "ficha" },
  { tela: "Número do imóvel", path: "imovel.numero", json: "numero", tipo: "campo", superficie: "ficha" },
  { tela: "Complemento", path: "imovel.complemento", json: "complemento", tipo: "campo", superficie: "ficha" },
  { tela: "Bairro", path: "imovel.bairro", json: "bairro", tipo: "campo", superficie: "ficha" },
  { tela: "CEP", path: "imovel.cep", json: "cep", tipo: "campo", superficie: "ficha" },
  { tela: "Cidade", path: "imovel.cidade", json: "cidade", tipo: "campo", superficie: "ficha" },
  { tela: "UF", path: "imovel.uf", json: "uf", tipo: "campo", superficie: "ficha" },
  { tela: "Tipo de imóvel", path: "imovel.tipo", json: "tipo", tipo: "enum", superficie: "ficha" },
  { tela: "Código FC", path: "imovel.codigo_fc", json: "codigo_fc", tipo: "campo", superficie: "ficha" },
  { tela: "Aluguel (R$/mês)", path: "imovel.aluguel", json: "aluguel", tipo: "numero", superficie: "processo" },
  { tela: "Condomínio (R$/mês, inclui rateio)", path: "imovel.condominio", json: "condominio", tipo: "numero", superficie: "processo" },
  { tela: "IPTU (R$/mês)", path: "imovel.iptu", json: "iptu", tipo: "numero", superficie: "processo" },
  { tela: "Início da locação", path: "vigencia.inicio", json: "inicio", tipo: "campo", superficie: "ficha" },
  { tela: "Término da locação", path: "vigencia.fim", json: "fim", tipo: "campo", superficie: "ficha" },
  { tela: "Garantia", path: "garantia.tipo", json: "tipo", tipo: "enum", superficie: "ficha" },
  { tela: "Valor mensal da garantia (R$)", path: "garantia.valor_mensal", json: "valor_mensal", tipo: "numero", superficie: "ficha" },
  { tela: "Índice de reajuste", path: "contrato.indice_reajuste", json: "indice_reajuste", tipo: "campo", superficie: "ficha" },
  { tela: "Taxa de administração (%)", path: "contrato.taxa_adm", json: "taxa_adm", tipo: "numero", superficie: "ficha" },
  { tela: "Taxa de locação (%)", path: "contrato.taxa_locacao", json: "taxa_locacao", tipo: "numero", superficie: "ficha" },
  { tela: "Observação", path: "contrato.observacao", json: "observacao", tipo: "campo", superficie: "ficha" },
  { tela: "Nome do locador", path: "locador.nome", json: "nome", tipo: "campo", superficie: "locador" },
  { tela: "CPF/CNPJ do locador", path: "locador.documento", json: "documento", tipo: "campo", superficie: "locador" },
  { tela: "Contato do locador", path: "locador.contato", json: "contato", tipo: "campo", superficie: "locador" },
] as const;

export type CampoDaAbaDados = (typeof CAMPOS_DA_ABA_DADOS)[number];

export const ROTULOS_DO_PACOTE_NA_FICHA = [
  "Aluguel (R$)",
  "Condomínio / rateio (R$)",
  "IPTU mensal (R$)",
] as const;

export function valorNoCaminhoDaFicha(
  ficha: unknown,
  path: string,
): unknown {
  return path.split(".").reduce<unknown>(
    (atual, chave) => (atual && typeof atual === "object" ? (atual as Record<string, unknown>)[chave] : undefined),
    ficha,
  );
}
