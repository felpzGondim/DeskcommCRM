/**
 * Locador e busca de imóvel a partir do pacote Superlógica (só GET).
 * Funções puras: sem I/O, sem log de dado pessoal.
 */
import { CAMPO_VAZIO, type CampoFicha, type FichaPreliminar } from "@/lib/locacao/ficha-schema";
import { locadorDoVinculo, type LocadorDoVinculo } from "@/lib/locacao/locador-do-vinculo";
import type {
  CandidatoImovelHub,
  ProprietarioDoPacote,
  StatusDoPacoteHub,
} from "@/lib/locacao/extrato/pacote";

export const AVISO_HUB_INDISPONIVEL =
  "A Superlógica está indisponível agora (o Hub ainda não tem este recurso). O locador e os valores da conversa continuam valendo.";
export const AVISO_IMOVEL_NAO_ENCONTRADO =
  "Nenhum imóvel encontrado na Superlógica com este endereço ou código.";
export const AVISO_PEDIDO_INVALIDO =
  "Não foi possível validar o imóvel na Superlógica.";
export const AVISO_MULTIPLOS_CONTRATOS =
  "Há mais de um contrato ativo neste imóvel na Superlógica. Confira lá e escolha o imóvel.";
export const AVISO_CANDIDATOS =
  "Vários imóveis na Superlógica batem com este endereço. Escolha um na aba Dados.";
export const AVISO_CHAVE_DESLIGADA =
  "A leitura da Superlógica está desligada em Configurações › Locação.";
export const AVISO_SEM_BUSCA =
  "Informe o endereço ou o código do imóvel para validar na Superlógica.";

export function avisoDoStatusDoPacote(status: StatusDoPacoteHub | undefined): string | null {
  if (status === "indisponivel" || status === "nao_permitido") return AVISO_HUB_INDISPONIVEL;
  if (status === "nao_encontrado") return AVISO_IMOVEL_NAO_ENCONTRADO;
  if (status === "pedido_invalido") return AVISO_PEDIDO_INVALIDO;
  if (status === "multiplos_contratos") return AVISO_MULTIPLOS_CONTRATOS;
  if (status === "candidatos") return AVISO_CANDIDATOS;
  return null;
}

export function buscaDoImovel(input: {
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  cep?: string | null;
  codigo?: string | null;
}): string | null {
  const codigo = input.codigo?.trim() || null;
  const partes = [input.logradouro, input.numero, input.complemento]
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean);
  if (partes.length > 0) {
    const end = partes.join(", ");
    const cep = input.cep?.trim();
    return cep ? `${end} ${cep}` : end;
  }
  return codigo;
}

function campoSuperlogica(valor: string | null): CampoFicha {
  const t = valor?.trim() || null;
  return {
    valor: t,
    fonte: t ? "superlogica" : null,
    trecho: null,
    confianca: t ? 1 : null,
    message_id: null,
  };
}

function campoPodeReceberSuperlogica(campo: CampoFicha | undefined): boolean {
  if (!campo) return true;
  if (campo.fonte === "atendente") return false;
  return !campo.valor;
}

export function contatoDoProprietario(p: ProprietarioDoPacote | null | undefined): string | null {
  if (!p) return null;
  const tel = p.telefone?.trim();
  if (tel) return tel;
  const email = p.email?.trim();
  return email || null;
}

export function preencherLocadorNaFicha(
  ficha: FichaPreliminar,
  proprietario: ProprietarioDoPacote | null | undefined,
): FichaPreliminar {
  if (!proprietario) return ficha;
  const atual = ficha.locador ?? {
    nome: { ...CAMPO_VAZIO },
    documento: { ...CAMPO_VAZIO },
    contato: { ...CAMPO_VAZIO },
  };
  const contato = contatoDoProprietario(proprietario);
  return {
    ...ficha,
    locador: {
      nome: campoPodeReceberSuperlogica(atual.nome) && proprietario.nome
        ? campoSuperlogica(proprietario.nome)
        : atual.nome,
      documento: campoPodeReceberSuperlogica(atual.documento) && proprietario.cpfCnpj
        ? campoSuperlogica(proprietario.cpfCnpj)
        : atual.documento,
      contato: campoPodeReceberSuperlogica(atual.contato) && contato
        ? campoSuperlogica(contato)
        : atual.contato,
    },
  };
}

export function locadorMascaradoDoProprietario(
  proprietario: ProprietarioDoPacote | null | undefined,
): LocadorDoVinculo | null {
  if (!proprietario) return null;
  if (!proprietario.nome && !proprietario.cpfCnpj && !contatoDoProprietario(proprietario)) {
    return null;
  }
  return locadorDoVinculo({
    tipos: ["proprietario"],
    nome: proprietario.nome,
    documento: proprietario.cpfCnpj,
    contato: contatoDoProprietario(proprietario),
  });
}

export function rotuloDoCandidato(c: CandidatoImovelHub): string {
  const partes = [c.endereco, c.codigo, c.cep].filter((s): s is string => !!s && s.trim().length > 0);
  return partes.length > 0 ? partes.join(" · ") : `Imóvel ${c.id_imovel}`;
}
