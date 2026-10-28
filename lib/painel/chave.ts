/**
 * Chave de ligar as ferramentas do campo /pergunta do Painel do agente.
 * Mora em `organizations.settings.painel_agente`. Ausente = desligado.
 * A migration NÃO liga nada: produção fica no comportamento de hoje.
 */
import { z } from "zod";

export const painelAgenteSettingsSchema = z
  .object({
    ferramentas_habilitado: z.boolean().optional().default(false),
  })
  .passthrough();

export type PainelAgenteSettings = z.infer<typeof painelAgenteSettingsSchema>;

export function lerPainelAgenteSettings(settings: unknown): PainelAgenteSettings {
  const bruto =
    settings && typeof settings === "object"
      ? (settings as Record<string, unknown>).painel_agente
      : undefined;
  const lido = painelAgenteSettingsSchema.safeParse(bruto ?? {});
  return lido.success ? lido.data : painelAgenteSettingsSchema.parse({});
}

/** Campo /pergunta com tool calling. Botões NÃO dependem desta chave. */
export function ferramentasDoPainelLigadas(settings: unknown): boolean {
  return lerPainelAgenteSettings(settings).ferramentas_habilitado === true;
}
