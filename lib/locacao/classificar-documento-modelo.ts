/**
 * Classificação residual por modelo, só quando a ficha e o texto já extraído
 * não bastam. Reusa o caminho configurado de `visao_de_imagem` (padrão da
 * org — Gemini neste fork) e o texto já lido. Não baixa arquivo, não relê
 * a imagem, não loga conteúdo.
 */
import { generateText } from "ai";

import { validarParProvedorModelo } from "@/lib/ai/par-provedor-modelo";
import { PONTO_VISAO_DE_IMAGEM } from "@/lib/ai/pontos/registro";
import { registrarChamadaDeIa } from "@/lib/ai/usage/registrar-chamada";
import { resolveOrgLlmConfig } from "@/lib/agent-engine/edge/llm/credentials";
import { createDefaultRegistry } from "@/lib/agent-engine/edge/llm/providers";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { categoriaValida } from "@/lib/locacao/classificar-documento";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CategoriaDeDocumento } from "@/lib/locacao/vocabulario";
import type { LlmEdgeConfig } from "@/lib/agent-engine/edge/llm/run-model-call";

export const TETO_TEXTO_CLASSIFICACAO = 2_000;
export const TETO_CHAMADAS_POR_LISTA = 3;

export const PROMPT_CLASSIFICACAO_DE_DOCUMENTO =
  "Classifique o tipo deste arquivo de um processo de locação. "
  + "Responda exatamente uma palavra: documento_pessoal, comprovante_renda ou outro. "
  + "documento_pessoal = RG, CNH, identidade ou passaporte. "
  + "comprovante_renda = holerite, contracheque, extrato ou informe de rendimentos. "
  + "Não transcreva nomes, números nem o conteúdo.";

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

export function textoParaClassificar(nome: string, texto: string): string {
  const nomeLimpo = nome.replace(/[^\p{L}\p{N}._-]+/gu, " ").trim().slice(0, 80);
  const corpo = texto.replace(/\d{3,}/g, "").slice(0, TETO_TEXTO_CLASSIFICACAO);
  return `arquivo: ${nomeLimpo || "anexo"}\n${corpo}`.trim();
}

export async function classificarDocumentoComModelo(entrada: {
  organizationId: string;
  nomeArquivo: string;
  textoDerivado: string;
  llmCfg: LlmEdgeConfig;
  admin?: ReturnType<typeof createAdminClient>;
}): Promise<CategoriaDeDocumento | null> {
  const recorte = textoParaClassificar(entrada.nomeArquivo, entrada.textoDerivado);
  if (recorte.length < 8) return null;
  const admin = entrada.admin ?? createAdminClient();
  try {
    const binding = await bindingDeVisao(admin, entrada.organizationId);
    let llm = await resolveOrgLlmConfig(
      getRequestPool(),
      entrada.llmCfg,
      entrada.organizationId,
      binding ? { provider: binding.provider, credentialId: binding.credential_id } : undefined,
    );
    if (binding) llm = { ...llm, defaultModel: binding.model_id };
    const modelo = llm.defaultModel ?? "";
    const par = validarParProvedorModelo(llm.provider, modelo);
    if (!par.valido) return null;
    const factory = createDefaultRegistry()[llm.provider];
    if (!factory) return null;
    const inicio = Date.now();
    const res = await generateText({
      model: factory(llm.apiKey, modelo, binding?.base_url ?? undefined),
      messages: [{
        role: "user",
        content: `${PROMPT_CLASSIFICACAO_DE_DOCUMENTO}\n\n${recorte}`,
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
    const palavra = (res.text ?? "").trim().toLowerCase().split(/\s+/)[0] ?? "";
    return categoriaValida(palavra);
  } catch {
    logger.warn("[locacao-documentos] classificacao residual falhou", {
      organization_id: entrada.organizationId,
    });
    return null;
  }
}
