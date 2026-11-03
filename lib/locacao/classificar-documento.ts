/**
 * Classificação automática da aba Documentos. Pura: sem cliente, sem Hub,
 * sem modelo. Usa o que a ficha, a análise de renda e o texto já extraído
 * já sabem. A origem manual nunca é sobrescrita.
 *
 * Sem dado pessoal neste arquivo.
 */
import { hashCpfDoParticipante } from "@/lib/locacao/cpf";
import {
  TIPOS_DE_COMPROVANTE,
  type FichaPreliminar,
  type PessoaDaFicha,
} from "@/lib/locacao/ficha-schema";
import {
  CATEGORIAS_DE_DOCUMENTO,
  type CategoriaDeDocumento,
} from "@/lib/locacao/vocabulario";

export const ORIGENS_DA_CLASSIFICACAO = ["automatico", "manual"] as const;
export type OrigemDaClassificacao = (typeof ORIGENS_DA_CLASSIFICACAO)[number];

export type ParticipanteParaClassificar = {
  id: string;
  papel: string;
  principal: boolean;
  cpf_hash?: string | null;
};

export type ClassificacaoSalva = {
  categoria?: string;
  participante_id?: string | null;
  categoria_origem?: string;
  participante_origem?: string;
  tentou_modelo?: boolean;
};

export type SinalDeDocumento = {
  message_id: string;
  categoria: "documento_pessoal" | "comprovante_renda";
  participante_id: string | null;
};

export type ClassificacaoDeDocumento = {
  categoria: CategoriaDeDocumento;
  participante_id: string | null;
  categoria_origem: OrigemDaClassificacao;
  participante_origem: OrigemDaClassificacao;
  tentou_modelo: boolean;
};

const CATEGORIA_SET = new Set<string>(CATEGORIAS_DE_DOCUMENTO);

export function categoriaValida(valor: unknown): CategoriaDeDocumento | null {
  return typeof valor === "string" && CATEGORIA_SET.has(valor)
    ? valor as CategoriaDeDocumento
    : null;
}

export function origemValida(valor: unknown): OrigemDaClassificacao | null {
  return valor === "automatico" || valor === "manual" ? valor : null;
}

export function lerClassificacaoSalva(bruto: unknown): ClassificacaoSalva | null {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return null;
  const o = bruto as Record<string, unknown>;
  const categoria = typeof o.categoria === "string" ? o.categoria : undefined;
  const temParticipante = "participante_id" in o;
  if (!categoria && !temParticipante && o.categoria_origem == null && o.participante_origem == null) {
    return null;
  }
  return {
    categoria,
    participante_id: typeof o.participante_id === "string" ? o.participante_id : o.participante_id === null ? null : undefined,
    categoria_origem: typeof o.categoria_origem === "string" ? o.categoria_origem : undefined,
    participante_origem: typeof o.participante_origem === "string" ? o.participante_origem : undefined,
    tentou_modelo: o.tentou_modelo === true,
  };
}

export function campoFoiManual(
  salva: ClassificacaoSalva | null,
  campo: "categoria" | "participante",
): boolean {
  if (!salva) return false;
  const origem = campo === "categoria" ? salva.categoria_origem : salva.participante_origem;
  if (origem === "manual") return true;
  if (origem === "automatico") return false;
  // Legado (PATCH antigo sem origem): o que já estava gravado é escolha humana.
  return campo === "categoria" ? typeof salva.categoria === "string" : "participante_id" in salva;
}

export function unicoCandidato(
  participantes: readonly ParticipanteParaClassificar[],
): string | null {
  const candidatos = participantes.filter((p) => p.papel !== "contato");
  if (candidatos.length === 1) return candidatos[0]!.id;
  if (candidatos.length === 0 && participantes.length === 1) return participantes[0]!.id;
  return null;
}

export function locatarioPrincipal(
  participantes: readonly ParticipanteParaClassificar[],
): string | null {
  const locatarios = participantes.filter((p) => p.papel === "locatario");
  return (locatarios.find((p) => p.principal) ?? locatarios[0])?.id
    ?? unicoCandidato(participantes);
}

export function participanteDaPessoa(
  pessoa: Pick<PessoaDaFicha, "papel" | "principal" | "cpf"> & { cpf_hash?: string | null },
  participantes: readonly ParticipanteParaClassificar[],
): string | null {
  const hash = pessoa.cpf_hash ?? hashCpfDoParticipante(pessoa.cpf?.valor ?? "");
  const papel = pessoa.papel === "inquilino" ? "locatario" : pessoa.papel;
  const candidatos = participantes.filter((p) => p.papel !== "contato");
  if (hash) {
    const porHash = candidatos.find((p) => p.cpf_hash === hash);
    if (porHash) return porHash.id;
  }
  const doPapel = candidatos.filter((p) => p.papel === papel);
  return (doPapel.find((p) => p.principal === pessoa.principal) ?? doPapel[0])?.id ?? null;
}

function categoriaDoTipoEncontrado(tipo: string): SinalDeDocumento["categoria"] | null {
  const t = tipo.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  if (
    (TIPOS_DE_COMPROVANTE as readonly string[]).includes(t)
    || /\b(holerite|contracheque|extrato|ctps|renda|proventos)\b/.test(t)
  ) {
    return "comprovante_renda";
  }
  if (/\b(rg|cnh|cpf|identidade|passaporte|documento pessoal|documento_pessoal)\b/.test(t)) {
    return "documento_pessoal";
  }
  return null;
}

export function sinaisDaFicha(
  ficha: FichaPreliminar | null | undefined,
  participantes: readonly ParticipanteParaClassificar[],
  participanteDaAnaliseDeRenda: string | null = null,
): SinalDeDocumento[] {
  if (!ficha) return [];
  const sinais: SinalDeDocumento[] = [];
  const jaTem = (messageId: string) => sinais.some((s) => s.message_id === messageId);

  const donoDaRenda = (messageId: string): string | null => {
    const dono = ficha.pessoas.find((p) => p.renda_individual.message_id === messageId);
    if (dono) return participanteDaPessoa(dono, participantes);
    return participanteDaAnaliseDeRenda
      ?? locatarioPrincipal(participantes);
  };

  for (const doc of ficha.renda.documentos) {
    if (!doc.message_id || jaTem(doc.message_id)) continue;
    sinais.push({
      message_id: doc.message_id,
      categoria: "comprovante_renda",
      participante_id: donoDaRenda(doc.message_id),
    });
  }

  for (const pessoa of ficha.pessoas) {
    if (pessoa.papel === "contato") continue;
    const pid = participanteDaPessoa(pessoa, participantes);
    for (const campo of [pessoa.cpf, pessoa.rg]) {
      if (!campo.message_id || jaTem(campo.message_id)) continue;
      sinais.push({
        message_id: campo.message_id,
        categoria: "documento_pessoal",
        participante_id: pid,
      });
    }
  }

  for (const doc of ficha.documentos.encontrados) {
    if (!doc.message_id || jaTem(doc.message_id)) continue;
    const categoria = categoriaDoTipoEncontrado(doc.tipo);
    if (!categoria) continue;
    sinais.push({
      message_id: doc.message_id,
      categoria,
      participante_id: categoria === "comprovante_renda"
        ? (participanteDaAnaliseDeRenda ?? locatarioPrincipal(participantes))
        : null,
    });
  }

  return sinais;
}

/**
 * Categoria a partir do nome do arquivo e do texto já extraído (visão/OCR).
 * Não chama modelo. Renda vence identificação: holerite também traz CPF.
 */
export function categoriaPeloTextoDerivado(
  nome: string,
  texto: string,
): CategoriaDeDocumento | null {
  const t = `${nome}\n${texto}`.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const renda = /\b(holerite|contracheque|proventos|pro-labore|pro labore|comprovante de renda|informe de rendimentos|extrato)\b/.test(t);
  const pessoal = /\b(registro geral|carteira de identidade|carteira nacional de habilitacao|\brg\b|\bcnh\b|passaporte|documento de identidade)\b/.test(t);
  if (renda) return "comprovante_renda";
  if (pessoal) return "documento_pessoal";
  return null;
}

export function classificarAnexoDaConversa(input: {
  messageId: string;
  salva: ClassificacaoSalva | null;
  sinais: readonly SinalDeDocumento[];
  participantes: readonly ParticipanteParaClassificar[];
  categoriaDoTexto?: CategoriaDeDocumento | null;
}): ClassificacaoDeDocumento {
  const salva = input.salva;
  const categoriaManual = campoFoiManual(salva, "categoria");
  const participanteManual = campoFoiManual(salva, "participante");
  const sinal = input.sinais.find((s) => s.message_id === input.messageId);
  const unico = unicoCandidato(input.participantes);

  const categoriaSalvaAutomatica = !categoriaManual ? categoriaValida(salva?.categoria) : null;
  const categoria = categoriaManual
    ? (categoriaValida(salva?.categoria) ?? "outro")
    : (sinal?.categoria ?? input.categoriaDoTexto ?? categoriaSalvaAutomatica ?? "outro");

  const participanteSalvoAutomatico = !participanteManual
    && typeof salva?.participante_id === "string"
    && input.participantes.some((p) => p.id === salva.participante_id)
    ? salva.participante_id
    : null;

  let participante_id: string | null;
  if (participanteManual) {
    participante_id = typeof salva?.participante_id === "string" ? salva.participante_id : null;
  } else {
    participante_id = sinal?.participante_id
      ?? (categoria === "comprovante_renda" ? locatarioPrincipal(input.participantes) : null)
      ?? unico
      ?? participanteSalvoAutomatico;
  }

  return {
    categoria,
    participante_id,
    categoria_origem: categoriaManual ? "manual" : "automatico",
    participante_origem: participanteManual ? "manual" : "automatico",
    tentou_modelo: salva?.tentou_modelo === true,
  };
}

export function classificacaoPrecisaPersistir(
  salva: ClassificacaoSalva | null,
  nova: ClassificacaoDeDocumento,
): boolean {
  if (!salva) {
    return nova.categoria !== "outro" || nova.participante_id != null || nova.tentou_modelo;
  }
  return (salva.categoria ?? "outro") !== nova.categoria
    || (salva.participante_id ?? null) !== nova.participante_id
    || origemValida(salva.categoria_origem) !== nova.categoria_origem
    || origemValida(salva.participante_origem) !== nova.participante_origem
    || Boolean(salva.tentou_modelo) !== nova.tentou_modelo;
}

export function classificacaoParaMetadata(nova: ClassificacaoDeDocumento): {
  categoria: CategoriaDeDocumento;
  participante_id: string | null;
  categoria_origem: OrigemDaClassificacao;
  participante_origem: OrigemDaClassificacao;
  tentou_modelo?: true;
} {
  return {
    categoria: nova.categoria,
    participante_id: nova.participante_id,
    categoria_origem: nova.categoria_origem,
    participante_origem: nova.participante_origem,
    ...(nova.tentou_modelo ? { tentou_modelo: true as const } : {}),
  };
}

export function aplicarEdicaoManual(
  salva: ClassificacaoSalva | null,
  edicao: { categoria: CategoriaDeDocumento; participante_id: string | null },
): ClassificacaoDeDocumento {
  const categoriaMudou = (salva?.categoria ?? "outro") !== edicao.categoria;
  const participanteMudou = (salva?.participante_id ?? null) !== edicao.participante_id;
  return {
    categoria: edicao.categoria,
    participante_id: edicao.participante_id,
    categoria_origem: categoriaMudou || campoFoiManual(salva, "categoria") ? "manual" : "automatico",
    participante_origem: participanteMudou || campoFoiManual(salva, "participante") ? "manual" : "automatico",
    tentou_modelo: salva?.tentou_modelo === true,
  };
}
