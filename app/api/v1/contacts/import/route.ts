import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/contacts/import — importa contatos de planilha CSV.
 *
 * Formato aceito: CSV RFC 4180 com linha de cabeçalho (delimitador detectado
 * automaticamente entre vírgula, ponto-e-vírgula e tabulação — Excel pt-BR
 * exporta ";"). Colunas reconhecidas e apelidos em `lib/contacts/csv.ts`.
 * Exportação do Google Contatos (EN/PT) é detectada pelo cabeçalho
 * (`Name`/`Nome`, `Phone 1 - Value`/`Telefone 1 - Valor`, células com ` ::: `).
 * XLSX é recusado na borda com instrução de exportar como CSV.
 *
 * Desfecho POR LINHA, nunca do lote inteiro:
 *   - linha inválida é pulada com motivo nominal (vem no response);
 *   - contato que já existe é pulado — A MENOS que o operador ligue
 *     `atualizar_existentes` (off por padrão, o comportamento de sempre);
 *   - com a opção ligada, o primeiro POST é PRÉVIA (não grava): conta
 *     criados / preenchidos / substituídos. O segundo, com `confirmar`,
 *     grava. O nome da planilha SUBSTITUI o nome principal, inclusive o
 *     já preenchido. Sem confirmação nome a nome.
 *   - as demais linhas seguem mesmo se uma falhar.
 *
 * Insert é linha a linha de propósito: `contacts` tem índices únicos parciais
 * e um insert em lote viraria tudo-ou-nada.
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
  type LinhaNormalizada,
} from "@/lib/contacts/csv";
import { contactCreateSchemaDoPais } from "@/lib/schemas";
import { perfilDaOrganizacao } from "@/lib/legal/perfil-do-pais";
import { phoneLookupVariants } from "@/lib/channels/phone-variants";
import {
  decidirAtualizacaoDeNome,
  formMarcou,
} from "@/lib/contacts/atualizar-nome-na-importacao";
import {
  expandirLinhaGoogle,
  indicesGoogleContatos,
} from "@/lib/contacts/planilha-google";
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
  filled: number;
  replaced: number;
  updated: number;
  skipped_duplicates: number;
  preview: boolean;
  errors: LinhaErro[];
}

interface ContatoExistente {
  id: string;
  name: string | null;
  is_merged_into: string | null;
  is_anonymized: boolean;
}

function resumoVazio(total: number, errors: LinhaErro[], preview: boolean): ImportSummary {
  return {
    total_linhas: total,
    imported: 0,
    filled: 0,
    replaced: 0,
    updated: 0,
    skipped_duplicates: 0,
    preview,
    errors,
  };
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const supabase = await createClient();
  const authz = await requireRole("agent", { requestId, resource: "contacts" });
  if (!authz.ok) return authz.response;
  const user = authz.user;
  const orgId = authz.org.orgId;
  const t = (texto: string) => traduzir(texto, user.idioma);

  const perfil = await perfilDaOrganizacao(supabase, orgId);
  const doc = perfil.documento;
  const schemaDoPais = contactCreateSchemaDoPais(perfil);

  let file: File;
  let atualizarExistentes = false;
  let confirmar = false;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (!(f instanceof File)) throw new Error("sem arquivo");
    file = f;
    atualizarExistentes = formMarcou(form.get("atualizar_existentes"));
    confirmar = formMarcou(form.get("confirmar"));
  } catch {
    return fail(
      "validation_failed",
      t("Envie o arquivo como multipart/form-data no campo 'file'."),
      422,
      { requestId },
    );
  }

  const preview = atualizarExistentes && !confirmar;

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

  const decodificado = decodificarCsv(await file.arrayBuffer());
  if ("erro" in decodificado) {
    return fail("validation_failed", t(decodificado.erro), 422, { requestId });
  }
  const rows = parseCsv(decodificado.texto);
  if (rows.length < 2) {
    return fail("validation_failed", t("CSV vazio ou sem linhas de dados."), 422, { requestId });
  }
  const header = rows[0]!;
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
  const google = indicesGoogleContatos(header);

  if (google) {
    for (let i = 0; i < dataRows.length; i++) {
      const linha = i + 2;
      const { contatos, motivo } = expandirLinhaGoogle(dataRows[i]!, google, t);
      if (motivo !== null) {
        errors.push({ linha, motivo });
        continue;
      }
      for (const contato of contatos) {
        const aceito = aceitarCandidato(contato, linha, schemaDoPais, doc, t, errors);
        if (aceito) candidatos.push(aceito);
      }
    }
  } else {
    const mapeado = mapHeader(header, t, doc);
    if (mapeado.motivo !== null) {
      return fail("validation_failed", `${t("Cabeçalho inválido:")} ${mapeado.motivo}.`, 422, {
        details: { header: header.join(", ") },
        requestId,
      });
    }
    for (let i = 0; i < dataRows.length; i++) {
      const linha = i + 2;
      const { contato, motivo } = mapLinha(dataRows[i]!, mapeado.indices, t, doc, perfil.telefoneExemplo);
      if (motivo !== null) {
        errors.push({ linha, motivo });
        continue;
      }
      const aceito = aceitarCandidato(contato, linha, schemaDoPais, doc, t, errors);
      if (aceito) candidatos.push(aceito);
    }
  }

  if (candidatos.length === 0) {
    return ok(resumoVazio(dataRows.length, errors, preview), { requestId });
  }

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

  let imported = 0;
  let filled = 0;
  let replaced = 0;
  let skippedDuplicates = 0;

  function reservarIdentificadores(
    phone: string | undefined,
    email: string | undefined,
    name: string | null,
    id = `previsto-${imported}`,
  ): void {
    if (phone) {
      existentes.add(`tel:${phone}`);
      const recem: ContatoExistente = {
        id,
        name,
        is_merged_into: null,
        is_anonymized: false,
      };
      for (const v of phoneLookupVariants(phone)) porTelefone.set(v, recem);
    }
    if (email) existentes.add(`email:${email.toLowerCase()}`);
  }

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
        existente: existentePorTel,
        nomePlanilha: typeof contato.name === "string" ? contato.name : null,
        atualizarExistentes,
        gravar: !preview,
      });
      if (desfecho === "filled") filled += 1;
      else if (desfecho === "replaced") replaced += 1;
      else if (desfecho === "skipped") skippedDuplicates += 1;
      else if (desfecho === "erro") {
        errors.push({ linha, motivo: "Não foi possível atualizar o nome deste contato." });
      }
      continue;
    }

    if (email && existentes.has(`email:${email.toLowerCase()}`)) {
      skippedDuplicates += 1;
      continue;
    }

    if (preview) {
      imported += 1;
      reservarIdentificadores(phone, email, typeof contato.name === "string" ? contato.name : null);
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
      Object.assign(insertRow, await camposCpfParaGravar(supabase, contato.cpf as string));
    }

    const { data: criado, error: insErr } = await supabase
      .from("contacts")
      .insert(insertRow)
      .select("id, display_name, phone_number")
      .single();

    if (insErr) {
      if (insErr.code === "23505") {
        skippedDuplicates += 1;
        continue;
      }
      errors.push({ linha, motivo: insErr.message });
      continue;
    }

    imported += 1;
    reservarIdentificadores(
      phone,
      email,
      typeof contato.name === "string" ? contato.name : null,
      (criado as { id: string }).id,
    );

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

  const updated = filled + replaced;
  if (!preview) {
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
        filled,
        replaced,
        updated,
        skipped_duplicates: skippedDuplicates,
        erros: errors.length,
      },
    });
  }

  const resumo: ImportSummary = {
    total_linhas: dataRows.length,
    imported,
    filled,
    replaced,
    updated,
    skipped_duplicates: skippedDuplicates,
    preview,
    errors,
  };
  return ok(resumo, { requestId });
}

type SchemaDoPais = ReturnType<typeof contactCreateSchemaDoPais>;
type DocDoPais = Awaited<ReturnType<typeof perfilDaOrganizacao>>["documento"];

function aceitarCandidato(
  contato: LinhaNormalizada,
  linha: number,
  schemaDoPais: SchemaDoPais,
  doc: DocDoPais,
  t: (texto: string) => string,
  errors: LinhaErro[],
): { linha: number; contato: Record<string, unknown> } | null {
  if (contato.cpf && !doc.valida(contato.cpf)) {
    errors.push({ linha, motivo: t(doc.mensagemInvalido + ": ") + `"${contato.cpf}"` });
    return null;
  }
  const parsed = schemaDoPais.safeParse({ ...contato, source: SOURCE_IMPORT_CSV });
  if (!parsed.success) {
    const primeiro = parsed.error.issues[0];
    errors.push({ linha, motivo: primeiro?.message ?? t("dados inválidos") });
    return null;
  }
  return { linha, contato: parsed.data as Record<string, unknown> };
}

type ClienteDaSessao = Awaited<ReturnType<typeof createClient>>;

async function aplicarNomeEmExistente(e: {
  supabase: ClienteDaSessao;
  orgId: string;
  userId: string;
  requestId: string;
  existente: ContatoExistente;
  nomePlanilha: string | null;
  atualizarExistentes: boolean;
  gravar: boolean;
}): Promise<"filled" | "replaced" | "skipped" | "erro"> {
  if (e.existente.is_merged_into || e.existente.is_anonymized) return "skipped";
  if (!e.atualizarExistentes) return "skipped";

  const decisao = decidirAtualizacaoDeNome(e.existente.name, e.nomePlanilha);
  if (decisao.tipo === "sem_nome_novo" || decisao.tipo === "mesmo") return "skipped";

  const nomeNovo = e.nomePlanilha;
  if (!nomeNovo) return "skipped";

  if (e.gravar) {
    const gravou = await gravarNomePrincipal(e.supabase, e.orgId, e.existente.id, nomeNovo);
    if (!gravou) return "erro";
    e.existente.name = nomeNovo;
    await auditarAtualizacaoDeNome(e);
  }

  return decisao.tipo === "preencher" ? "filled" : "replaced";
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
