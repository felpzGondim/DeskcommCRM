import type { FichaPreliminar, NumeroFicha, PessoaDaFicha } from "@/lib/locacao/ficha-schema";

/** Um valor operacional por pessoa; proveniência permanece no campo/histórico. */
export function rendaDaPessoa(ficha: FichaPreliminar, pessoa: PessoaDaFicha): number | null {
  if (pessoa.renda_individual.valor != null || pessoa.renda_individual.fonte === "atendente") return pessoa.renda_individual.valor;
  const candidatos = ficha.pessoas.filter((p) => p.papel !== "contato");
  // Legado: a renda agregada nunca é atribuída a várias pessoas.
  return candidatos.length === 1 && candidatos[0] === pessoa
    ? ficha.renda.mensal.valor ?? ficha.renda.proposta_fc.valor
    : null;
}

export function normalizarRendaUtilizada(ficha: FichaPreliminar): FichaPreliminar {
  const candidatos = ficha.pessoas.filter((p) => p.papel !== "contato");
  const legado = ficha.renda.mensal.valor != null ? ficha.renda.mensal : ficha.renda.proposta_fc;
  const pessoas = ficha.pessoas.map((p) => candidatos.length === 1 && p === candidatos[0]
    && p.renda_individual.valor == null && p.renda_individual.fonte !== "atendente" ? { ...p, renda_individual: { ...legado } } : p);
  const locatarios = pessoas.filter((p) => p.papel === "inquilino" || p.papel === "solidario");
  const completos = locatarios.length > 0 && locatarios.every((p) => p.renda_individual.valor != null);
  const renda: NumeroFicha = {
    ...ficha.renda.mensal,
    valor: completos ? Math.round(locatarios.reduce((s, p) => s + (p.renda_individual.valor ?? 0), 0) * 100) / 100 : null,
    fonte: locatarios.some((p) => p.renda_individual.fonte === "atendente") ? "atendente" : ficha.renda.mensal.fonte,
  };
  return { ...ficha, pessoas, renda: { ...ficha.renda, mensal: renda, proposta_fc: { ...renda } } };
}

/** Inicializa a única RENDA com o valor declarado; não atribui um total a várias pessoas. */
export function preencherRendaDeclaradaInicial(ficha: FichaPreliminar, centavos: number | null): FichaPreliminar {
  const candidatos = ficha.pessoas.filter((p) => p.papel !== "contato");
  if (candidatos.length !== 1 || centavos == null || centavos <= 0) return normalizarRendaUtilizada(ficha);
  const pessoa = candidatos[0]!;
  if (pessoa.renda_individual.valor != null || pessoa.renda_individual.fonte === "atendente") return normalizarRendaUtilizada(ficha);
  return normalizarRendaUtilizada({...ficha, pessoas: ficha.pessoas.map((p) => p !== pessoa ? p : {
    ...p, renda_individual: {...p.renda_individual, valor: Math.round(centavos) / 100, fonte: "conversa", trecho: "Renda declarada na conversa; não equivale à comprovação"},
  })});
}

/** Reextração preserva campos corrigidos pelo atendente, inclusive renda. */
export function preservarEdicoesHumanas(nova: FichaPreliminar, anterior: FichaPreliminar): FichaPreliminar {
  const preservar = (a: unknown, b: unknown): unknown => {
    if (!b || typeof b !== "object" || Array.isArray(b)) return a;
    const obj = b as Record<string, unknown>;
    if (obj.fonte === "atendente") return b;
    if (!a || typeof a !== "object" || Array.isArray(a)) return a;
    return Object.fromEntries(Object.entries(a).map(([k, v]) => [k, preservar(v, obj[k])]));
  };
  const pessoas = nova.pessoas.map((p) => {
    const cpf = p.cpf.valor?.replace(/\D/g, "");
    const antiga = anterior.pessoas.find((a) => cpf && a.cpf.valor?.replace(/\D/g, "") === cpf);
    return antiga ? preservar(p, antiga) as PessoaDaFicha : p;
  });
  // Não perde pessoas incluídas manualmente que a IA não reconheceu.
  for (const p of anterior.pessoas) {
    const cpf = p.cpf.valor?.replace(/\D/g, "");
    if (p.nome.fonte === "atendente" && !pessoas.some((n) =>
      cpf ? n.cpf.valor?.replace(/\D/g, "") === cpf : n.nome.valor === p.nome.valor)) pessoas.push(p);
  }
  return normalizarRendaUtilizada({
    ...nova, pessoas,
    imovel: preservar(nova.imovel, anterior.imovel) as FichaPreliminar["imovel"],
    vigencia: preservar(nova.vigencia, anterior.vigencia) as FichaPreliminar["vigencia"],
    contrato: preservar(nova.contrato, anterior.contrato) as FichaPreliminar["contrato"],
    garantia: preservar(nova.garantia, anterior.garantia) as FichaPreliminar["garantia"],
  });
}
