/**
 * Leitura documental de foto/página — o mesmo ponto `visao_de_imagem` do
 * painel de Provedores, com prompt de EXTRAIR texto, não de descrever a cena.
 * Não grava o texto no banco (isso é Fase 3). Não loga o conteúdo.
 */
import { generateText } from "ai";

import { validarParProvedorModelo } from "@/lib/ai/par-provedor-modelo";
import { PONTO_VISAO_DE_IMAGEM } from "@/lib/ai/pontos/registro";
import { registrarChamadaDeIa } from "@/lib/ai/usage/registrar-chamada";
import { resolveOrgLlmConfig, type LlmEdgeConfig } from "@/lib/agent-engine/edge/llm/credentials";
import { createDefaultRegistry } from "@/lib/agent-engine/edge/llm/providers";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const PROMPT_LEITURA_DOCUMENTAL =
  "Extraia TODO o texto visível deste documento (RG, holerite, comprovante, extrato ou contrato). " +
  "Transcreva números, nomes de campos, datas e valores como aparecem. " +
  "Não descreva a cena, o fundo nem a qualidade da foto. " +
  "Se não houver texto legível, responda exatamente: (sem texto documental).";

export type ResultadoLeituraDocumental =
  | { ok: true; texto: string }
  | { ok: false; motivo: "sem_provedor" | "falha" };

export type ArquivoDaVisao = { buffer: Buffer; mime: string };

export type LerDocumentoFn = (entrada: {
  organizationId: string;
  buffer: Buffer;
  mime: string;
  mais?: ArquivoDaVisao[];
}) => Promise<ResultadoLeituraDocumental>;

async function bindingDeVisao(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
): Promise<{ provider: string; model_id: string; credential_id: string | null; base_url: string | null } | null> {
  const { data, error } = await admin
    .from("ai_purpose_bindings")
    .select("provider, model_id, credential_id, base_url")
    .eq("organization_id", organizationId)
    .eq("purpose", PONTO_VISAO_DE_IMAGEM)
    .eq("is_enabled", true)
    .maybeSingle();
  if (error) return null;
  return data ?? null;
}

export async function lerDocumentoPorVisao(entrada: {
  organizationId: string;
  buffer: Buffer;
  mime: string;
  mais?: ArquivoDaVisao[];
  admin?: ReturnType<typeof createAdminClient>;
  llmCfg: LlmEdgeConfig;
}): Promise<ResultadoLeituraDocumental> {
  const admin = entrada.admin ?? createAdminClient();
  const mime = entrada.mime.split(";")[0]!.trim().toLowerCase();
  try {
    const binding = await bindingDeVisao(admin, entrada.organizationId);
    let llm = await resolveOrgLlmConfig(getRequestPool(), entrada.llmCfg, entrada.organizationId, binding
      ? { provider: binding.provider, credentialId: binding.credential_id } : undefined);
    if (binding) llm = { ...llm, defaultModel: binding.model_id };
    const modelo = llm.defaultModel ?? "";
    const par = validarParProvedorModelo(llm.provider, modelo);
    if (!par.valido) return { ok: false, motivo: "sem_provedor" };
    const factory = createDefaultRegistry()[llm.provider];
    if (!factory) return { ok: false, motivo: "sem_provedor" };
    const inicio = Date.now();
    const extras = (entrada.mais ?? []).map((a) => ({
      type: "file" as const,
      data: a.buffer,
      mediaType: a.mime.split(";")[0]!.trim().toLowerCase(),
    }));
    const res = await generateText({
      model: factory(llm.apiKey, modelo, binding?.base_url ?? undefined),
      messages: [{
        role: "user",
        content: [
          { type: "text", text: PROMPT_LEITURA_DOCUMENTAL },
          { type: "file", data: entrada.buffer, mediaType: mime },
          ...extras,
        ],
      }],
    });
    void registrarChamadaDeIa(admin, {
      organization_id: entrada.organizationId,
      purpose: PONTO_VISAO_DE_IMAGEM,
      provider: llm.provider,
      model: modelo,
      input_tokens: res.usage.inputTokens ?? 0,
      output_tokens: res.usage.outputTokens ?? 0,
      cost_cents: null,
      latency_ms: Date.now() - inicio,
    });
    const texto = (res.text ?? "").trim();
    if (!texto || texto === "(sem texto documental)") return { ok: false, motivo: "falha" };
    return { ok: true, texto };
  } catch (err) {
    logger.warn("[painel-anexos] leitura documental falhou", {
      organization_id: entrada.organizationId,
      mime,
      motivo: err instanceof Error ? err.name : "erro",
    });
    return { ok: false, motivo: "falha" };
  }
}
