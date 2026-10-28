/**
 * Manual assistido (PR 4.4): reserva quando o robô cai em `erro` ou
 * `login_necessario`. Sem I/O. Sem passo pago. Sem Hub. O atendente faz no
 * site e grava o mesmo resultado que o robô gravaria.
 */
import {
  decodificarLaudo,
  sanitizarResultadoFc,
  type LaudoDecodificado,
  type ResultadoDaFc,
} from "@/lib/locacao/analise/fc";
import { decodificarPrint, sanitizarCards, type PrintDecodificado } from "@/lib/locacao/analise/seguro";
import { hashCpfDoParticipante, mascararCpf } from "@/lib/locacao/cpf";
import { codigoFc } from "@/lib/locacao/endereco";
import type { FichaPreliminar, PessoaDaFicha } from "@/lib/locacao/ficha-schema";
import { inquilinoPrincipalDaFicha } from "@/lib/locacao/ficha-telefone";

export const ESTADOS_QUE_ABREM_MANUAL = ["erro", "login_necessario"] as const;
export type EstadoQueAbreManual = (typeof ESTADOS_QUE_ABREM_MANUAL)[number];

export const LINK_FC = "https://cliente.fcanalise.com.br";
export const LINK_MIGRA = "https://migra.app.br";
export const DIAS_INICIO_VIGENCIA = 5;
export const MESES_FIM_VIGENCIA = 30;

export function estadoAbreManual(estado: string | null | undefined): estado is EstadoQueAbreManual {
  return ESTADOS_QUE_ABREM_MANUAL.includes(estado as EstadoQueAbreManual);
}

export type CampoParaCopiar = {
  chave: string;
  rotulo: string;
  valor: string;
  sensivel?: boolean;
};

export type SolidarioParaCopiar = {
  nome: string;
  cpf_mascarado: string;
};

export type DadosParaCopiar = {
  campos: CampoParaCopiar[];
  solidarios: SolidarioParaCopiar[];
  vigencia: { inicio: string; fim: string };
  links: { fc: string; migra: string };
};

function soDigitosCpf(bruto: string): string | null {
  const d = bruto.replace(/\D/g, "");
  return d.length === 11 ? d : null;
}

function isoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addUtcDays(base: Date, dias: number): Date {
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + dias);
  return d;
}

function addUtcMonths(base: Date, meses: number): Date {
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  d.setUTCMonth(d.getUTCMonth() + meses);
  return d;
}

/** Início = hoje UTC + 5 dias; fim = início + 30 meses (adendo A.2). */
export function vigenciaManual(hoje: Date = new Date()): { inicio: string; fim: string } {
  const inicio = addUtcDays(hoje, DIAS_INICIO_VIGENCIA);
  const fim = addUtcMonths(inicio, MESES_FIM_VIGENCIA);
  return { inicio: isoDate(inicio), fim: isoDate(fim) };
}

export function pessoaDaFichaParaManual(
  ficha: FichaPreliminar,
  opts: { cpfHash?: string | null } = {},
): PessoaDaFicha | null {
  if (opts.cpfHash) {
    return ficha.pessoas.find((p) => hashCpfDoParticipante(p.cpf.valor ?? "") === opts.cpfHash) ?? null;
  }
  return inquilinoPrincipalDaFicha(ficha);
}

export function cpfClaroDaFicha(pessoa: PessoaDaFicha | null): string | null {
  if (!pessoa) return null;
  return soDigitosCpf(pessoa.cpf.valor ?? "");
}

export function formatarCpf(digitos: string): string {
  const d = soDigitosCpf(digitos);
  if (!d) return digitos;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function campo(chave: string, rotulo: string, valor: string | number | null | undefined, sensivel = false): CampoParaCopiar | null {
  if (valor == null) return null;
  const texto = typeof valor === "number" ? String(valor) : valor.trim();
  if (!texto) return null;
  return { chave, rotulo, valor: texto, ...(sensivel ? { sensivel: true } : {}) };
}

/**
 * Dados da ficha prontos para copiar. CPF sempre mascarado — o claro só sai
 * de `revelarCpfDaFicha`, no clique do atendente.
 */
export function montarDadosParaCopiar(
  ficha: FichaPreliminar,
  opts: { pessoa?: PessoaDaFicha | null; cpfMascarado?: string | null; hoje?: Date } = {},
): DadosParaCopiar {
  const pessoa = opts.pessoa ?? inquilinoPrincipalDaFicha(ficha);
  const cpfClaro = cpfClaroDaFicha(pessoa);
  const cpfTela = opts.cpfMascarado
    ?? (cpfClaro ? mascararCpf(cpfClaro) : null)
    ?? "";
  const imovel = ficha.imovel;
  const logradouro = imovel.logradouro.valor?.trim() ?? "";
  const codigo =
    imovel.codigo_fc.valor?.trim()
    || (logradouro
      ? codigoFc({
          logradouro,
          numero: imovel.numero.valor,
          complemento: imovel.complemento.valor,
        })
      : "");
  const renda = ficha.renda.proposta_fc.valor ?? ficha.renda.mensal.valor;
  const campos = [
    campo("nome", "Nome", pessoa?.nome.valor),
    campo("cpf", "CPF", cpfTela, true),
    campo("email", "E-mail", pessoa?.email.valor),
    campo("celular", "Celular", pessoa?.celular.valor),
    campo("nascimento", "Nascimento", pessoa?.nascimento.valor),
    campo("rg", "RG", pessoa?.rg.valor),
    campo("profissao", "Profissão", pessoa?.profissao.valor),
    campo("renda", "Renda proposta para a FC", renda),
    campo("codigo_imovel", "Cód. imóvel", codigo),
    campo("logradouro", "Logradouro", logradouro),
    campo("numero", "Número", imovel.numero.valor),
    campo("complemento", "Complemento", imovel.complemento.valor),
    campo("aluguel", "Aluguel", imovel.aluguel.valor),
  ].filter((c): c is CampoParaCopiar => c != null);

  const solidarios = ficha.pessoas
    .filter((p) => p.papel === "solidario" || (p.papel === "inquilino" && !p.principal))
    .map((p) => {
      const digitos = soDigitosCpf(p.cpf.valor ?? "");
      return {
        nome: p.nome.valor?.trim() || "Colocatário",
        cpf_mascarado: digitos ? (mascararCpf(digitos) ?? "") : "",
      };
    })
    .filter((s) => s.nome);

  return {
    campos,
    solidarios,
    vigencia: vigenciaManual(opts.hoje),
    links: { fc: LINK_FC, migra: LINK_MIGRA },
  };
}

export const PASSOS_FC = [
  "Abra o site da FC Score+ (cliente.fcanalise.com.br) e entre com a conta da imobiliária.",
  "Preencha o formulário com os dados ao lado. Não envie arquivo — a FC só pede dados.",
  "Clique em SALVAR (é grátis e gera o ID-FC). Não clique em Processar ANÁLISE daqui do painel: o passo pago é só no site, se você decidir.",
  "Se processar no site, espere o laudo. Anote score, risco e o ID-FC e anexe o PDF aqui.",
] as const;

export const PASSOS_MIGRA = [
  "Abra o site da Migra (migra.app.br) e entre com a conta da imobiliária.",
  "Abra o Multi Cálculo PF Residencial e preencha com os dados ao lado. Colocatários entram como solidários.",
  "Clique em Analisar. Nunca clique em Contratar.",
  "Espere o modal, tire um print dos cards e registre seguradora, código, status e plano aqui.",
] as const;

export type ResultadoManualFcInput = {
  score?: number | string | null;
  risco?: string | null;
  id_fc?: string | null;
};

export function validarResultadoManualFc(input: ResultadoManualFcInput): string | null {
  const score = sanitizarResultadoFc({ score: input.score }).score;
  const risco = typeof input.risco === "string" ? input.risco.trim() : "";
  if (score == null && !risco) {
    return "Informe o score ou o risco da FC para registrar o resultado.";
  }
  return null;
}

export function resultadoManualFc(input: ResultadoManualFcInput, laudoDisponivel: boolean): ResultadoDaFc {
  return sanitizarResultadoFc({
    score: input.score ?? null,
    risco: input.risco ?? null,
    id_fc: input.id_fc ?? null,
    laudo_disponivel: laudoDisponivel,
    cobranca: null,
    reconfirmacao: null,
  });
}

export type CardManualInput = {
  seguradora?: string;
  codigo?: string;
  codigo_cotacao?: string;
  status?: string;
  plano?: string;
};

export function validarCardsManual(cards: unknown): string | null {
  const limpos = sanitizarCards(cards);
  if (limpos.length === 0) {
    return "Informe ao menos um card da cotação (seguradora).";
  }
  const primeiro = limpos[0];
  if (!primeiro || typeof primeiro !== "object") {
    return "Informe ao menos um card da cotação (seguradora).";
  }
  const o = primeiro as Record<string, unknown>;
  const tem =
    (typeof o.seguradora === "string" && o.seguradora.trim())
    || (typeof o.codigo === "string" && o.codigo.trim())
    || (typeof o.codigo_cotacao === "string" && o.codigo_cotacao.trim());
  if (!tem) return "Informe ao menos um card da cotação (seguradora).";
  return null;
}

export function resultadoManualSeguro(cards: unknown): Record<string, unknown> {
  return {
    cards: sanitizarCards(cards),
    print_disponivel: false,
  };
}

export function decodificarAnexoManual(
  dados: { bytes_b64?: string; mime?: string } | null | undefined,
  tipo: "laudo" | "print",
): LaudoDecodificado | PrintDecodificado | null {
  if (!dados?.bytes_b64) return null;
  if (tipo === "laudo") return decodificarLaudo({ arquivo_b64: dados.bytes_b64, mime: dados.mime });
  return decodificarPrint({ arquivo_b64: dados.bytes_b64, mime: dados.mime });
}
