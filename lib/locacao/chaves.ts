/**
 * Chaves liga/desliga das Fases 3, 3.5, 3b e 4. Moram em
 * `organizations.settings`. Ausente = desligado. Rollback = gravar `false`;
 * as tabelas ficam. As migrations 0770 e 0771 NÃO ligam nada.
 *
 * Padrões sujeitos à revisão do Felipe estão documentados em
 * `docs/decisoes/locacao-fases-3-3b.md`, `docs/decisoes/locacao-fase4-analise.md`
 * e `docs/decisoes/locacao-valores-imovel.md`.
 */
import { z } from "zod";

import type { ChaveDaAnalise } from "@/lib/locacao/vocabulario";

const uuid = z.string().uuid();

export const locacaoAnaliseSettingsSchema = z.object({
  renda: z.boolean().optional().default(false),
  seguro: z.boolean().optional().default(false),
  fc: z.boolean().optional().default(false),
  relatorio: z.boolean().optional().default(false),
  manual: z.boolean().optional().default(false),
});

/** PATCH parcial: sem default, para não apagar as outras chaves. */
export const locacaoAnalisePatchSchema = z.object({
  renda: z.boolean().optional(),
  seguro: z.boolean().optional(),
  fc: z.boolean().optional(),
  relatorio: z.boolean().optional(),
  manual: z.boolean().optional(),
});

export const locacaoSettingsSchema = z.object({
  processos_habilitado: z.boolean().optional().default(false),
  arquivos_habilitado: z.boolean().optional().default(false),
  drive_habilitado: z.boolean().optional().default(false),
  /** Ids de quem pode APROVAR. Vazio = só platform admin (Felipe). */
  aprovador_user_ids: z.array(uuid).max(20).optional().default([]),
  /** Fase 4. Todas false. Sem preço da FC (a confirmação só avisa créditos). */
  analise: locacaoAnaliseSettingsSchema.default({
    renda: false,
    seguro: false,
    fc: false,
    relatorio: false,
    manual: false,
  }),
  /**
   * GET Superlógica para aluguel/condomínio/IPTU/seguro-incêndio do 3×.
   * Desligada: não há cliente HTTP neste repo (o Hub é quem lê a API).
   */
  pacote_superlogica_habilitado: z.boolean().optional().default(false),
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

/**
 * Cada chave da Fase 4 exige processos ligados. Ausente ou false = a
 * ferramenta some do botão e do ToolSet (PRs 4.1–4.5).
 */
export function analiseLigada(settings: unknown, chave: ChaveDaAnalise): boolean {
  const loc = lerLocacaoSettings(settings);
  return loc.processos_habilitado === true && loc.analise[chave] === true;
}

export function pacoteSuperlogicaLigado(settings: unknown): boolean {
  return lerLocacaoSettings(settings).pacote_superlogica_habilitado === true;
}
