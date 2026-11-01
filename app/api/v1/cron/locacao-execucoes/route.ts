/**
 * GET/POST /api/v1/cron/locacao-execucoes
 *
 * Drena execuções de renda na fila. Sem mensagem a contato. Audita só quando
 * houve efeito (processou ou marcou timeout).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { processarAnaliseDeRenda } from "@/lib/locacao/analise/processar-renda";
import { MOTIVOS_RENDA } from "@/lib/locacao/analise/motivos-renda";
import {
  atualizarExecucao,
  listarExecucoesNaFila,
  listarExecucoesPresas,
} from "@/lib/locacao/execucoes";
import { idsDeOrgsParadas } from "@/lib/organizacao/operante";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }
  const admin = createAdminClient();
  const paradas = new Set(await idsDeOrgsParadas(admin));
  const naFila = (await listarExecucoesNaFila(admin, { aba: "renda", limite: 5 }))
    .filter((e) => !paradas.has(e.organization_id));
  const presas = (await listarExecucoesPresas(admin, { aba: "renda", minutos: 10, limite: 5 }))
    .filter((e) => !paradas.has(e.organization_id));

  let processadas = 0;
  let erros = 0;
  let timeouts = 0;

  for (const presa of presas) {
    await atualizarExecucao(admin, {
      orgId: presa.organization_id,
      execucaoId: presa.id,
      estado: "erro",
      erroCodigo: "timeout",
      erroMotivo: MOTIVOS_RENDA.timeout,
      etapaTexto: MOTIVOS_RENDA.timeout,
    });
    timeouts += 1;
  }

  const orgIds = [...new Set(naFila.map((e) => e.organization_id))];
  const settingsPorOrg = new Map<string, unknown>();
  if (orgIds.length > 0) {
    const { data: orgs } = await admin.from("organizations").select("id,settings").in("id", orgIds);
    for (const o of orgs ?? []) {
      settingsPorOrg.set((o as { id: string }).id, (o as { settings: unknown }).settings);
    }
  }

  for (const row of naFila) {
    const settings = settingsPorOrg.get(row.organization_id);
    try {
      const r = await processarAnaliseDeRenda(admin, row, settings);
      if (r.ok) processadas += 1;
      else erros += 1;
    } catch (err) {
      erros += 1;
      logger.warn("[locacao-execucoes] falha ao processar", {
        organization_id: row.organization_id,
        execucao_id: row.id,
        motivo: err instanceof Error ? err.name : "erro",
      });
      await atualizarExecucao(admin, {
        orgId: row.organization_id,
        execucaoId: row.id,
        estado: "erro",
        erroCodigo: "internal_error",
        erroMotivo: MOTIVOS_RENDA.documentos,
        etapaTexto: MOTIVOS_RENDA.documentos,
      });
    }
  }

  const efeito = processadas + erros + timeouts;
  if (efeito > 0) {
    void audit({
      action: "locacao.execucoes_renda",
      organizationId: null,
      bypassedRls: true,
      requestId,
      metadata: { processadas, erros, timeouts, scanned: naFila.length + presas.length },
    });
  }
  return ok(
    { scanned: naFila.length + presas.length, processadas, erros, timeouts },
    { requestId },
  );
}
