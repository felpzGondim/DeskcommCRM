/**
 * GET/POST /api/v1/cron/locacao-drive-copia — Fase 3b.
 *
 * Copia documentos `drive_status=pendente` para o Drive compartilhado. No-op
 * quando a chave da organização (`locacao.drive_habilitado`, desligada) ou a
 * credencial de ambiente está ausente. Nunca apaga, nunca manda para a
 * lixeira. Nunca loga JSON de conta de serviço, nome, CPF ou telefone.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { arquivosLigados, driveLigado, processosLigados } from "@/lib/locacao/chaves";
import { tabelaLocacao } from "@/lib/locacao/admin";
import { credencialDriveConfigurada, podeEnviarAoDrive } from "@/lib/locacao/drive";
import { createAdminClient } from "@/lib/supabase/admin";

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
  if (!credencialDriveConfigurada()) {
    return ok({ scanned: 0, copiados: 0, motivo: "credencial_ausente" }, { requestId });
  }
  const admin = createAdminClient();
  const { data: orgs } = await admin.from("organizations").select("id,settings").limit(50);
  let scanned = 0;
  const copiados = 0;
  for (const org of orgs ?? []) {
    const settings = (org as { settings: unknown }).settings;
    const orgId = (org as { id: string }).id;
    if (!podeEnviarAoDrive({
      processos: processosLigados(settings),
      arquivos: arquivosLigados(settings),
      drive: driveLigado(settings),
    })) continue;
    const { data: pendentes } = await tabelaLocacao(admin, "locacao_processo_documentos")
      .select("id")
      .eq("organization_id", orgId).eq("drive_status", "pendente")
      .lte("drive_proxima_em", new Date().toISOString())
      .limit(10);
    scanned += (pendentes ?? []).length;
    // Ensaio: sem envio real nesta versão. Marcar tentado sem copiar exigiria
    // a conferência do Drive; deixamos pendente. O cron existe para o scheduler
    // não recusar rota nova, e para o operador ligar a chave com segurança.
  }
  if (copiados > 0) {
    void audit({
      action: "locacao.drive_copia",
      organizationId: null, bypassedRls: true, requestId,
      metadata: { scanned, copiados },
    });
  }
  return ok({ scanned, copiados, motivo: copiados === 0 ? "ensaio" : "ok" }, { requestId });
}
