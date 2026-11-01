/**
 * Máscara do locador na aba Dados. CPF/CNPJ e contato nunca vão inteiros
 * para a tela. Sem I/O. Sem logar o valor original.
 */
import { mascararCpf } from "@/lib/locacao/cpf";

function soDigitos(bruto: string): string {
  return bruto.replace(/\D/g, "");
}

export function mascararCnpj(bruto: string): string | null {
  const d = soDigitos(bruto);
  if (d.length !== 14) return null;
  return `**.***.***/****-${d.slice(12)}`;
}

export function mascararDocumentoLocador(bruto: string | null | undefined): string {
  if (!bruto || !bruto.trim()) return "";
  const texto = bruto.trim();
  return mascararCpf(texto) ?? mascararCnpj(texto) ?? texto.replace(/\d(?=\d{2})/g, "*");
}

export function mascararContatoLocador(bruto: string | null | undefined): string {
  if (!bruto || !bruto.trim()) return "";
  const texto = bruto.trim();
  if (texto.includes("@")) {
    const [local, dominio] = texto.split("@");
    if (!local || !dominio) return "[email]";
    return `${local.slice(0, 1)}***@${dominio}`;
  }
  const d = soDigitos(texto);
  if (d.length < 8) return texto.replace(/\d/g, "*");
  const ddd = d.length >= 10 ? d.slice(0, 2) : "";
  const fim = d.slice(-4);
  return ddd ? `(${ddd}) *****-${fim}` : `*****-${fim}`;
}
