/**
 * Chaves liga/desliga das Fases 3, 3.5 e 3b. Moram em
 * `organizations.settings`. Ausente = desligado. Rollback = gravar `false`;
 * as tabelas ficam.
 *
 * Padrões sujeitos à revisão do Felipe estão documentados em
 * `docs/decisoes/locacao-fases-3-3b.md`.
 */
import { z } from "zod";

const uuid = z.string().uuid();

export const locacaoSettingsSchema = z.object({
  processos_habilitado: z.boolean().optional().default(false),
  arquivos_habilitado: z.boolean().optional().default(false),
  drive_habilitado: z.boolean().optional().default(false),
  /** Ids de quem pode APROVAR. Vazio = só platform admin (Felipe). */
  aprovador_user_ids: z.array(uuid).max(20).optional().default([]),
}).passthrough();

export const superlogicaVinculoSettingsSchema = z.object({
  habilitado: z.boolean().optional().default(false),
  /**
   * Padrão sujeito à revisão do Felipe (Fase 3.5, pergunta 1 = a):
   * só únicos exatos ligam sozinhos.
   */
  ligar_unico_exato: z.boolean().optional().default(true),
}).passthrough();

export type LocacaoSettings = z.infer<typeof locacaoSettingsSchema>;
export type SuperlogicaVinculoSettings = z.infer<typeof superlogicaVinculoSettingsSchema>;

export function lerLocacaoSettings(settings: unknown): LocacaoSettings {
  const bruto = settings && typeof settings === "object"
    ? (settings as Record<string, unknown>).locacao
    : undefined;
  const lido = locacaoSettingsSchema.safeParse(bruto ?? {});
  return lido.success ? lido.data : locacaoSettingsSchema.parse({});
}

export function lerSuperlogicaVinculoSettings(settings: unknown): SuperlogicaVinculoSettings {
  const bruto = settings && typeof settings === "object"
    ? (settings as Record<string, unknown>).superlogica_vinculo
    : undefined;
  const lido = superlogicaVinculoSettingsSchema.safeParse(bruto ?? {});
  return lido.success ? lido.data : superlogicaVinculoSettingsSchema.parse({});
}

export function processosLigados(settings: unknown): boolean {
  return lerLocacaoSettings(settings).processos_habilitado === true;
}

export function arquivosLigados(settings: unknown): boolean {
  return lerLocacaoSettings(settings).arquivos_habilitado === true;
}

export function driveLigado(settings: unknown): boolean {
  const loc = lerLocacaoSettings(settings);
  return loc.processos_habilitado === true
    && loc.arquivos_habilitado === true
    && loc.drive_habilitado === true;
}

export function vinculoLigado(settings: unknown): boolean {
  return lerSuperlogicaVinculoSettings(settings).habilitado === true;
}

export function ehAprovador(
  userId: string,
  isPlatformAdminFull: boolean,
  settings: unknown,
): boolean {
  if (isPlatformAdminFull) return true;
  const ids = lerLocacaoSettings(settings).aprovador_user_ids;
  return ids.includes(userId);
}
