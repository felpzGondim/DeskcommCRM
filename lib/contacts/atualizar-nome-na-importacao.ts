/**
 * Régua da importação que ATUALIZA contato existente.
 *
 * A planilha e a agenda do celular só criavam linha nova. Quem já estava no
 * CRM — em geral porque mandou mensagem no WhatsApp — ficava com o apelido do
 * perfil ou só o número, e o nome da planilha/agenda era descartado como
 * "duplicado". Esta régua decide, sem tocar no banco, o que fazer com o nome
 * principal (`contacts.name`) quando o telefone já existe:
 *
 *   - planilha sem nome novo → não toca;
 *   - ficha sem nome apresentável → preenche;
 *   - ficha com o mesmo nome → não toca;
 *   - ficha com nome diferente → conflito: só substitui com confirmação.
 *
 * "Sem nome apresentável" é a mesma porta de `nomeGravavel`: vazio, só
 * espaços, identificador técnico ou o próprio telefone escrito como nome —
 * o que a ingestão do WhatsApp deixa quando não há nome de gente.
 *
 * A agenda do celular aplica a MESMA ideia em `address_book_name` (campo da
 * equipe, nunca o `name` que o cliente vê). Conflito e confirmação são só do
 * nome principal da planilha: a agenda nunca sobrescreve um nome da equipe
 * que já está preenchido.
 */
import { nomeGravavel } from "@/lib/contacts/nome-da-agenda";

export type DecisaoDeNome =
  | { tipo: "sem_nome_novo" }
  | { tipo: "preencher" }
  | { tipo: "mesmo" }
  | { tipo: "conflito" };

export interface ConflitoDeNome {
  linha: number;
  contact_id: string;
  nome_atual: string;
  nome_planilha: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  return { tipo: "conflito" };
}

/**
 * Lê o campo de confirmação (`substituir_contact_ids`) sem lançar.
 * JSON inválido, item que não é UUID e lixo do form viram conjunto vazio —
 * a confirmação só vale para id que o próprio servidor devolveu no conflito.
 */
export function lerIdsDeSubstituicao(bruto: unknown): Set<string> {
  if (typeof bruto !== "string" || bruto.trim() === "") return new Set();
  let parsed: unknown;
  try {
    parsed = JSON.parse(bruto);
  } catch {
    return new Set();
  }
  if (!Array.isArray(parsed)) return new Set();
  const ids = new Set<string>();
  for (const item of parsed) {
    if (typeof item === "string" && UUID_RE.test(item)) ids.add(item);
  }
  return ids;
}

export function formMarcouAtualizar(bruto: unknown): boolean {
  return bruto === "true" || bruto === "1" || bruto === "on";
}
