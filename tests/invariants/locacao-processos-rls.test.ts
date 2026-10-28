import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { countAs, sql } from "./gov-helpers";

/**
 * Fases 3 / 3.5 / 3b / 4 (0763–0770): membro lê a linha da própria org e zero
 * da outra; authenticated não escreve; sem SECURITY DEFINER exposta a
 * authenticated. Sem dado pessoal: nomes e ids desta suíte são de teste.
 */
const orgA = randomUUID(), orgB = randomUUID();
const membroA = randomUUID(), membroB = randomUUID();
const imovelA = randomUUID(), imovelB = randomUUID();
const procA = randomUUID(), procB = randomUUID();
const partA = randomUUID(), partB = randomUUID();
const convA = randomUUID(), convB = randomUUID();
const sessA = randomUUID(), sessB = randomUUID();
const contactA = randomUUID(), contactB = randomUUID();
const execA = randomUUID(), execB = randomUUID();
const sha = "ab".repeat(32);

const TABELAS = [
  "locacao_imoveis",
  "locacao_processos",
  "locacao_processo_participantes",
  "locacao_processo_conversas",
  "locacao_processo_fichas",
  "locacao_processo_eventos",
  "locacao_analises_fc",
  "locacao_analises_seguro",
  "contato_superlogica_vinculos",
  "superlogica_vinculo_execucoes",
  "superlogica_vinculo_revisoes",
  "locacao_processo_documentos",
] as const;

beforeAll(() => {
  sql(`insert into auth.users (id, email) values ('${membroA}', 'loc-a@invariant.test'), ('${membroB}', 'loc-b@invariant.test');`);
  for (const [org, sess, membro, contact, conv, imovel, proc, part, execucao] of [
    [orgA, sessA, membroA, contactA, convA, imovelA, procA, partA, execA],
    [orgB, sessB, membroB, contactB, convB, imovelB, procB, partB, execB],
  ] as const) {
    sql(`
      insert into organizations (id, slug, legal_name, display_name)
        values ('${org}', '${org}', 'Locacao', 'Locacao');
      insert into user_organizations (user_id, organization_id, role, accepted_at)
        values ('${membro}', '${org}', 'admin', now());
      insert into channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
        values ('${sess}', '${org}', '${sess}', '\\x00');
      insert into contacts (id, organization_id, display_name)
        values ('${contact}', '${org}', 'Contato');
      insert into conversations (id, organization_id, contact_id, channel_session_id, status, is_group)
        values ('${conv}', '${org}', '${contact}', '${sess}', 'open', false);
      insert into locacao_imoveis (id, organization_id, logradouro, chave_endereco)
        values ('${imovel}', '${org}', 'Rua teste', 'rua-teste');
      insert into locacao_processos (id, organization_id, imovel_id, status)
        values ('${proc}', '${org}', '${imovel}', 'lead');
      insert into locacao_processo_participantes (id, organization_id, processo_id, contact_id, papel)
        values ('${part}', '${org}', '${proc}', '${contact}', 'contato');
      insert into locacao_processo_conversas (organization_id, processo_id, conversation_id, origem)
        values ('${org}', '${proc}', '${conv}', 'criacao');
      insert into locacao_processo_fichas (organization_id, processo_id, versao, origem, ficha)
        values ('${org}', '${proc}', 1, 'atendente', '{}'::jsonb);
      insert into locacao_processo_eventos (organization_id, processo_id, tipo, ator_tipo)
        values ('${org}', '${proc}', 'status', 'sistema');
      insert into locacao_analises_fc (organization_id, processo_id, participante_id, pedido_id, estado)
        values ('${org}', '${proc}', '${part}', '${randomUUID()}', 'solicitada');
      insert into locacao_analises_seguro (organization_id, processo_id, participante_id, pedido_id, estado)
        values ('${org}', '${proc}', '${part}', '${randomUUID()}', 'solicitada');
      insert into superlogica_vinculo_execucoes (id, organization_id, modo, estado)
        values ('${execucao}', '${org}', 'simulacao', 'concluida');
      insert into contato_superlogica_vinculos (organization_id, contact_id, superlogica_pessoa_id, origem, execucao_id)
        values ('${org}', '${contact}', '1', 'casamento_telefone', '${execucao}');
      insert into superlogica_vinculo_revisoes (organization_id, execucao_id, contact_id, categoria, estado)
        values ('${org}', '${execucao}', '${contact}', 'unico_exato', 'ligado');
      insert into locacao_processo_documentos (
        organization_id, processo_id, participante_id, categoria, storage_path, mime, tamanho_bytes, sha256, origem
      ) values (
        '${org}', '${proc}', '${part}', 'relatorio',
        '${org}/processos/${proc}/relatorio.pdf', 'application/pdf', 1, '${sha}', 'relatorio'
      );
    `);
  }
});

describe("locacao processos: RLS e escrita", () => {
  it.each(TABELAS)("%s: membro lê a própria organização e zero da outra", (tabela) => {
    expect(countAs(membroA, `select count(*) from ${tabela} where organization_id = '${orgA}';`)).toBeGreaterThan(0);
    expect(countAs(membroA, `select count(*) from ${tabela} where organization_id = '${orgB}';`)).toBe(0);
    expect(countAs(membroB, `select count(*) from ${tabela} where organization_id = '${orgA}';`)).toBe(0);
    expect(countAs(membroB, `select count(*) from ${tabela} where organization_id = '${orgB}';`)).toBeGreaterThan(0);
  });

  it.each(TABELAS)("%s: authenticated e anon não escrevem; service_role escreve", (tabela) => {
    expect(
      sql(`select has_table_privilege('authenticated','public.${tabela}','insert'),
        has_table_privilege('authenticated','public.${tabela}','update'),
        has_table_privilege('authenticated','public.${tabela}','delete'),
        has_table_privilege('anon','public.${tabela}','select'),
        has_table_privilege('service_role','public.${tabela}','insert');`),
    ).toBe("f|f|f|f|t");
  });

  it("authenticated não insere processo na própria organização", () => {
    expect(() =>
      sql(`set role authenticated;
        select set_config('request.jwt.claims', '{"sub":"${membroA}"}', false);
        insert into locacao_processos (organization_id, imovel_id)
          values ('${orgA}', '${imovelA}');`),
    ).toThrow(/permission denied/);
  });

  it("índice único impede duas cotações em andamento no mesmo processo", () => {
    expect(() =>
      sql(`insert into locacao_analises_seguro (organization_id, processo_id, pedido_id, estado)
            values ('${orgA}', '${procA}', '${randomUUID()}', 'solicitada');`),
    ).toThrow(/duplicate|unique/i);
  });

  it("aceita evento renda e relatorio; recusa contratar", () => {
    sql(`insert into locacao_processo_eventos (organization_id, processo_id, tipo, ator_tipo)
          values ('${orgA}', '${procA}', 'renda', 'sistema'),
                 ('${orgA}', '${procA}', 'relatorio', 'sistema');`);
    expect(
      sql(`select count(*) from locacao_processo_eventos
            where processo_id = '${procA}' and tipo in ('renda','relatorio');`),
    ).toBe("2");
    expect(() =>
      sql(`insert into locacao_processo_eventos (organization_id, processo_id, tipo, ator_tipo)
            values ('${orgA}', '${procA}', 'contratar', 'sistema');`),
    ).toThrow(/check|violat/i);
  });

  it("aceita origem manual na ficha, manual_assistido no documento e login_necessario na FC", () => {
    sql(`insert into locacao_processo_fichas (organization_id, processo_id, versao, origem, ficha)
          values ('${orgA}', '${procA}', 2, 'manual', '{}'::jsonb);`);
    sql(`insert into locacao_processo_documentos (
            organization_id, processo_id, participante_id, categoria, storage_path, mime, tamanho_bytes, sha256, origem
          ) values (
            '${orgA}', '${procA}', '${partA}', 'laudo_fc',
            '${orgA}/processos/${procA}/manual.pdf', 'application/pdf', 1, '${"cd".repeat(32)}', 'manual_assistido'
          );`);
    sql(`insert into locacao_analises_fc (organization_id, processo_id, participante_id, pedido_id, estado, origem)
          values ('${orgA}', '${procA}', '${partA}', '${randomUUID()}', 'login_necessario', 'manual');`);
    expect(
      sql(`select count(*) from locacao_processo_fichas where processo_id = '${procA}' and origem = 'manual';`),
    ).toBe("1");
  });

  it("funções de locação SECURITY DEFINER não estão concedidas a authenticated nem anon", () => {
    expect(
      sql(`select count(*) from information_schema.routine_privileges
        where routine_schema = 'public'
          and routine_name in (
            'fn_expurgar_processos_de_locacao_vencidos',
            'fn_expurgar_revisoes_de_vinculo_vencidas',
            'fn_encerrar_processos_de_locacao_parados'
          )
          and privilege_type = 'EXECUTE'
          and grantee in ('anon','authenticated','PUBLIC');`),
    ).toBe("0");
  });
});
