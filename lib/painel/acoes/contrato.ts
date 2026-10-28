/**
 * Preparar (L, só prévia) e confirmar (S, clique humano) o contrato.
 * Confirmar grava na Superlógica pelo Hub — o loop do modelo NUNCA chama isto.
 */
import { createHash } from "node:crypto";

import {
  abrirContrato,
  chamarApiContrato,
  dadosContratoSchema,
  ErroApiContrato,
  preparoContratoSchema,
  resultadoContratoSchema,
  selarContrato,
  type DadosContrato,
} from "@/lib/agent-engine/agent/painel-contrato";
import { env } from "@/lib/env";
import { carregarServidorMcpExterno } from "@/lib/mcp/servidor-externo/carregar";
import { mascararPessoaNoTexto } from "@/lib/painel/mascarar";
import type { ContextoDaFerramenta, ResultadoDaFerramenta } from "@/lib/painel/ferramentas/tipos";
import { z } from "zod";

export class FalhaDoContrato extends Error {
  constructor(
    readonly codigo: "tool_unavailable" | "hub_unavailable" | "idempotency_conflict",
    message: string,
  ) {
    super(message);
    this.name = "FalhaDoContrato";
  }
}

async function destinoDoHub(ctx: ContextoDaFerramenta) {
  const hub = await carregarServidorMcpExterno(ctx.admin, ctx.orgId, {
    contatoDoTurno: ctx.contactId,
    conversaDoTurno: ctx.conversationId,
    noAtendimento: true,
  });
  if (!hub) throw new FalhaDoContrato("tool_unavailable", "Configure o servidor MCP do Brisa Hub antes de gerar o contrato.");
  const destino = createHash("sha256").update(`${hub.servidor.endpoint}:${hub.servidor.chave}`).digest("hex");
  const escopo = `${ctx.orgId}:${ctx.conversationId}:${ctx.userId}:${destino}`;
  return { hub, escopo };
}

export async function prepararContratoDoPainel(
  ctx: ContextoDaFerramenta,
  dados: DadosContrato,
): Promise<ResultadoDaFerramenta> {
  const { hub, escopo } = await destinoDoHub(ctx);
  const previa = preparoContratoSchema.parse(await chamarApiContrato(hub.servidor, "preparar", dados));
  const pronto = previa.pronto && previa.pendencias.length === 0 && !!previa.preview_id;
  const token = pronto ? selarContrato(previa.preview_id!, previa.validade_s ?? 1800, env.INTERNAL_SECRET, escopo) : null;
  return {
    ok: true,
    texto: mascararPessoaNoTexto(previa.resumo.texto),
    previaToken: token,
    pronto,
    extra: { pendencias: previa.pendencias, avisos: previa.avisos, token },
  };
}

export async function confirmarContratoDoPainel(
  ctx: ContextoDaFerramenta,
  token: string,
): Promise<ResultadoDaFerramenta> {
  const { hub, escopo } = await destinoDoHub(ctx);
  const recibo = abrirContrato(token, env.INTERNAL_SECRET, escopo);
  if (!recibo) {
    throw new FalhaDoContrato("idempotency_conflict", "A prévia expirou ou pertence a outra conversa. Prepare a locação novamente.");
  }
  const resultado = resultadoContratoSchema.parse(
    await chamarApiContrato(hub.servidor, "confirmar", {
      preview_id: recibo.preview,
      idempotency_key: recibo.chave,
      confirmado: true,
    }),
  );
  return {
    ok: resultado.gravado,
    texto: mascararPessoaNoTexto(
      resultado.gravado
        ? `Contrato gravado. Situação: ${resultado.situacao ?? "ativa"}. ID: ${String(resultado.id_contrato ?? "")}.`
        : "O Hub não gravou o contrato.",
    ),
    extra: resultado,
  };
}

export const entradaPrepararContrato = dadosContratoSchema;
export const entradaConfirmarContrato = z.object({ token: z.string().min(1).max(2000) }).strict();

export { ErroApiContrato };
