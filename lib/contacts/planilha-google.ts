/**
 * Exportação do Google Contatos (Contacts) — inglês e português.
 *
 * O CSV simples desta casa tem "nome,telefone". O do Google traz dezenas de
 * colunas (`Name`, `Given Name`, `Phone 1 - Value`…) e, numa mesma célula,
 * vários números separados por ` ::: `. Quem importa pela tela de Contatos
 * manda esse arquivo; a detecção é pelo cabeçalho, sem o operador mapear.
 *
 * Uma linha do Google vira UM candidato por telefone distinto: o CRM tem um
 * `phone_number` por contato. O nome é o mesmo em todos.
 */
import { normalizaCabecalho, normalizaTelefone, type LinhaNormalizada } from "@/lib/contacts/csv";

/** Separador que o Google usa quando a célula tem mais de um telefone/e-mail. */
const SEP_GOOGLE = /\s*:::\s*/;

const NOME_COMPLETO = new Set(["name", "nome"]);
const PRIMEIRO = new Set(["first_name", "given_name", "primeiro_nome", "nome_proprio"]);
const MEIO = new Set(["middle_name", "additional_name", "nome_do_meio", "nome_adicional"]);
const SOBRENOME = new Set(["last_name", "family_name", "sobrenome"]);

const TELEFONE_N = /^(phone|telefone)_\d+_val(?:ue|or)$/;
const EMAIL_N = /^e_?mail_\d+_val(?:ue|or)$/;

export interface IndicesGoogle {
  nomeCompleto?: number;
  primeiro?: number;
  meio?: number;
  sobrenome?: number;
  telefones: number[];
  emails: number[];
}

export function indicesGoogleContatos(header: string[]): IndicesGoogle | null {
  const telefones: number[] = [];
  const emails: number[] = [];
  let nomeCompleto: number | undefined;
  let primeiro: number | undefined;
  let meio: number | undefined;
  let sobrenome: number | undefined;

  header.forEach((bruto, idx) => {
    const n = normalizaCabecalho(bruto);
    if (TELEFONE_N.test(n)) {
      telefones.push(idx);
      return;
    }
    if (EMAIL_N.test(n)) {
      emails.push(idx);
      return;
    }
    if (NOME_COMPLETO.has(n) && nomeCompleto === undefined) {
      nomeCompleto = idx;
      return;
    }
    if (PRIMEIRO.has(n) && primeiro === undefined) {
      primeiro = idx;
      return;
    }
    if (MEIO.has(n) && meio === undefined) {
      meio = idx;
      return;
    }
    if (SOBRENOME.has(n) && sobrenome === undefined) {
      sobrenome = idx;
    }
  });

  if (telefones.length === 0 && emails.length === 0) return null;
  return { nomeCompleto, primeiro, meio, sobrenome, telefones, emails };
}

function celula(cells: string[], idx: number | undefined): string {
  if (idx === undefined) return "";
  return (cells[idx] ?? "").trim();
}

/**
 * Nome da linha: a coluna inteira (`Name`/`Nome`) quando tem texto; senão a
 * junção first/middle/last (e equivalentes). Se `Nome` veio só com o primeiro
 * nome e existe sobrenome que ainda não está nele, junta — export PT às vezes
 * grava o dado assim.
 */
export function nomeDaLinhaGoogle(cells: string[], i: IndicesGoogle): string | undefined {
  const full = celula(cells, i.nomeCompleto).replace(/\s+/g, " ");
  const partes = [celula(cells, i.primeiro), celula(cells, i.meio), celula(cells, i.sobrenome)]
    .map((p) => p.replace(/\s+/g, " "))
    .filter((p) => p !== "");
  const juntado = partes.join(" ");
  const sobrenome = celula(cells, i.sobrenome).replace(/\s+/g, " ");

  let escolhido = "";
  if (full !== "") {
    const fullNorm = full.toLocaleLowerCase("pt-BR");
    const sobNorm = sobrenome.toLocaleLowerCase("pt-BR");
    escolhido =
      sobrenome !== "" && sobNorm !== "" && !fullNorm.includes(sobNorm)
        ? `${full} ${sobrenome}`.replace(/\s+/g, " ")
        : full;
  } else {
    escolhido = juntado;
  }
  if (escolhido === "") return undefined;
  return escolhido.slice(0, 200);
}

function pedacosDaCelula(bruto: string): string[] {
  return bruto
    .split(SEP_GOOGLE)
    .map((p) => p.trim())
    .filter((p) => p !== "");
}

export function telefonesDaLinhaGoogle(cells: string[], i: IndicesGoogle): string[] {
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const idx of i.telefones) {
    for (const pedaco of pedacosDaCelula(celula(cells, idx))) {
      const tel = normalizaTelefone(pedaco);
      if (tel && !vistos.has(tel)) {
        vistos.add(tel);
        out.push(tel);
      }
    }
  }
  return out;
}

export function emailDaLinhaGoogle(cells: string[], i: IndicesGoogle): string | undefined {
  for (const idx of i.emails) {
    for (const pedaco of pedacosDaCelula(celula(cells, idx))) {
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pedaco)) return pedaco;
    }
  }
  return undefined;
}

/**
 * Uma linha do Google → um contato por telefone distinto. Sem telefone e com
 * e-mail, um contato só. Sem os dois, a linha é pulada com motivo.
 */
export function expandirLinhaGoogle(
  cells: string[],
  i: IndicesGoogle,
  t: (texto: string) => string = (x) => x,
): { contatos: LinhaNormalizada[]; motivo: string | null } {
  const name = nomeDaLinhaGoogle(cells, i);
  const telefones = telefonesDaLinhaGoogle(cells, i);
  const email = emailDaLinhaGoogle(cells, i);

  if (telefones.length === 0 && email === undefined) {
    return { contatos: [], motivo: t("linha sem telefone nem e-mail") };
  }

  const base: LinhaNormalizada = {};
  if (name) base.name = name;
  if (email) base.email = email;

  if (telefones.length === 0) {
    return { contatos: [base], motivo: null };
  }
  // Um e-mail por organização: só o primeiro telefone da linha o leva. Os
  // outros nascem só com o número — o WhatsApp casa pelo telefone.
  const semEmail: LinhaNormalizada = name ? { name } : {};
  return {
    contatos: telefones.map((phone_number, idx) =>
      idx === 0 ? { ...base, phone_number } : { ...semEmail, phone_number },
    ),
    motivo: null,
  };
}
