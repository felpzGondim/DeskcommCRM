/**
 * Superfície de buscar / ler / baixar da integração delegada.
 *
 * Não registra MCP, não abre rota, não emite credencial. Quem chama tem de
 * montar o `PedidoDelegado` com provas; este módulo só aplica o guarda e,
 * se recusar, NÃO chama busca, leitura, assinatura nem provedor.
 *
 * `buscar` no schema NÃO exige conversation_id (alvo D5: busca corporativa da
 * org). `ler`/`baixar` exigem a conversa identificada. Nada disto está servido.
 */
import { z } from "zod";

import {
  ATIVACAO_DELEGADA_PADRAO,
  ENTITLEMENT_VISIBILIDADE_PADRAO,
  VISIBILIDADE_CONVERSA_ALVO,
  autorizarDelegacaoEmpresarial,
  classificacaoDeSessaoNaoDisponivel,
  reciboAuditoriaDelegada,
  type MotivoRecusaDelegada,
  type PedidoDelegado,
  type ReciboAuditoriaDelegada,
} from "./delegacao-empresarial";

export const entradaDelegadaExternaSchema = z
  .object({
    conversation_id: z.string().uuid().optional(),
    message_id: z.string().uuid().optional(),
    documento_id: z.string().uuid().optional(),
    processo_id: z.string().uuid().optional(),
    efeito: z.enum(["buscar", "ler", "baixar"]),
  })
  .strict()
  .superRefine((valor, ctx) => {
    if ((valor.efeito === "ler" || valor.efeito === "baixar") && !valor.conversation_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ler e baixar exigem conversation_id",
        path: ["conversation_id"],
      });
    }
  });

export type EntradaDelegadaExterna = z.infer<typeof entradaDelegadaExternaSchema>;

export interface EfeitosDelegados {
  buscar?: () => Promise<unknown>;
  ler?: () => Promise<unknown>;
  baixarAssinar?: () => Promise<unknown>;
  baixarProvedor?: () => Promise<unknown>;
}

export type ResultadoLeituraDelegada =
  | { ok: true; efeito: "buscar" | "ler" | "baixar"; dados: unknown; auditoria: ReciboAuditoriaDelegada }
  | { ok: false; motivo: MotivoRecusaDelegada; auditoria: ReciboAuditoriaDelegada };

export function pedidoDelegadoDesligado(
  parcial: Omit<
    PedidoDelegado,
    | "ativacao"
    | "classificacaoDaSessao"
    | "visibilidadeDaConversa"
    | "entitlementDeVisibilidade"
    | "chatPrivadoDoBot"
  > & {
    classificacaoDaSessao?: PedidoDelegado["classificacaoDaSessao"];
    visibilidadeDaConversa?: PedidoDelegado["visibilidadeDaConversa"];
    entitlementDeVisibilidade?: PedidoDelegado["entitlementDeVisibilidade"];
    chatPrivadoDoBot?: PedidoDelegado["chatPrivadoDoBot"];
  },
): PedidoDelegado {
  return {
    ...parcial,
    ativacao: ATIVACAO_DELEGADA_PADRAO,
    classificacaoDaSessao: parcial.classificacaoDaSessao ?? classificacaoDeSessaoNaoDisponivel(),
    visibilidadeDaConversa: parcial.visibilidadeDaConversa ?? VISIBILIDADE_CONVERSA_ALVO,
    entitlementDeVisibilidade: parcial.entitlementDeVisibilidade ?? ENTITLEMENT_VISIBILIDADE_PADRAO,
    chatPrivadoDoBot: parcial.chatPrivadoDoBot ?? "nao_provado",
  };
}

export async function executarLeituraDelegada(
  pedido: PedidoDelegado,
  efeitos: EfeitosDelegados,
): Promise<ResultadoLeituraDelegada> {
  const decisao = autorizarDelegacaoEmpresarial(pedido);
  const auditoria = reciboAuditoriaDelegada({
    motivo: decisao.ok ? "ok" : decisao.motivo,
    efeito: pedido.efeito,
    organization_id: pedido.organizationIdDoRecurso,
    conversation_id: pedido.anexo?.conversaIdDoPedido,
  });
  if (!decisao.ok) {
    return { ok: false, motivo: decisao.motivo, auditoria };
  }
  if (decisao.efeito === "buscar") {
    const dados = efeitos.buscar ? await efeitos.buscar() : [];
    return { ok: true, efeito: "buscar", dados, auditoria };
  }
  if (decisao.efeito === "ler") {
    const dados = efeitos.ler ? await efeitos.ler() : null;
    return { ok: true, efeito: "ler", dados, auditoria };
  }
  const dados = efeitos.baixarAssinar
    ? await efeitos.baixarAssinar()
    : efeitos.baixarProvedor
      ? await efeitos.baixarProvedor()
      : null;
  return { ok: true, efeito: "baixar", dados, auditoria };
}
