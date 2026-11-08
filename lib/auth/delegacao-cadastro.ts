/**
 * Menor superfície do cadastro de conexão: classifica uma sessão de canal
 * como pertencente à conta empresarial da organização. Não é lista de
 * telefone. Criar o número (POST /channel-sessions) NÃO classifica — fica
 * desconhecida até este vínculo. Substituição = nova sessão + mesmo conta_id.
 */
type Cadeia = {
  select: (cols: string) => Cadeia;
  eq: (coluna: string, valor: string) => Cadeia;
  is: (coluna: string, valor: null) => Cadeia;
  maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }>;
  insert: (row: Record<string, unknown>) => PromiseLike<{ error: unknown }>;
  update: (row: Record<string, unknown>) => Cadeia;
};

function cadeia(origem: unknown): Cadeia {
  return origem as Cadeia;
}

export type ClienteCadastro = { from: (tabela: string) => unknown };

export type ResultadoVinculoEmpresarial =
  | { ok: true }
  | { ok: false; motivo: "conta_ausente" | "sessao_ausente" | "erro" };

function idNaoVazio(valor: unknown): valor is string {
  return typeof valor === "string" && valor.trim().length > 0;
}

export async function vincularSessaoContaEmpresarial(
  db: ClienteCadastro,
  q: { organizationId: string; sessionId: string; contaId: string },
): Promise<ResultadoVinculoEmpresarial> {
  if (!idNaoVazio(q.organizationId) || !idNaoVazio(q.sessionId) || !idNaoVazio(q.contaId)) {
    return { ok: false, motivo: "erro" };
  }

  const conta = await cadeia(db.from("delegacao_contas_empresariais"))
    .select("id")
    .eq("id", q.contaId)
    .eq("organization_id", q.organizationId)
    .is("revoked_at", null)
    .maybeSingle();
  if (conta.error) return { ok: false, motivo: "erro" };
  if (!conta.data) return { ok: false, motivo: "conta_ausente" };

  const sess = await cadeia(db.from("channel_sessions"))
    .select("id")
    .eq("id", q.sessionId)
    .eq("organization_id", q.organizationId)
    .maybeSingle();
  if (sess.error) return { ok: false, motivo: "erro" };
  if (!sess.data) return { ok: false, motivo: "sessao_ausente" };

  const ins = await cadeia(db.from("delegacao_sessoes_empresariais")).insert({
    channel_session_id: q.sessionId,
    organization_id: q.organizationId,
    conta_empresarial_id: q.contaId,
    revoked_at: null,
  });
  if (ins.error) {
    const upd = await cadeia(db.from("delegacao_sessoes_empresariais"))
      .update({
        conta_empresarial_id: q.contaId,
        organization_id: q.organizationId,
        revoked_at: null,
      })
      .eq("channel_session_id", q.sessionId)
      .eq("organization_id", q.organizationId)
      .maybeSingle();
    if (upd.error) return { ok: false, motivo: "erro" };
  }
  return { ok: true };
}

export async function revogarVinculoSessaoEmpresarial(
  db: ClienteCadastro,
  q: { organizationId: string; sessionId: string },
): Promise<ResultadoVinculoEmpresarial> {
  if (!idNaoVazio(q.organizationId) || !idNaoVazio(q.sessionId)) {
    return { ok: false, motivo: "erro" };
  }
  const upd = await cadeia(db.from("delegacao_sessoes_empresariais"))
    .update({ revoked_at: new Date().toISOString() })
    .eq("channel_session_id", q.sessionId)
    .eq("organization_id", q.organizationId)
    .is("revoked_at", null)
    .maybeSingle();
  if (upd.error) return { ok: false, motivo: "erro" };
  return { ok: true };
}
