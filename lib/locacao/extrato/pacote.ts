/**
 * Pacote para 3×: aluguel + condomínio + IPTU + seguro-incêndio.
 * Seguro-fiança NÃO entra. Superlógica só GET, injetável; sem cliente HTTP
 * neste repo a chave nasce desligada.
 */
import { formatarReais, lerCentavos } from "./dinheiro";

export type OrigemDoComponente = "superlogica" | "conversa" | "ausente";

export interface ComponenteDoPacote {
  valorCentavos: number | null;
  origem: OrigemDoComponente;
}

export interface PacoteDoImovel {
  aluguel: ComponenteDoPacote;
  condominio: ComponenteDoPacote;
  iptu: ComponenteDoPacote;
  seguroIncendio: ComponenteDoPacote;
  /** null se faltar o aluguel (não dá para calcular 3×). */
  totalCentavos: number | null;
  vezes3Centavos: number | null;
  faltantes: string[];
}

export interface LeitorDePacoteSuperlogica {
  ler(input: {
    orgId: string;
    contactId: string;
    superlogicaImovelId?: number | null;
  }): Promise<{
    aluguelCentavos?: number | null;
    condominioCentavos?: number | null;
    iptuCentavos?: number | null;
    seguroIncendioCentavos?: number | null;
  } | null>;
}

export function leitorSuperlogicaDesligado(): LeitorDePacoteSuperlogica {
  return { async ler() { return null; } };
}

export const FRASE_PACOTE_AUSENTE = "3x não calculado: falta o valor do pacote";

function comp(valor: number | null | undefined, origem: OrigemDoComponente): ComponenteDoPacote {
  if (valor == null || !Number.isFinite(valor)) return { valorCentavos: null, origem: "ausente" };
  return { valorCentavos: Math.round(valor), origem };
}

export function montarPacote(input: {
  superlogica?: {
    aluguelCentavos?: number | null;
    condominioCentavos?: number | null;
    iptuCentavos?: number | null;
    seguroIncendioCentavos?: number | null;
  } | null;
  conversa: {
    aluguelCentavos?: number | null;
    condominioCentavos?: number | null;
    iptuCentavos?: number | null;
    seguroIncendioCentavos?: number | null;
  };
}): PacoteDoImovel {
  const sl = input.superlogica ?? null;
  const cv = input.conversa;
  const escolher = (
    slv: number | null | undefined,
    cvv: number | null | undefined,
  ): ComponenteDoPacote => {
    if (slv != null && Number.isFinite(slv)) return comp(slv, "superlogica");
    if (cvv != null && Number.isFinite(cvv)) return comp(cvv, "conversa");
    return { valorCentavos: null, origem: "ausente" };
  };
  const aluguel = escolher(sl?.aluguelCentavos, cv.aluguelCentavos);
  const condominio = escolher(sl?.condominioCentavos, cv.condominioCentavos);
  const iptu = escolher(sl?.iptuCentavos, cv.iptuCentavos);
  const seguroIncendio = escolher(sl?.seguroIncendioCentavos, cv.seguroIncendioCentavos);

  const faltantes: string[] = [];
  if (aluguel.origem === "ausente") faltantes.push("aluguel");
  if (condominio.origem === "ausente") faltantes.push("condomínio");
  if (iptu.origem === "ausente") faltantes.push("IPTU");
  if (seguroIncendio.origem === "ausente") faltantes.push("seguro-incêndio");

  if (aluguel.valorCentavos == null) {
    return {
      aluguel,
      condominio,
      iptu,
      seguroIncendio,
      totalCentavos: null,
      vezes3Centavos: null,
      faltantes,
    };
  }

  const total =
    aluguel.valorCentavos +
    (condominio.valorCentavos ?? 0) +
    (iptu.valorCentavos ?? 0) +
    (seguroIncendio.valorCentavos ?? 0);
  return {
    aluguel,
    condominio,
    iptu,
    seguroIncendio,
    totalCentavos: total,
    vezes3Centavos: total * 3,
    faltantes,
  };
}

function rotuloOrigem(o: OrigemDoComponente): string {
  if (o === "superlogica") return "Superlógica";
  if (o === "conversa") return "conversa/ficha";
  return "ausente";
}

export function textoDoPacote(pacote: PacoteDoImovel): string {
  const linha = (nome: string, c: ComponenteDoPacote) =>
    c.valorCentavos != null
      ? `${nome}: ${formatarReais(c.valorCentavos)} (${rotuloOrigem(c.origem)})`
      : `${nome}: a informação ${nome} não foi encontrada nos documentos fornecidos.`;
  const partes = [
    linha("aluguel", pacote.aluguel),
    linha("condomínio", pacote.condominio),
    linha("IPTU", pacote.iptu),
    linha("seguro-incêndio", pacote.seguroIncendio),
  ];
  if (pacote.vezes3Centavos == null) {
    partes.push(FRASE_PACOTE_AUSENTE);
  } else {
    partes.push(
      `Pacote (aluguel+condomínio+IPTU+seguro-incêndio, sem seguro-fiança): ${formatarReais(pacote.totalCentavos ?? 0)}.`,
    );
    partes.push(`3x o pacote: ${formatarReais(pacote.vezes3Centavos)}.`);
    if (pacote.faltantes.length > 0) {
      partes.push(
        `Componentes ausentes somados como zero com aviso: ${pacote.faltantes.join(", ")}.`,
      );
    }
  }
  return partes.join(" ");
}

export function lerSeguroIncendioNoTexto(texto: string): number | null {
  const m = texto.match(
    /seguro[\s-]*inc[eê]ndio[\s:]*(?:de\s+)?r?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d{3,7})/i,
  );
  const bruto = m?.[1];
  if (!bruto) return null;
  const centavos = bruto.includes(",")
    ? lerCentavos(bruto)
    : Number(bruto.replace(/\D/g, "")) * 100;
  return centavos != null && Number.isFinite(centavos) && centavos > 0
    ? Math.round(centavos)
    : null;
}
