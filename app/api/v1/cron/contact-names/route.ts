/**
 * contact-names — copia para a ficha o nome salvo na agenda do celular.
 *
 * O webhook só entrega o apelido do perfil. Contato salvo no aparelho, sem
 * apelido, chega na inbox como telefone — medido na caixa de uma instalação
 * real: a lista mostra `+55…` para gente que no celular tem nome. A agenda
 * não viaja na mensagem; ela se pergunta ao canal, como a foto e o telefone
 * do id opaco.
 *
 * Carimba mesmo sem nome. Sem isso os mesmos primeiros N voltariam em toda
 * rodada e quem está no fim da fila nunca seria perguntado. Quem já tem
 * `name` (digitado na ficha ou vindo da planilha) fica de fora: esse nome
 * foi escolhido aqui e a agenda não o substitui.
 *
 * Auth: Bearer INTERNAL_SECRET (fail-closed), igual aos demais crons.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { autorizaCron } from "@/lib/auth/cron-auth";
import {
  CHANNEL_SESSION_REF_COLUMNS,
  DEFAULT_CHANNEL_PROVIDER,
  getAdapter,
  resolveSessionRef,
  type ChannelProvider,
  type ChannelSessionRef,
} from "@/lib/channels";
import { patchDoNome, REVISITA_NOME_MS } from "@/lib/contacts/nome-da-agenda";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Contatos por invocação. Cada um pode ser mais de uma chamada ao canal. */
const SCAN_LIMIT = 10;

interface ContactRow {
  id: string;
  organization_id: string;
  phone_number: string | null;
  wa_lid: string | null;
  wa_identity: string | null;
  name: string | null;
  display_name: string | null;
}

function lidDe(c: ContactRow): string | null {
  if (c.wa_lid) return c.wa_lid;
  if (c.wa_identity?.startsWith("lid:")) return c.wa_identity.slice("lid:".length);
  return null;
}

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - REVISITA_NOME_MS).toISOString();

  const { data: contatos, error: queryError } = await admin
    .from("contacts")
    .select("id, organization_id, phone_number, wa_lid, wa_identity, name, display_name")
    .is("name", null)
    .eq("kind", "person")
    .eq("is_anonymized", false)
    .is("is_merged_into", null)
    .or(`name_lookup_at.is.null,name_lookup_at.lt.${cutoff}`)
    .order("name_lookup_at", { ascending: true, nullsFirst: true })
    .limit(SCAN_LIMIT);

  if (queryError) {
    logger.error("[contact-names] query failed", { detail: queryError.message, requestId });
    return fail("internal_error", queryError.message, 500, { requestId });
  }

  const rows = (contatos ?? []) as ContactRow[];
  let preenchidos = 0;
  let semNome = 0;
  let semCanal = 0;

  for (const c of rows) {
    const carimbar = async (extra: { name?: string; display_name?: string }): Promise<boolean> => {
      const { data: afetadas } = await admin
        .from("contacts")
        .update({
          ...extra,
          name_lookup_at: new Date().toISOString(),
        })
        .eq("id", c.id)
        .eq("organization_id", c.organization_id)
        .eq("is_anonymized", false)
        // A ficha pode ter ganhado nome entre a seleção e esta gravação
        // (edição na tela, planilha). Não substituir.
        .is("name", null)
        .select("id");
      return (afetadas ?? []).length > 0;
    };

    const { data: conversa } = await admin
      .from("conversations")
      .select(`channel_sessions:channel_session_id (${CHANNEL_SESSION_REF_COLUMNS}, status, archived_at)`)
      .eq("organization_id", c.organization_id)
      .eq("contact_id", c.id)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    const sessaoDaConversa = (conversa as { channel_sessions?: unknown } | null)?.channel_sessions as
      | (ChannelSessionRef & { status: string | null; archived_at: string | null })
      | null
      | undefined;

    const s =
      sessaoDaConversa && !sessaoDaConversa.archived_at && sessaoDaConversa.status === "WORKING"
        ? (sessaoDaConversa as ChannelSessionRef)
        : null;
    const sessionRef = s ? resolveSessionRef(s) : null;
    const adapter = s ? getAdapter((s.provider ?? DEFAULT_CHANNEL_PROVIDER) as ChannelProvider) : null;
    if (!s || !sessionRef || !adapter?.resolveAddressBookName) {
      await carimbar({});
      semCanal++;
      continue;
    }

    let achado: { agenda: string | null; perfil: string | null } | null = null;
    try {
      achado = await adapter.resolveAddressBookName({
        organizationId: c.organization_id,
        sessionRef,
        phone: c.phone_number,
        lid: lidDe(c),
      });
    } catch (err) {
      logger.warn("[contact-names] lookup falhou", {
        contactId: c.id,
        detail: err instanceof Error ? err.message : "erro",
        requestId,
      });
    }

    const extra = achado ? patchDoNome(c, achado) : {};
    const gravou = await carimbar(extra);
    if ((extra.name || extra.display_name) && gravou) preenchidos++;
    else semNome++;
  }

  if (preenchidos > 0) {
    void audit({
      action: "contact.address_book_name_filled",
      organizationId: null,
      bypassedRls: true,
      requestId,
      metadata: { preenchidos, varridos: rows.length },
    });
  }

  return ok({ varridos: rows.length, preenchidos, sem_nome: semNome, sem_canal: semCanal }, { requestId });
}

export const GET = handle;
export const POST = handle;
