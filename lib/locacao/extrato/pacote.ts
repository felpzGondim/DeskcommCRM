/**
 * Pacote para 3×: aluguel + condomínio + IPTU + seguro-incêndio.
 * Seguro-fiança NÃO entra. Superlógica só GET via Hub, injetável.
 * A chave `locacao.pacote_superlogica_habilitado` nasce desligada.
 *
 * Superlógica confronta a ficha e só sinaliza divergência. Valor já
 * preenchido (conversa ou manual) permanece; Superlógica só entra no
 * campo vazio, com origem "superlogica".
 */
import {
  divergenciaDeCentavos,
  divergenciaDeCep,
  divergenciaDeEndereco,
  valorNumericoPreenchido,
  type DivergenciaDoPacote,
} from "./divergencia-superlogica";
import { formatarReais, lerCentavos } from "./dinheiro";

export type { CampoDeDivergencia, DivergenciaDoPacote } from "./divergencia-superlogica";
export {
  PREFIXO_DIVERGENCIA,
  avisoDoCampoNasPendencias,
} from "./divergencia-superlogica";

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
  /** Ficha preenchida × Superlógica, sem sobrescrever. */
  divergencias: DivergenciaDoPacote[];
}

export type StatusDoPacoteHub =
  | "ok"
  | "nao_encontrado"
  | "pedido_invalido"
  | "multiplos_contratos"
  | "candidatos"
  | "indisponivel"
  | "nao_permitido";

export type CandidatoImovelHub = {
  id_imovel: number;
  codigo: string | null;
  endereco: string | null;
  cep: string | null;
};

export type ProprietarioDoPacote = {
  nome: string | null;
  cpfCnpj: string | null;
  idPessoa: string | null;
  email: string | null;
  telefone: string | null;
};

export type LeituraDePacoteSuperlogica = {
  status?: StatusDoPacoteHub;
  aluguelCentavos?: number | null;
  condominioCentavos?: number | null;
  iptuCentavos?: number | null;
  seguroIncendioCentavos?: number | null;
  /** Opcional: só para confrontar. Nunca grava na ficha. */
  endereco?: string | null;
  cep?: string | null;
  idImovel?: number | null;
  idContrato?: number | null;
  proprietario?: ProprietarioDoPacote | null;
  candidatos?: CandidatoImovelHub[];
  haMais?: boolean;
  /** Falha do Hub/Superlógica: o chamador cai na conversa e mostra o aviso. */
  aviso?: string;
};

export interface LeitorDePacoteSuperlogica {
  ler(input: {
    orgId: string;
    contactId: string;
    superlogicaImovelId?: number | null;
    conversationId?: string;
    busca?: string | null;
  }): Promise<LeituraDePacoteSuperlogica | null>;
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
    endereco?: string | null;
    cep?: string | null;
  } | null;
  conversa: {
    aluguelCentavos?: number | null;
    condominioCentavos?: number | null;
    iptuCentavos?: number | null;
    seguroIncendioCentavos?: number | null;
    endereco?: string | null;
    cep?: string | null;
  };
}): PacoteDoImovel {
  const sl = input.superlogica ?? null;
  const cv = input.conversa;
  const escolher = (
    ficha: number | null | undefined,
    slv: number | null | undefined,
  ): ComponenteDoPacote => {
    if (valorNumericoPreenchido(ficha)) return comp(ficha, "conversa");
    if (valorNumericoPreenchido(slv)) return comp(slv, "superlogica");
    return { valorCentavos: null, origem: "ausente" };
  };
  const aluguel = escolher(cv.aluguelCentavos, sl?.aluguelCentavos);
  const condominio = escolher(cv.condominioCentavos, sl?.condominioCentavos);
  const iptu = escolher(cv.iptuCentavos, sl?.iptuCentavos);
  const seguroIncendio = escolher(cv.seguroIncendioCentavos, sl?.seguroIncendioCentavos);
  const divergencias = [
    divergenciaDeCentavos("aluguel", cv.aluguelCentavos, sl?.aluguelCentavos),
    divergenciaDeCentavos("condominio", cv.condominioCentavos, sl?.condominioCentavos),
    divergenciaDeCentavos("iptu", cv.iptuCentavos, sl?.iptuCentavos),
    divergenciaDeCentavos("seguro_incendio", cv.seguroIncendioCentavos, sl?.seguroIncendioCentavos),
    divergenciaDeEndereco(cv.endereco, sl?.endereco),
    divergenciaDeCep(cv.cep, sl?.cep),
  ].filter((d): d is DivergenciaDoPacote => d != null);

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
      divergencias,
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
    divergencias,
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
  for (const d of pacote.divergencias) partes.push(d.aviso);
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
