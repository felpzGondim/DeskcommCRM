// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { hashCpf } from "@/lib/contacts/cpf";
import { requireSupportWrite } from "@/lib/impersonate/support";
import type { PerfilDoPais } from "@/lib/legal/perfil-do-pais";
import { PERFIS_DO_PAIS } from "@/lib/legal/perfil-do-pais";
import { createClient } from "@/lib/supabase/server";
import { POST } from "./route";

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const ORG = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";
const PHONE = "+5511999998888";

interface Resumo {
  total_linhas: number;
  imported: number;
  filled: number;
  replaced: number;
  updated: number;
  skipped_duplicates: number;
  preview: boolean;
  errors: Array<{ linha: number; motivo: string }>;
}

const VAZIO = {
  filled: 0,
  replaced: 0,
  updated: 0,
  preview: false,
};

/** Só as fronteiras externas são dubladas; multipart, CSV e schemas são reais. */
function banco(opcoes: {
  existentes?: Array<{
    id?: string;
    phone_number?: string;
    email_normalized?: string;
    name?: string | null;
    is_merged_into?: string | null;
    is_anonymized?: boolean;
    organization_id?: string;
  }>;
  falhas?: Array<{ code: string; message: string } | null>;
  /** O país declarado pela organização; ausente/`null` é o Brasil. */
  pais?: string | null;
  /** A RPC `encrypt_cpf` não responde — banco sem a migration 0597 ou sem a chave. */
  cifraIndisponivel?: boolean;
} = {}) {
  const tentativas: Record<string, unknown>[] = [];
  const atualizacoes: Array<{ id: string; organizationId: string; patch: Record<string, unknown> }> = [];
  // `encrypt_cpf` (migration 0597) devolve o ciphertext; sem ele,
  // `camposCpfParaGravar` grava a linha SEM CPF. `cifraIndisponivel` encena o
  // banco em que a RPC ainda não existe ou a chave não foi semeada (#2522).
  const rpc = vi.fn(async (nome: string) => {
    if (nome !== "encrypt_cpf") return { error: null };
    if (opcoes.cifraIndisponivel) return { error: { message: "encrypt_cpf RPC unavailable" } };
    return { data: new Uint8Array([1, 2, 3]), error: null };
  });
  const from = vi.fn((tabela: string) => {
    // A régua do documento vem do PAÍS da organização (issue #1033): a rota lê a
    // organização UMA vez, na entrada. O dublê libera só essa leitura e segue
    // fechando a porta para qualquer outra tabela.
    if (tabela === "organizations") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(async () => ({ data: { country: opcoes.pais ?? null }, error: null })),
      };
    }
    expect(tabela).toBe("contacts");
    let idPendente: string | null = null;
    let orgPendente: string | null = null;
    let patchPendente: Record<string, unknown> | null = null;
    const consulta = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn((coluna: string, valor: unknown) => {
        if (coluna === "organization_id") orgPendente = String(valor);
        if (coluna === "id") idPendente = String(valor);
        return consulta;
      }),
      not: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      in: vi.fn(async (coluna: "phone_number" | "email_normalized", valores: string[]) => {
        expect(consulta.eq).toHaveBeenCalledWith("organization_id", ORG);
        return {
          data: (opcoes.existentes ?? []).filter((r) => {
            if (r.organization_id && r.organization_id !== ORG) return false;
            return valores.includes((r[coluna] as string | undefined) ?? "");
          }),
          error: null,
        };
      }),
      insert: vi.fn((linha: Record<string, unknown>) => {
        tentativas.push(linha);
        return consulta;
      }),
      update: vi.fn((patch: Record<string, unknown>) => {
        patchPendente = patch;
        return consulta;
      }),
      single: vi.fn(async () => ({
        data: { id: `contato-${tentativas.length}` },
        error: opcoes.falhas?.[tentativas.length - 1] ?? null,
      })),
      maybeSingle: vi.fn(async () => {
        if (patchPendente && idPendente && orgPendente) {
          atualizacoes.push({ id: idPendente, organizationId: orgPendente, patch: patchPendente });
        }
        const id = idPendente;
        patchPendente = null;
        idPendente = null;
        return { data: id ? { id } : null, error: null };
      }),
    };
    return consulta;
  });
  vi.mocked(createClient).mockResolvedValue({ from, rpc } as never);
  return { tentativas, atualizacoes, rpc };
}

async function importar(
  linhas: string[],
  extra: { atualizar?: boolean; confirmar?: boolean; csv?: string } = {},
): Promise<Resumo> {
  const form = new FormData();
  form.set("file", new File(
    [extra.csv ?? ["nome,telefone,email", ...linhas].join("\n")],
    "contatos.csv",
    { type: "text/csv" },
  ));
  if (extra.atualizar) form.set("atualizar_existentes", "true");
  if (extra.confirmar) form.set("confirmar", "true");
  const resposta = await POST(new NextRequest("http://localhost/api/v1/contacts/import", {
    method: "POST",
    body: form,
  }));
  expect(resposta.status).toBe(200);
  const { data } = await resposta.json() as { data: Resumo };
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSupportWrite).mockResolvedValue(null);
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: {
      id: USER,
      email: "operador@example.com",
      full_name: "Operador",
      avatar_url: null,
      is_platform_admin: false,
      idioma: "pt-BR",
      organizations: [{ organization_id: ORG, organization_name: "Org", role: "agent" }],
    },
    org: { orgId: ORG, name: "Org", role: "agent" },
  });
});

describe("POST /api/v1/contacts/import — desfecho por linha", () => {
  it.each([
    { caso: "telefone", linhas: [`Ana,${PHONE},`, `Ana,${PHONE},`, `Ana,${PHONE},`] },
    { caso: "e-mail sem telefone e sem distinguir maiúsculas", linhas: [
      "Ana,,ana@example.com", "Ana,,ANA@example.com", "Ana,,ana@example.com",
    ] },
    { caso: "e-mail compartilhado por telefones diferentes", linhas: [
      `Ana,${PHONE},ana@example.com`, "Ana,+5521999998888,ana@example.com", "Ana,,ana@example.com",
    ] },
  ])("contabiliza todas as repetições por $caso sem repetir insert/evento", async ({ linhas }) => {
    const db = banco();
    const resumo = await importar(linhas);

    expect(resumo).toEqual({ total_linhas: 3, imported: 1, skipped_duplicates: 2, errors: [], ...VAZIO });
    expect(db.tentativas).toHaveLength(1);
    expect(db.tentativas[0]).toMatchObject({
      organization_id: ORG, created_by_user_id: USER, source: "import_csv",
    });
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith("emit_event", expect.objectContaining({
      p_event_type: "contact.created", p_entity_id: "contato-1", p_organization_id: ORG,
    }));
    expect(audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      action: "contacts.imported",
      organizationId: ORG,
      metadata: {
        actor_type: "user",
        total_linhas: 3,
        imported: 1,
        filled: 0,
        replaced: 0,
        updated: 0,
        skipped_duplicates: 2,
        erros: 0,
      },
    }));
  });

  it("uma linha rejeitada pelo schema não impede a próxima com o mesmo telefone", async () => {
    const db = banco();
    const resumo = await importar([
      `Inválida,${PHONE},ana..silva@example.com`,
      `Corrigida,${PHONE},ana.silva@example.com`,
    ]);

    expect(resumo).toEqual({
      total_linhas: 2, imported: 1, skipped_duplicates: 0,
      errors: [{ linha: 2, motivo: expect.any(String) }],
      ...VAZIO,
    });
    expect(db.tentativas).toHaveLength(1);
    expect(db.tentativas[0]).toMatchObject({ name: "Corrigida", email: "ana.silva@example.com" });
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });

  it("continua após erro de gravação sem reservar o telefone da linha que falhou", async () => {
    const db = banco({ falhas: [{ code: "23514", message: "Falha de gravação" }, null] });
    const resumo = await importar([`Primeira,${PHONE},`, `Segunda,${PHONE},`]);

    expect(resumo).toEqual({
      total_linhas: 2, imported: 1, skipped_duplicates: 0,
      errors: [{ linha: 2, motivo: "Falha de gravação" }],
      ...VAZIO,
    });
    expect(db.tentativas).toHaveLength(2);
    expect(db.tentativas[1]).toMatchObject({ name: "Segunda", phone_number: PHONE });
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith("emit_event", expect.objectContaining({
      p_entity_id: "contato-2",
    }));
  });

  it("pular e-mail existente não reserva um telefone que ainda não foi importado", async () => {
    const db = banco({ existentes: [{ email_normalized: "existente@example.com" }] });
    const resumo = await importar([
      `Existente,${PHONE},existente@example.com`,
      `Nova,${PHONE},nova@example.com`,
    ]);

    expect(resumo).toEqual({ total_linhas: 2, imported: 1, skipped_duplicates: 1, errors: [], ...VAZIO });
    expect(db.tentativas).toHaveLength(1);
    expect(db.tentativas[0]).toMatchObject({ name: "Nova", email: "nova@example.com" });
  });

  it("conta cada linha que repete um contato já presente no banco", async () => {
    const db = banco({ existentes: [{ phone_number: PHONE }] });
    const resumo = await importar([`Ana,${PHONE},`, `Ana,${PHONE},`]);

    expect(resumo).toEqual({ total_linhas: 2, imported: 0, skipped_duplicates: 2, errors: [], ...VAZIO });
    expect(db.tentativas).toHaveLength(0);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("mantém o conflito de índice único como duplicado sem bloquear a próxima linha", async () => {
    const db = banco({ falhas: [{ code: "23505", message: "Conflito" }, null] });
    const resumo = await importar([`Ana,${PHONE},`, "Bia,+5521999998888,"]);

    expect(resumo).toEqual({ total_linhas: 2, imported: 1, skipped_duplicates: 1, errors: [], ...VAZIO });
    expect(db.tentativas).toHaveLength(2);
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/v1/contacts/import — a planilha segue o PAÍS da organização (issue #1033)", () => {
  /**
   * País sintético, e não um país de verdade: a issue #1033 proíbe publicar
   * citação de lei não revisada, e o registro é mutável justamente para o teste
   * provar o mecanismo sem publicar nada. Nada aqui é oferecido ao operador
   * (`paisesOferecidos` exige `revisada`), que é o ponto.
   */
  const PERFIL_DO_XISTAO: PerfilDoPais = {
    codigo: "XI",
    nome: "Xistão",
    // País sintético declara os SEUS rótulos de organização (#1946, item 4).
    empresa: { rotuloNomeLegal: "Razão do Xistão", rotuloNumero: "Registro do Xistão" },
    // País sintético declara os SEUS papéis legais (#2344).
    papel: { controlador: "Controlador do Xistão", encarregado: "Encarregado do Xistão" },
    telefoneExemplo: "+999000000000",
    documento: {
      rotulo: "Bilhete",
      exemplo: "123456789XI000",
      regra: "forma — 9 dígitos, 2 letras e 3 dígitos; não confere dígito verificador",
      mensagemInvalido: "Bilhete inválido",
      confereDigito: false,
      apelidosDoCabecalho: ["bilhete"],
      valida: (valor) => /^\d{9}[A-Z]{2}\d{3}$/.test(valor),
      normaliza: (valor) => valor.toUpperCase().replace(/[^0-9A-Z]/g, ""),
    },
    idioma: "xi-XI",
    fusoDoSugerido: "UTC",
    lei: { nome: "Lei do Xistão", numero: "Lei nº 1/2020", artigo: "Art. 5º", revisada: false },
    calendario: { feriados: [], rotulo: "feriados do Xistão" },
    padroesDePii: [],
  };

  beforeEach(() => {
    PERFIS_DO_PAIS.XI = PERFIL_DO_XISTAO;
  });

  afterEach(() => {
    delete PERFIS_DO_PAIS.XI;
  });

  async function importarCom(cabecalho: string, linhas: string[]) {
    const form = new FormData();
    form.set("file", new File(
      [[cabecalho, ...linhas].join("\n")],
      "contatos.csv",
      { type: "text/csv" },
    ));
    const resposta = await POST(new NextRequest("http://localhost/api/v1/contacts/import", {
      method: "POST",
      body: form,
    }));
    return { status: resposta.status, corpo: await resposta.json() as { data?: Resumo } };
  }

  it("aceita o cabeçalho do documento do país e grava o valor como o país normaliza", async () => {
    const db = banco({ pais: "XI" });
    const { status, corpo } = await importarCom("nome,telefone,bilhete", [`Ana,${PHONE},123456789xi000`]);

    expect(status).toBe(200);
    expect(corpo.data).toEqual({ total_linhas: 1, imported: 1, skipped_duplicates: 0, errors: [], ...VAZIO });
    // O documento não é gravado em claro: o que prova o valor (e a normalização
    // do país) é o hash — `hashCpf("123456789XI000")`, com o valor já em
    // maiúsculas e sem o que não é dígito nem letra.
    expect(db.tentativas[0]).toMatchObject({ cpf_hash: hashCpf("123456789XI000") });
    expect(db.rpc).toHaveBeenCalledWith("emit_event", expect.objectContaining({
      p_payload: expect.objectContaining({ has_cpf: true }),
    }));
  });

  it("diz na mensagem a régua do país — sem prometer dígito verificado que não existe", async () => {
    const db = banco({ pais: "XI" });
    const { corpo } = await importarCom("nome,telefone,bilhete", [`Ana,${PHONE},123`]);

    expect(corpo.data).toEqual({
      total_linhas: 1,
      imported: 0,
      skipped_duplicates: 0,
      errors: [{ linha: 2, motivo: expect.stringContaining("Bilhete inválido") }],
      ...VAZIO,
    });
    expect(corpo.data?.errors[0]?.motivo).not.toContain("CPF");
    expect(db.tentativas).toHaveLength(0);
  });

  it("sem país declarado nada muda para quem já usa: o Brasil de sempre", async () => {
    const db = banco();
    const { corpo } = await importarCom("nome,telefone,cpf", [`Ana,${PHONE},111.111.111-11`]);

    expect(corpo.data?.errors[0]?.motivo).toContain("CPF inválido");
    expect(db.tentativas).toHaveLength(0);
  });
});

describe("POST /api/v1/contacts/import — o CPF grava os DOIS campos ou nenhum (#2522)", () => {
  /** CPF do próprio exemplo da issue: dígitos verificadores válidos. */
  const CPF = "529.982.247-25";

  async function importarCpf(linhas: string[]) {
    const form = new FormData();
    form.set("file", new File(
      [["nome,telefone,cpf", ...linhas].join("\n")],
      "contatos.csv",
      { type: "text/csv" },
    ));
    const resposta = await POST(new NextRequest("http://localhost/api/v1/contacts/import", {
      method: "POST",
      body: form,
    }));
    return { status: resposta.status, corpo: await resposta.json() as { data?: Resumo } };
  }

  it("com a RPC no schema a linha nasce com hash E ciphertext", async () => {
    const db = banco();
    const { status, corpo } = await importarCpf([`Ana,${PHONE},${CPF}`]);

    expect(status).toBe(200);
    expect(corpo.data).toEqual({ total_linhas: 1, imported: 1, skipped_duplicates: 0, errors: [], ...VAZIO });
    expect(db.tentativas[0]).toMatchObject({
      cpf_hash: hashCpf(CPF),
      cpf_encrypted: expect.anything(),
    });
  });

  it("sem cifra disponível a linha é salva SEM CPF — nunca cpf_hash sozinho (#2522)", async () => {
    const db = banco({ cifraIndisponivel: true });
    const { status, corpo } = await importarCpf([`Ana,${PHONE},${CPF}`]);

    // O defeito reportado: a linha voltava em `errors` com
    // `violates check constraint "contacts_cpf_consistency"`. Agora ela entra.
    expect(status).toBe(200);
    expect(corpo.data).toEqual({ total_linhas: 1, imported: 1, skipped_duplicates: 0, errors: [], ...VAZIO });
    // Os DOIS ausentes: é a paridade que o CHECK cobra.
    expect(db.tentativas[0]).not.toHaveProperty("cpf_hash");
    expect(db.tentativas[0]).not.toHaveProperty("cpf_encrypted");
  });
});

const CONTATO_VAZIO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONTATO_CHEIO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONTATO_OUTRA_ORG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ORG_B = "33333333-3333-4333-8333-333333333333";

describe("POST /api/v1/contacts/import — atualizar nome de quem já existe", () => {
  it("sem a opção, o nome da planilha é descartado — o comportamento de sempre", async () => {
    const db = banco({
      existentes: [{ id: CONTATO_VAZIO, phone_number: PHONE, name: null }],
    });
    const resumo = await importar([`Maria da Silva,${PHONE},`]);

    expect(resumo).toEqual({
      total_linhas: 1, imported: 0, skipped_duplicates: 1, errors: [], ...VAZIO,
    });
    expect(db.atualizacoes).toHaveLength(0);
    expect(db.tentativas).toHaveLength(0);
  });

  it("com a opção e sem confirmar, a prévia conta e não grava", async () => {
    const novo = "+5531999990001";
    const db = banco({
      existentes: [
        { id: CONTATO_VAZIO, phone_number: PHONE, name: null },
        { id: CONTATO_CHEIO, phone_number: "+5521999998888", name: "Carlos" },
      ],
    });
    const resumo = await importar(
      [`Maria da Silva,${PHONE},`, `Carlos Silva,+5521999998888,`, `Nova,${novo},`],
      { atualizar: true },
    );

    expect(resumo).toMatchObject({
      total_linhas: 3,
      imported: 1,
      filled: 1,
      replaced: 1,
      updated: 2,
      preview: true,
      skipped_duplicates: 0,
      errors: [],
    });
    expect(db.atualizacoes).toHaveLength(0);
    expect(db.tentativas).toHaveLength(0);
    expect(audit).not.toHaveBeenCalled();
  });

  it("com a opção e confirmar, preenche o vazio e substitui o preenchido", async () => {
    const db = banco({
      existentes: [
        { id: CONTATO_VAZIO, phone_number: PHONE, name: null },
        { id: CONTATO_CHEIO, phone_number: "+5521999998888", name: "Carlos" },
      ],
    });
    const resumo = await importar(
      [`Maria da Silva,${PHONE},`, `Carlos Silva,+5521999998888,`],
      { atualizar: true, confirmar: true },
    );

    expect(resumo).toMatchObject({
      imported: 0, filled: 1, replaced: 1, updated: 2, preview: false, errors: [],
    });
    expect(db.atualizacoes).toEqual([
      { id: CONTATO_VAZIO, organizationId: ORG, patch: { name: "Maria da Silva" } },
      { id: CONTATO_CHEIO, organizationId: ORG, patch: { name: "Carlos Silva" } },
    ]);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "contact.updated",
      actorUserId: USER,
      organizationId: ORG,
      resourceId: CONTATO_VAZIO,
      metadata: { actor_type: "user", origem: "import_csv", campo: "name" },
    }));
    const doUpdate = vi.mocked(audit).mock.calls
      .map((c) => c[0])
      .find((e) => e.action === "contact.updated");
    expect(JSON.stringify(doUpdate)).not.toMatch(/Maria|Carlos|99999|@/);
  });

  it("nome já igual é pulado; o resumo conta criado / preenchido / substituído / pulado", async () => {
    const novo = "+5531999990001";
    const vazio = "+5531999990002";
    const troca = "+5531999990003";
    const igual = "+5531999990004";
    banco({
      existentes: [
        { id: CONTATO_VAZIO, phone_number: vazio, name: null },
        { id: CONTATO_CHEIO, phone_number: troca, name: "Bia" },
        { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", phone_number: igual, name: "Duda" },
      ],
    });
    const resumo = await importar(
      [
        `Nova,${novo},`,
        `Preenchida,${vazio},`,
        `Beatriz,${troca},`,
        `duda,${igual},`,
      ],
      { atualizar: true, confirmar: true },
    );

    expect(resumo).toMatchObject({
      total_linhas: 4,
      imported: 1,
      filled: 1,
      replaced: 1,
      updated: 2,
      skipped_duplicates: 1,
      preview: false,
    });
  });

  it("não atualiza contato de outra organização — o filtro é o da sessão", async () => {
    const db = banco({
      existentes: [
        {
          id: CONTATO_OUTRA_ORG,
          phone_number: PHONE,
          name: null,
          organization_id: ORG_B,
        },
      ],
    });
    const resumo = await importar([`Maria,${PHONE},`], { atualizar: true, confirmar: true });

    expect(resumo.imported).toBe(1);
    expect(resumo.updated).toBe(0);
    expect(db.atualizacoes).toHaveLength(0);
    expect(db.tentativas[0]).toMatchObject({ organization_id: ORG, name: "Maria" });
  });
});

describe("POST /api/v1/contacts/import — exportação do Google Contatos", () => {
  it("inglês: Name + Phone 1/2 e célula com ::: viram contatos distintos", async () => {
    const db = banco();
    const csv = [
      "Name,Given Name,Family Name,E-mail 1 - Value,Phone 1 - Value,Phone 2 - Value",
      '"Maria Souza","Maria","Souza",maria.souza.exemplo@example.com,"+55 11 90000-0001 ::: +55 11 90000-0002","+55 21 90000-0003"',
    ].join("\n");
    const resumo = await importar([], { csv });

    expect(resumo).toMatchObject({ total_linhas: 1, imported: 3, skipped_duplicates: 0, preview: false });
    expect(db.tentativas).toHaveLength(3);
    expect(db.tentativas.map((t) => t.phone_number)).toEqual([
      "+5511900000001",
      "+5511900000002",
      "+5521900000003",
    ]);
    expect(new Set(db.tentativas.map((t) => t.name))).toEqual(new Set(["Maria Souza"]));
  });

  it("português: Nome vazio junta as partes; Telefone N - Valor", async () => {
    const db = banco();
    const csv = [
      "Nome,Nome do meio,Sobrenome,Telefone 1 - Valor",
      ',"Pedro","Santos","(21) 91111-0002"',
    ].join("\n");
    const resumo = await importar([], { csv });

    expect(resumo.imported).toBe(1);
    expect(db.tentativas[0]).toMatchObject({
      name: "Pedro Santos",
      phone_number: "+5521911110002",
    });
  });
});
