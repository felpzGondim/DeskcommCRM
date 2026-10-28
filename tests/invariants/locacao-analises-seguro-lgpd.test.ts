import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "./gov-helpers";

/**
 * 0770: virar is_anonymized (e apagar o contato) zera cotação, FC e rascunho
 * do relatório do locatário. Gatilho INVOKER em contacts, não a função única.
 * Sem dado pessoal real: ids e textos desta suíte são de teste.
 */
const org = randomUUID();
const alvo = randomUUID();
const vizinho = randomUUID();
const extra = randomUUID();
const sess = randomUUID();
const convAlvo = randomUUID();
const convVizinho = randomUUID();
const imovel = randomUUID();
const procAlvo = randomUUID();
const procVizinho = randomUUID();
const partAlvo = randomUUID();
const partVizinho = randomUUID();
const partExtra = randomUUID();
const pedidoAlvo = randomUUID();
const pedidoVizinho = randomUUID();
const pedidoFcAlvo = randomUUID();
const user = randomUUID();

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values ('${user}', 'loc-lgpd@invariant.test');
    insert into organizations (id, slug, legal_name, display_name)
      values ('${org}', '${org}', 'Locacao LGPD', 'Locacao LGPD');
    insert into channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
      values ('${sess}', '${org}', '${sess}', '\\x00');
    insert into contacts (id, organization_id, display_name)
      values ('${alvo}', '${org}', 'Alvo'), ('${vizinho}', '${org}', 'Vizinho'), ('${extra}', '${org}', 'Extra');
    insert into conversations (id, organization_id, contact_id, channel_session_id, status, is_group)
      values ('${convAlvo}', '${org}', '${alvo}', '${sess}', 'open', false),
             ('${convVizinho}', '${org}', '${vizinho}', '${sess}', 'open', false);
    insert into locacao_imoveis (id, organization_id, logradouro, chave_endereco)
      values ('${imovel}', '${org}', 'Rua teste', 'rua-teste-lgpd');
    insert into locacao_processos (id, organization_id, imovel_id, status, relatorio_rascunho)
      values ('${procAlvo}', '${org}', '${imovel}', 'analise', 'rascunho do alvo'),
             ('${procVizinho}', '${org}', '${imovel}', 'analise', 'rascunho do vizinho');
    insert into locacao_processo_participantes (id, organization_id, processo_id, contact_id, papel)
      values ('${partAlvo}', '${org}', '${procAlvo}', '${alvo}', 'locatario'),
             ('${partVizinho}', '${org}', '${procVizinho}', '${vizinho}', 'locatario'),
             ('${partExtra}', '${org}', '${procAlvo}', '${extra}', 'contato');
    insert into locacao_analises_seguro (organization_id, processo_id, participante_id, pedido_id, estado, resultado)
      values ('${org}', '${procAlvo}', '${partAlvo}', '${pedidoAlvo}', 'concluida', '{"seguradora":"porto"}'::jsonb),
             ('${org}', '${procVizinho}', '${partVizinho}', '${pedidoVizinho}', 'concluida', '{"seguradora":"tokio"}'::jsonb);
    insert into locacao_analises_fc (organization_id, processo_id, participante_id, pedido_id, estado, resultado, cpf_hash)
      values ('${org}', '${procAlvo}', '${partAlvo}', '${pedidoFcAlvo}', 'concluida', '{"score":1}'::jsonb, 'abc');
  `);
});

describe("locacao analises: cascata LGPD", () => {
  it("o gatilho de exclusão está instalado em contacts", () => {
    expect(
      sql(`select tgname from pg_trigger
            where tgrelid = 'public.contacts'::regclass
              and tgname = 'trg_locacao_limpar_contato_excluido'
              and not tgisinternal;`),
    ).toBe("trg_locacao_limpar_contato_excluido");
  });

  it("anonimizar o locatário zera cotação, FC e rascunho só daquele processo", () => {
    sql(`update public.contacts set is_anonymized = true, anonymized_at = now() where id = '${alvo}';`);
    expect(
      sql(`select coalesce(resultado::text,'') || '|' || coalesce(cpf_hash,'')
             from locacao_analises_fc where pedido_id = '${pedidoFcAlvo}';`),
    ).toBe("|");
    expect(
      sql(`select coalesce(resultado::text,'') from locacao_analises_seguro where pedido_id = '${pedidoAlvo}';`),
    ).toBe("");
    expect(
      sql(`select coalesce(relatorio_rascunho,'') from locacao_processos where id = '${procAlvo}';`),
    ).toBe("");
    expect(
      sql(`select resultado->>'seguradora' from locacao_analises_seguro where pedido_id = '${pedidoVizinho}';`),
    ).toBe("tokio");
    expect(
      sql(`select relatorio_rascunho from locacao_processos where id = '${procVizinho}';`),
    ).toBe("rascunho do vizinho");
  });

  it("apagar um contato só-conversa não zera a cotação do locatário", () => {
    sql(`delete from public.contacts where id = '${extra}';`);
    expect(
      sql(`select resultado->>'seguradora' from locacao_analises_seguro where pedido_id = '${pedidoVizinho}';`),
    ).toBe("tokio");
    expect(
      sql(`select count(*) from locacao_processo_participantes where id = '${partExtra}';`),
    ).toBe("1");
  });

  it("a retenção de 90 dias zera cotação e rascunho (corpo instalado)", () => {
    const corpo = sql(`select pg_get_functiondef('public.fn_expurgar_processos_de_locacao_vencidos(int,int)'::regprocedure);`);
    expect(corpo).toContain("locacao_analises_seguro");
    expect(corpo).toContain("relatorio_rascunho");
  });
});
