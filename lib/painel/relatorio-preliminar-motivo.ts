import { z } from "zod";

export type MotivoFalhaRelatorio =
  | "extrator_json"
  | "relatorio_json"
  | "zod"
  | "saida_truncada"
  | "invalid_format";

export type EtapaFalhaRelatorio = "anexos" | "extracao_extrato" | "relatorio" | "gravacao" | "worker";

export function motivoDaFalhaDoRelatorio(err: unknown): MotivoFalhaRelatorio {
  if (err instanceof z.ZodError) return "zod";
  if (err instanceof Error && err.message === "saida_truncada") return "saida_truncada";
  if (err instanceof SyntaxError) return "relatorio_json";
  if (err instanceof Error && (err.message === "json_ausente" || err.message === "relatorio_ausente")) {
    return "relatorio_json";
  }
  if (err instanceof Error && err.message === "extrator_json") return "extrator_json";
  return "invalid_format";
}

export function codigoDaFalhaDoRelatorio(motivo: MotivoFalhaRelatorio): "saida_truncada" | "invalid_format" {
  return motivo === "saida_truncada" ? "saida_truncada" : "invalid_format";
}

export function textoDaFalhaDoRelatorio(motivo: MotivoFalhaRelatorio): string {
  if (motivo === "saida_truncada") {
    return "Não foi possível gerar o relatório preliminar. A resposta da IA ficou incompleta. Tente de novo.";
  }
  if (motivo === "extrator_json") {
    return "Não foi possível gerar o relatório preliminar. A extração do extrato veio em formato inválido. Tente de novo.";
  }
  return "Não foi possível gerar o relatório preliminar. A resposta da IA veio em formato inválido. Tente de novo.";
}
