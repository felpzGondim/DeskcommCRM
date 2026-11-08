/**
 * Exclusão de contato pessoal nas rotas autenticadas por cookie (spec 21).
 *
 * Distinto da leitura DELEGADA (`delegacao-empresarial.ts`): aqui a identidade
 * já veio de `getUser()` + org ativa. Não se exige classificação corporativa da
 * sessão de canal — isso quebraria a Inbox comum.
 *
 * Fail closed: só PERMITE quando a conversa da org aponta para um contato da
 * mesma org com `is_personal === false` (booleano literal). Erro de consulta,
 * conversa/contato ausente, `contact_id` vazio, `is_personal` malformado ou
 * `true` → recusa (as rotas devolvem 404 mudo, sem assinar URL).
 *
 * Operação comum: contato operacional (`is_personal === false`) continua.
 * Caminho delegado (desligado) é outro módulo; D3/D5 (busca corporativa da
 * org) não passam por este helper.
 */
type CadeiaContatoPessoal = {
  select: (cols: string) => CadeiaContatoPessoal;
  eq: (coluna: string, valor: string) => CadeiaContatoPessoal;
  maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }>;
};

function cadeia(origem: unknown): CadeiaContatoPessoal {
  return origem as CadeiaContatoPessoal;
}

export type MotivoExclusaoPessoal = "contato_pessoal" | "nao_provado";

export type ResultadoExclusaoPessoal =
  | { recusar: false }
  | { recusar: true; motivo: MotivoExclusaoPessoal };

function idNaoVazio(valor: unknown): valor is string {
  return typeof valor === "string" && valor.trim().length > 0;
}

/**
 * Prova o contato da conversa. `recusar: false` só com `is_personal === false`.
 * Qualquer falha de prova é `nao_provado` (não é "não-pessoal").
 */
export async function avaliarContatoPessoalDaConversa(
  supabase: { from: (tabela: string) => unknown },
  organizationId: string,
  conversationId: string,
): Promise<ResultadoExclusaoPessoal> {
  if (!idNaoVazio(organizationId) || !idNaoVazio(conversationId)) {
    return { recusar: true, motivo: "nao_provado" };
  }
  const conversaQ = await cadeia(supabase.from("conversations"))
    .select("contact_id")
    .eq("id", conversationId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (conversaQ.error) return { recusar: true, motivo: "nao_provado" };
  const conversa = conversaQ.data;
  const contatoId =
    conversa && typeof conversa === "object" && "contact_id" in conversa
      ? (conversa as { contact_id?: unknown }).contact_id
      : null;
  if (!idNaoVazio(contatoId)) return { recusar: true, motivo: "nao_provado" };

  const contatoQ = await cadeia(supabase.from("contacts"))
    .select("is_personal")
    .eq("id", contatoId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (contatoQ.error) return { recusar: true, motivo: "nao_provado" };
  const contato = contatoQ.data;
  if (!contato || typeof contato !== "object" || !("is_personal" in contato)) {
    return { recusar: true, motivo: "nao_provado" };
  }
  const marca = (contato as { is_personal?: unknown }).is_personal;
  if (marca === true) return { recusar: true, motivo: "contato_pessoal" };
  if (marca === false) return { recusar: false };
  return { recusar: true, motivo: "nao_provado" };
}

/** `true` = a rota deve 404 (pessoal ou prova ausente). */
export async function conversaTemContatoPessoal(
  supabase: { from: (tabela: string) => unknown },
  organizationId: string,
  conversationId: string,
): Promise<boolean> {
  return (await avaliarContatoPessoalDaConversa(supabase, organizationId, conversationId)).recusar;
}
