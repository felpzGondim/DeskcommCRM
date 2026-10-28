/**
 * Régua da importação que ATUALIZA contato existente.
 *
 * Com "Atualizar contatos existentes" ligado, o nome da planilha SUBSTITUI o
 * nome principal (`contacts.name`) — inclusive o que já estava preenchido
 * (apelido do WhatsApp gravado na ficha). Sem a opção, o comportamento de
 * sempre: só cria linha nova e pula duplicado.
 *
 * A classificação (preencher / substituir / mesmo) alimenta a PRÉVIA: a
 * tela mostra quantos serão criados, preenchidos e substituídos antes de
 * gravar. A gravação espera um único "Confirmar importação".
 *
 * "Sem nome apresentável" é a mesma porta de `nomeGravavel`: vazio, só
 * espaços, identificador técnico ou o próprio telefone escrito como nome.
 *
 * A agenda do celular aplica a MESMA ideia em `address_book_name` (campo da
 * equipe, nunca o `name` que o cliente vê): preenche só quando está vazio.
 */
import { nomeGravavel } from "@/lib/contacts/nome-da-agenda";

export type DecisaoDeNome =
  | { tipo: "sem_nome_novo" }
  | { tipo: "preencher" }
  | { tipo: "mesmo" }
  | { tipo: "substituir" };

/** O nome principal está vazio para a importação? Telefone-como-nome também. */
export function nomePrincipalVazio(name: string | null | undefined): boolean {
  return nomeGravavel(name) === null;
}

function chaveDeNome(valor: string): string {
  return valor.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
}

export function decidirAtualizacaoDeNome(
  nomeAtual: string | null | undefined,
  nomePlanilha: string | null | undefined,
): DecisaoDeNome {
  if (nomePrincipalVazio(nomePlanilha)) return { tipo: "sem_nome_novo" };
  if (nomePrincipalVazio(nomeAtual)) return { tipo: "preencher" };
  if (chaveDeNome(nomeAtual ?? "") === chaveDeNome(nomePlanilha ?? "")) {
    return { tipo: "mesmo" };
  }
  return { tipo: "substituir" };
}

/** Checkbox / hidden do form: "true", "1" ou "on". */
export function formMarcou(bruto: unknown): boolean {
  return bruto === "true" || bruto === "1" || bruto === "on";
}
