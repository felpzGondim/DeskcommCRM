import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "./gov-helpers";

/**
 * Virar is_anonymized redige pergunta/resposta do registro do painel.
 * Gatilho INVOKER em contacts (0769), não a função única da cascata.
 */
const org = randomUUID();
const alvo = randomUUID();
const vizinho = randomUUID();
const sess = randomUUID();
const convAlvo = randomUUID();
const convVizinho = randomUUID();
const logAlvo = randomUUID();
const logVizinho = randomUUID();
const user = randomUUID();

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values ('${user}', 'painel-lgpd@invariant.test');
    insert into organizations (id, slug, legal_name, display_name)
      values ('${org}', '${org}', 'Painel LGPD', 'Painel LGPD');
    insert into channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
      values ('${sess}', '${org}', '${sess}', '\\x00');
    insert into contacts (id, organization_id, display_name)
      values ('${alvo}', '${org}', 'Alvo'), ('${vizinho}', '${org}', 'Vizinho');
    insert into conversations (id, organization_id, contact_id, channel_session_id, status, is_group)
      values ('${convAlvo}', '${org}', '${alvo}', '${sess}', 'open', false),
             ('${convVizinho}', '${org}', '${vizinho}', '${sess}', 'open', false);
    insert into agent_panel_query_log
      (id, organization_id, conversation_id, contact_id, user_id, pergunta, resposta, ferramentas, propostas, modo, status)
      values
        ('${logAlvo}', '${org}', '${convAlvo}', '${alvo}', '${user}',
          'qual a renda da Maria?', 'Renda preliminar 4000', '[{"nome":"ler_conversa"}]'::jsonb, '[]'::jsonb, 'normal', 'pronto'),
        ('${logVizinho}', '${org}', '${convVizinho}', '${vizinho}', '${user}',
          'qual o aluguel?', '1200', '[]'::jsonb, '[]'::jsonb, 'normal', 'pronto');
  `);
});

describe("agent_panel_query_log: cascata LGPD", () => {
  it("anonimizar o contato redige pergunta e resposta só daquele contato", () => {
    sql(`update public.contacts set is_anonymized = true, anonymized_at = now() where id = '${alvo}';`);
    expect(
      sql(`select pergunta || '|' || coalesce(resposta,'') || '|' || ferramentas::text
        from agent_panel_query_log where id = '${logAlvo}';`),
    ).toBe("(anonimizado)|(anonimizado)|[]");
    expect(
      sql(`select pergunta from agent_panel_query_log where id = '${logVizinho}';`),
    ).toBe("qual o aluguel?");
  });
});
