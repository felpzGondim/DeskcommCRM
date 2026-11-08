/**
 * Exclusão de contato pessoal nas rotas autenticadas por cookie (spec 21).
 *
 * Distinto da leitura DELEGADA (`delegacao-empresarial.ts`): aqui a identidade
 * já veio de `getUser()` + org ativa. Não se exige classificação corporativa da
 * sessão de canal — isso quebraria a Inbox comum. Só se recusa o que a spec 21
 * já escondeu da lista e do histórico: `contacts.is_personal === true`.
 *
 * Ausência da marca (contato sem linha, `is_personal` ausente ou falso) NÃO
 * recusa: a operação comum continua. Quem precisa de prova positiva de sessão
 * corporativa é só o caminho delegado, ainda desligado.
 */
type CadeiaContatoPessoal = {
  select: (cols: string) => CadeiaContatoPessoal;
  eq: (coluna: string, valor: string) => CadeiaContatoPessoal;
  maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }>;
};

function cadeia(origem: unknown): CadeiaContatoPessoal {
  return origem as CadeiaContatoPessoal;
}

export async function conversaTemContatoPessoal(
  supabase: { from: (tabela: string) => unknown },
  organizationId: string,
  conversationId: string,
): Promise<boolean> {
  const { data: conversa } = await cadeia(supabase.from("conversations"))
    .select("contact_id")
    .eq("id", conversationId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  const contatoId =
    conversa && typeof conversa === "object" && "contact_id" in conversa
      ? (conversa as { contact_id?: string | null }).contact_id
      : null;
  if (!contatoId) return false;
  const { data: contato } = await cadeia(supabase.from("contacts"))
    .select("is_personal")
    .eq("id", contatoId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  return (
    contato && typeof contato === "object" && "is_personal" in contato
      ? (contato as { is_personal?: boolean }).is_personal
      : undefined
  ) === true;
}
