import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/contacts/import — importa contatos de planilha CSV.
 *
 * Formato aceito: CSV RFC 4180 com linha de cabeçalho (delimitador detectado
 * automaticamente entre vírgula, ponto-e-vírgula e tabulação — Excel pt-BR
 * exporta ";"). Colunas reconhecidas e apelidos em `lib/contacts/csv.ts`.
 * XLSX é recusado na borda com instrução de exportar como CSV.
 *
 * Desfecho POR LINHA, nunca do lote inteiro:
 *   - linha inválida é pulada com motivo nominal (vem no response);
 *   - contato que já existe (telefone/e-mail/CPF da org) é contado como
 *     duplicado, não como erro — A MENOS que o operador ligue
 *     `atualizar_existentes` (off por padrão, o comportamento de sempre);
 *   - com a opção ligada, telefone já cadastrado PREENCHE o nome principal
 *     só quando ele está vazio; nome preenchido e diferente vira conflito e
 *     só substitui com `substituir_contact_ids` (confirmação explícita);
 *   - as demais linhas seguem mesmo se uma falhar — uma planilha de 400 nomes
 *     não pode morrer inteira pelo telefone malformado da linha 7.
 *
 * Insert é linha a linha de propósito: `contacts` tem índices únicos parciais
 * (org+phone/org+email/org+cpf) e um insert em lote viraria tudo-ou-nada —
 * o 23505 de UM conflito descartaria as outras centenas criadas.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { audit } from "@/lib/audit";
import { camposCpfParaGravar } from "@/lib/contacts/cpf";
import { traduzir } from "@/lib/i18n/dicionario";
import {
  CSV_MAX_BYTES,
  CSV_MAX_DATA_ROWS,
  decodificarCsv,
  mapHeader,
  mapLinha,
  parseCsv,
} from "@/lib/contacts/csv";
import { contactCreateSchemaDoPais } from "@/lib/schemas";
import { perfilDaOrganizacao } from "@/lib/legal/perfil-do-pais";
import { phoneLookupVariants } from "@/lib/channels/phone-variants";
import {
  type ConflitoDeNome,
  decidirAtualizacaoDeNome,
  formMarcouAtualizar,
  lerIdsDeSubstituicao,
  nomePrincipalVazio,
} from "@/lib/contacts/atualizar-nome-na-importacao";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const SOURCE_IMPORT_CSV = "import_csv";

interface LinhaErro {
  linha: number;
  motivo: string;
}

interface ImportSummary {
  total_linhas: number;
  imported: number;
  updated: number;
  skipped_duplicates: number;
  conflicts: ConflitoDeNome[];
  errors: LinhaErro[];
}

interface ContatoExistente {
  id: string;
  name: string | null;
  is_merged_into: string | null;
  is_anonymized: boolean;
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const supabase = await createClient();
  // spec 13 §4: escrita é agent+ (viewer é read-only), igual ao POST unitário.
  const authz = await requireRole("agent", { requestId, resource: "contacts" });
  if (!authz.ok) return authz.response;
  const user = authz.user;
  const orgId = authz.org.orgId;
  const t = (texto: string) => traduzir(texto, user.idioma);

  // O documento do titular, na régua do PAÍS da organização (issue #1033): o
  // cabeçalho aceito, a normalização do valor e a validação saem daqui. O país
  // vem da coluna da organização — nunca do arquivo enviado.
  const perfil = await perfilDaOrganizacao(supabase, orgId);
  const doc = perfil.documento;
  const schemaDoPais = contactCreateSchemaDoPais(perfil);

  let file: File;
  let atualizarExistentes = false;
  let substituirIds = new Set<string>();
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (!(f instanceof File)) throw new Error("sem arquivo");
    file = f;
    atualizarExistentes = formMarcouAtualizar(form.get("atualizar_existentes"));
    substituirIds = lerIdsDeSubstituicao(form.get("substituir_contact_ids"));
    // Confirmação explícita de conflito é mais forte que o checkbox: quem
    // manda os ids já viu a lista e pediu para substituir.
    if (substituirIds.size > 0) atualizarExistentes = true;
  } catch {
    return fail(
      "validation_failed",
      t("Envie o arquivo como multipart/form-data no campo 'file'."),
      422,
      { requestId },
    );
  }

  const nome = file.name ?? "";
  const tipoOk =
    nome.toLowerCase().endsWith(".csv") ||
    file.type === "text/csv" ||
    file.type === "application/vnd.ms-excel";
  if (!tipoOk) {
    return fail(
      "validation_failed",
      t("Formato não suportado — envie um arquivo .csv. No Excel use 'Salvar como' → 'CSV UTF-8'."),
      422,
      { requestId },
    );
  }
  if (file.size > CSV_MAX_BYTES) {
    return fail(
      "validation_failed",
      t("Arquivo maior que ") + `${Math.floor(CSV_MAX_BYTES / 1024 / 1024)}MB.`,
      413,
      { requestId },
    );
  }

  // ─── Parse + validação de linhas (puro; nada tocou no banco ainda) ───────
  // Os BYTES, não `file.text()` — ver `decodificarCsv` (#483).
  const decodificado = decodificarCsv(await file.arrayBuffer());
  if ("erro" in decodificado) {
    return fail("validation_failed", t(decodificado.erro), 422, { requestId });
  }
  const text = decodificado.texto;
  const rows = parseCsv(text);
  if (rows.length < 2) {
    return fail("validation_failed", t("CSV vazio ou sem linhas de dados."), 422, { requestId });
  }
  const header = rows[0]!;
  const mapeado = mapHeader(header, t, doc);
  if (mapeado.motivo !== null) {
    return fail("validation_failed", `${t("Cabeçalho inválido:")} ${mapeado.motivo}.`, 422, {
      details: { header: header.join(", ") },
      requestId,
    });
  }
  const indices = mapeado.indices;

  const dataRows = rows.slice(1);
  if (dataRows.length > CSV_MAX_DATA_ROWS) {
    return fail(
      "validation_failed",
      `${t("Máximo de")} ${CSV_MAX_DATA_ROWS} ${t("linhas por importação — divida a planilha.")}`,
      422,
      { requestId },
    );
  }

  const candidatos: Array<{ linha: number; contato: Record<string, unknown> }> = [];
  const errors: LinhaErro[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const linha = i + 2; // 1-based contando o cabeçalho — bate com o editor de planilhas.
    const { contato, motivo } = mapLinha(dataRows[i]!, indices, t, doc, perfil.telefoneExemplo);
    if (motivo !== null) {
      errors.push({ linha, motivo });
      continue;
    }
    if (contato.cpf && !doc.valida(contato.cpf)) {
      // O texto sai do PERFIL: no Brasil continua "CPF inválido: …" (a mesma
      // chave do dicionário), e país sem checksum público diz na mensagem que a
      // conferência é de FORMA — prometer dígito verificado que não existe é o
      // que a issue #1033 proíbe.
      errors.push({ linha, motivo: t(doc.mensagemInvalido + ": ") + `"${contato.cpf}"` });
      continue;
    }
    const parsed = schemaDoPais.safeParse({ ...contato, source: SOURCE_IMPORT_CSV });
    if (!parsed.success) {
      const primeiro = parsed.error.issues[0];
      errors.push({ linha, motivo: primeiro?.message ?? t("dados inválidos") });
      continue;
    }
    candidatos.push({ linha, contato: parsed.data as Record<string, unknown> });
  }

  if (candidatos.length === 0) {
    const resumo: ImportSummary = {
      total_linhas: dataRows.length,
      imported: 0,
      updated: 0,
      skipped_duplicates: 0,
      conflicts: [],
      errors,
    };
    return ok(resumo, { requestId });
  }

  // ─── Pré-filtro de duplicados contra o banco (uma query por identificador) ──
  //
  // Os índices únicos são parciais (excluem mesclados/anonimizados), então a
  // busca espelha o WHERE do índice — filtrar pelo que o índice não cobre
  // produziria "duplicado" imaginário. A organização vem da sessão, nunca do
  // arquivo: um telefone igual em outra org não aparece aqui.
  const phones = candidatos
    .map((c) => c.contato.phone_number as string | undefined)
    .filter((p): p is string => typeof p === "string");
  const emails = candidatos
    .map((c) => c.contato.email as string | undefined)
    .filter((e): e is string => typeof e === "string");

  const existentes = new Set<string>();
  const porTelefone = new Map<string, ContatoExistente>();
  if (phones.length > 0) {
    const lookup = [...new Set(phones.flatMap((p) => phoneLookupVariants(p)))];
    const { data } = await supabase
      .from("contacts")
      .select("id, name, phone_number, is_merged_into, is_anonymized")
      .eq("organization_id", orgId)
      .not("phone_number", "is", null)
      .in("phone_number", lookup);
    for (const r of data ?? []) {
      const row = r as {
        id: string;
        name: string | null;
        phone_number: string;
        is_merged_into: string | null;
        is_anonymized: boolean | null;
      };
      const existente: ContatoExistente = {
        id: row.id,
        name: row.name,
        is_merged_into: row.is_merged_into,
        is_anonymized: row.is_anonymized === true,
      };
      for (const v of phoneLookupVariants(row.phone_number)) {
        existentes.add(`tel:${v}`);
        porTelefone.set(v, existente);
      }
    }
  }
  if (emails.length > 0) {
    const { data } = await supabase
      .from("contacts")
      .select("email_normalized")
      .eq("organization_id", orgId)
      .in("email_normalized", emails.map((e) => e.toLowerCase()));
    for (const r of data ?? []) existentes.add(`email:${(r as { email_normalized: string }).email_normalized}`);
  }

  // ─── Insert/atualização linha a linha com desfecho individual ─────────────
  let imported = 0;
  let updated = 0;
  let skippedDuplicates = 0;
  const conflicts: ConflitoDeNome[] = [];
  // Passo de confirmação: só aplica os ids que a tela listou. Não cria de
  // novo nem preenche nome vazio — isso já rodou no primeiro envio.
  const soConfirmacao = substituirIds.size > 0;

  for (const { linha, contato } of candidatos) {
    const phone = contato.phone_number as string | undefined;
    const email = contato.email as string | undefined;
    const existentePorTel = phone
      ? phoneLookupVariants(phone).map((v) => porTelefone.get(v)).find((c): c is ContatoExistente => !!c)
      : undefined;

    if (existentePorTel) {
      const desfecho = await aplicarNomeEmExistente({
        supabase,
        orgId,
        userId: user.id,
        requestId,
        linha,
        existente: existentePorTel,
        nomePlanilha: typeof contato.name === "string" ? contato.name : null,
        atualizarExistentes,
        substituirIds,
        soConfirmacao,
        conflicts,
      });
      if (desfecho === "updated") updated += 1;
      else if (desfecho === "skipped" || desfecho === "conflict") {
        if (desfecho === "skipped") skippedDuplicates += 1;
      } else if (desfecho === "erro") {
        errors.push({ linha, motivo: "Não foi possível atualizar o nome deste contato." });
      }
      continue;
    }

    if (soConfirmacao) {
      // Confirmação não cria contato novo: o primeiro passo já o teria criado.
      continue;
    }

    // Só contatos existentes ou gravados com sucesso reservam identificadores.
    // Cada repetição chega aqui para ter desfecho; uma linha inválida ou que
    // falhou no insert não pode descartar outra válida do mesmo arquivo.
    if (email && existentes.has(`email:${email.toLowerCase()}`)) {
      skippedDuplicates += 1;
      continue;
    }

    const insertRow: Record<string, unknown> = {
      organization_id: orgId,
      created_by_user_id: user.id,
      name: contato.name ?? null,
      display_name: contato.display_name ?? null,
      email: contato.email ?? null,
      phone_number: contato.phone_number ?? null,
      birthdate: contato.birthdate ?? null,
      tags: contato.tags ?? [],
      source: SOURCE_IMPORT_CSV,
      source_metadata: {},
      consent: {},
    };
    if (contato.cpf) {
      // LGPD: hash (dedupe) e versão cifrada nascem JUNTOS — o CHECK
      // `contacts_cpf_consistency` recusa a linha se só um dos dois existir
      // (#2522). Sem cifra disponível a linha segue SEM CPF, em vez de voltar
      // em `errors` e parar a reimportação inteira.
      Object.assign(insertRow, await camposCpfParaGravar(supabase, contato.cpf as string));
    }

    const { data: criado, error: insErr } = await supabase
      .from("contacts")
      .insert(insertRow)
      .select("id, display_name, phone_number")
      .single();

    if (insErr) {
      // Conflito de corrida com os índices únicos = duplicado, não erro.
      if (insErr.code === "23505") {
        skippedDuplicates += 1;
        continue;
      }
      errors.push({ linha, motivo: insErr.message });
      continue;
    }

    imported += 1;
    if (phone) {
      existentes.add(`tel:${phone}`);
      const recem: ContatoExistente = {
        id: (criado as { id: string }).id,
        name: typeof contato.name === "string" ? contato.name : null,
        is_merged_into: null,
        is_anonymized: false,
      };
      for (const v of phoneLookupVariants(phone)) porTelefone.set(v, recem);
    }
    if (email) existentes.add(`email:${email.toLowerCase()}`);

    // Mesmo evento do create unitário — quem consome `contact.created`
    // (workers, métricas) trata importado e manual igual.
    await supabase
      .rpc("emit_event", {
        p_event_type: "contact.created",
        p_entity_kind: "contact",
        p_entity_id: (criado as { id: string }).id,
        p_payload: {
          source: SOURCE_IMPORT_CSV,
          has_email: !!contato.email,
          has_phone: !!contato.phone_number,
          has_cpf: !!contato.cpf,
        },
        p_metadata: { request_id: requestId, actor_type: "user" },
        p_organization_id: orgId,
      })
      .then(({ error }) => {
        if (error) console.error("[contacts.import] emit_event failed", error.message);
      });
  }

  await audit({
    action: "contacts.imported",
    actorUserId: user.id,
    organizationId: orgId,
    resourceType: "contact",
    resourceId: null,
    requestId,
    metadata: {
      actor_type: "user",
      total_linhas: dataRows.length,
      imported,
      updated,
      skipped_duplicates: skippedDuplicates,
      conflicts: conflicts.length,
      erros: errors.length,
    },
  });

  const resumo: ImportSummary = {
    total_linhas: dataRows.length,
    imported,
    updated,
    skipped_duplicates: skippedDuplicates,
    conflicts,
    errors,
  };
  return ok(resumo, { requestId });
}

type ClienteDaSessao = Awaited<ReturnType<typeof createClient>>;

async function aplicarNomeEmExistente(e: {
  supabase: ClienteDaSessao;
  orgId: string;
  userId: string;
  requestId: string;
  linha: number;
  existente: ContatoExistente;
  nomePlanilha: string | null;
  atualizarExistentes: boolean;
  substituirIds: Set<string>;
  soConfirmacao: boolean;
  conflicts: ConflitoDeNome[];
}): Promise<"updated" | "skipped" | "conflict" | "erro"> {
  // Mesclado ou anonimizado não é identidade viva — não reescreve.
  if (e.existente.is_merged_into || e.existente.is_anonymized) return "skipped";

  if (e.soConfirmacao) {
    if (!e.substituirIds.has(e.existente.id)) return "skipped";
    const nomeConfirmado = e.nomePlanilha;
    if (nomePrincipalVazio(nomeConfirmado) || !nomeConfirmado) return "skipped";
    const gravou = await gravarNomePrincipal(e.supabase, e.orgId, e.existente.id, nomeConfirmado);
    if (!gravou) return "erro";
    e.existente.name = nomeConfirmado;
    await auditarAtualizacaoDeNome(e);
    return "updated";
  }

  if (!e.atualizarExistentes) return "skipped";

  const decisao = decidirAtualizacaoDeNome(e.existente.name, e.nomePlanilha);
  if (decisao.tipo === "sem_nome_novo" || decisao.tipo === "mesmo") return "skipped";
  if (decisao.tipo === "conflito") {
    e.conflicts.push({
      linha: e.linha,
      contact_id: e.existente.id,
      nome_atual: (e.existente.name ?? "").trim(),
      nome_planilha: (e.nomePlanilha ?? "").trim(),
    });
    return "conflict";
  }

  const nomeNovo = e.nomePlanilha;
  if (!nomeNovo) return "skipped";
  const gravou = await gravarNomePrincipal(e.supabase, e.orgId, e.existente.id, nomeNovo);
  if (!gravou) return "erro";
  e.existente.name = nomeNovo;
  await auditarAtualizacaoDeNome(e);
  return "updated";
}

async function gravarNomePrincipal(
  supabase: ClienteDaSessao,
  orgId: string,
  contactId: string,
  nome: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("contacts")
    .update({ name: nome })
    .eq("organization_id", orgId)
    .eq("id", contactId)
    .is("is_merged_into", null)
    .eq("is_anonymized", false)
    .select("id")
    .maybeSingle();
  return !error && !!data;
}

async function auditarAtualizacaoDeNome(e: {
  userId: string;
  orgId: string;
  existente: ContatoExistente;
  requestId: string;
}): Promise<void> {
  await audit({
    action: "contact.updated",
    actorUserId: e.userId,
    organizationId: e.orgId,
    resourceType: "contact",
    resourceId: e.existente.id,
    requestId: e.requestId,
    metadata: {
      actor_type: "user",
      origem: "import_csv",
      campo: "name",
    },
  });
}
