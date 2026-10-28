/**
 * Transições do processo de locação. O banco só checa o vocabulário; quem
 * autoriza o passo é este mapa, usado pelas rotas. Sem SECURITY DEFINER.
 */
import {
  STATUS_DO_PROCESSO,
  STATUS_FINAIS_DO_PROCESSO,
  type MotivoDeCancelamento,
  type StatusDoProcesso,
} from "@/lib/locacao/vocabulario";

export { STATUS_DO_PROCESSO, STATUS_FINAIS_DO_PROCESSO };
export type { MotivoDeCancelamento, StatusDoProcesso };

/** Quem pode pedir a transição. A rota ainda confere papel e, se for o caso, o aprovador. */
export type QuemMove =
  | "atendente"
  | "aprovador"
  | "sistema"
  | "atendente_ou_aprovador";

export interface Transicao {
  readonly de: StatusDoProcesso | "*";
  readonly para: StatusDoProcesso;
  readonly quem: QuemMove;
  readonly exigeMotivo: boolean;
}

/**
 * Mapa canônico (plano §4.2). `*` = qualquer status não final, resolvido em
 * `transicaoPermitida`. Reabrir (`reprovado`/`cancelado` → `documentos`) é só
 * do aprovador.
 */
export const TRANSICOES: readonly Transicao[] = [
  { de: "lead", para: "documentos", quem: "atendente_ou_aprovador", exigeMotivo: false },
  { de: "documentos", para: "analise", quem: "atendente_ou_aprovador", exigeMotivo: false },
  { de: "analise", para: "documentos", quem: "atendente_ou_aprovador", exigeMotivo: false },
  { de: "analise", para: "aprovado", quem: "aprovador", exigeMotivo: false },
  { de: "documentos", para: "aprovado", quem: "aprovador", exigeMotivo: false },
  { de: "analise", para: "reprovado", quem: "atendente_ou_aprovador", exigeMotivo: true },
  { de: "documentos", para: "reprovado", quem: "atendente_ou_aprovador", exigeMotivo: true },
  { de: "aprovado", para: "reprovado", quem: "atendente_ou_aprovador", exigeMotivo: true },
  { de: "lead", para: "contrato_preparado", quem: "sistema", exigeMotivo: false },
  { de: "documentos", para: "contrato_preparado", quem: "sistema", exigeMotivo: false },
  { de: "analise", para: "contrato_preparado", quem: "sistema", exigeMotivo: false },
  { de: "aprovado", para: "contrato_preparado", quem: "sistema", exigeMotivo: false },
  { de: "contrato_preparado", para: "documentos", quem: "sistema", exigeMotivo: false },
  { de: "contrato_preparado", para: "analise", quem: "sistema", exigeMotivo: false },
  { de: "contrato_preparado", para: "aprovado", quem: "sistema", exigeMotivo: false },
  { de: "contrato_preparado", para: "contrato_criado", quem: "sistema", exigeMotivo: false },
  { de: "contrato_criado", para: "contrato_assinado", quem: "atendente_ou_aprovador", exigeMotivo: false },
  { de: "reprovado", para: "documentos", quem: "aprovador", exigeMotivo: false },
  { de: "cancelado", para: "documentos", quem: "aprovador", exigeMotivo: false },
];

const FINAIS = new Set<string>(STATUS_FINAIS_DO_PROCESSO);

export function ehStatusFinal(status: StatusDoProcesso): boolean {
  return FINAIS.has(status);
}

export function transicaoPermitida(
  de: StatusDoProcesso,
  para: StatusDoProcesso,
  quem: "atendente" | "aprovador" | "sistema",
): Transicao | null {
  if (de === para) return null;
  if (para === "cancelado") {
    if (FINAIS.has(de) && de !== "reprovado") return null;
    if (quem === "sistema" || quem === "atendente" || quem === "aprovador") {
      return { de, para: "cancelado", quem: "atendente_ou_aprovador", exigeMotivo: true };
    }
    return null;
  }
  for (const t of TRANSICOES) {
    if (t.para !== para) continue;
    if (t.de !== de && t.de !== "*") continue;
    if (t.quem === "sistema" && quem !== "sistema") continue;
    if (t.quem === "aprovador" && quem !== "aprovador") continue;
    if (t.quem === "atendente" && quem !== "atendente") continue;
    if (t.quem === "atendente_ou_aprovador" && quem === "sistema") continue;
    return t;
  }
  return null;
}
