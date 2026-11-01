/**
 * Locador visível na aba Dados a partir do vínculo Superlógica de
 * proprietário. Só devolve máscara. Sem I/O.
 */
import { mascararContatoLocador, mascararDocumentoLocador } from "@/lib/locacao/mascarar-locador";
import type { CampoFicha } from "@/lib/locacao/ficha-schema";
import { CAMPO_VAZIO } from "@/lib/locacao/ficha-schema";
import { rotuloDaOrigemDoCampo, seloDaFonte, type SeloDeOrigem } from "@/lib/locacao/origem-do-campo";

export type LocadorDoVinculo = {
  nome: string | null;
  documento_mascarado: string | null;
  contato_mascarado: string | null;
};

export type CampoLocadorVisivel = {
  valor: string;
  origem: SeloDeOrigem;
  rotulo: string;
};

export function vinculoEhProprietario(tipos: unknown, tipoUnico?: string | null): boolean {
  const lista = Array.isArray(tipos) ? tipos : [];
  if (lista.some((t) => t === "proprietario")) return true;
  return tipoUnico === "proprietario";
}

export function locadorDoVinculo(input: {
  tipos?: unknown;
  tipo?: string | null;
  nome?: string | null;
  documento?: string | null;
  contato?: string | null;
}): LocadorDoVinculo | null {
  if (!vinculoEhProprietario(input.tipos, input.tipo)) return null;
  const nome = input.nome?.trim() || null;
  const documento = input.documento?.trim()
    ? mascararDocumentoLocador(input.documento)
    : null;
  const contato = input.contato?.trim()
    ? mascararContatoLocador(input.contato)
    : null;
  if (!nome && !documento && !contato) {
    return { nome: null, documento_mascarado: null, contato_mascarado: null };
  }
  return {
    nome,
    documento_mascarado: documento || null,
    contato_mascarado: contato || null,
  };
}

function campoDaFicha(c: CampoFicha | undefined): CampoFicha {
  return c ?? { ...CAMPO_VAZIO };
}

export function campoLocadorVisivel(
  ficha: CampoFicha | undefined,
  sl: string | null | undefined,
  mascarar: (valor: string) => string = (v) => v,
): CampoLocadorVisivel {
  const campo = campoDaFicha(ficha);
  if (campo.valor) {
    const origem = seloDaFonte(campo.fonte, true);
    return {
      valor: mascarar(campo.valor),
      origem,
      rotulo: rotuloDaOrigemDoCampo(campo.fonte, true),
    };
  }
  if (sl) {
    return { valor: sl, origem: "superlogica", rotulo: "Superlógica" };
  }
  return { valor: "", origem: "vazio", rotulo: "vazio" };
}
