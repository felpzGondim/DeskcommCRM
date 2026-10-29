/**
 * Relatório financeiro no Painel (PR 4.5). Monta as 6 seções a partir
 * dos blocos já gravados. Sem Hub, sem passo pago, sem envio ao cliente.
 * A renda sai do motor do extrato e do pacote do #31 (ou do
 * `bloco_calculado` que o 4.1 já gravou com o mesmo motor).
 */
import { lerBlocoDeRendaSalvo } from "@/lib/locacao/analise/bloco-de-renda";
import { sanitizarResultadoFc } from "@/lib/locacao/analise/fc";
import { montarRelatorioFinanceiro } from "@/lib/locacao/analise/relatorio";
import { sanitizarCards } from "@/lib/locacao/analise/seguro";
import { analiseLigada, arquivosLigados } from "@/lib/locacao/chaves";
import { completarFicha } from "@/lib/locacao/ficha-schema";
import { lerFichaAtual } from "@/lib/locacao/ficha-repositorio";
import {
  gravarRascunhoRelatorio,
  guardarDocumentoRelatorio,
  lerAnaliseFcMaisRecenteDoProcesso,
  lerAnaliseSeguroMaisRecente,
  lerFichaAtualDoProcesso,
  lerProcesso,
  listarProcessosDaConversa,
  LocacaoErro,
  marcarRelatorioAprovado,
} from "@/lib/locacao/repositorio";
import { TEXTO_ANALISE_DESLIGADA } from "@/lib/painel/acoes/analise";
import { mascararPessoaNoTexto } from "@/lib/painel/mascarar";
import type { ContextoDaFerramenta, ResultadoDaFerramenta } from "@/lib/painel/ferramentas/tipos";

export const TEXTO_SEM_PROCESSO_RELATORIO = "Abra um processo de locação antes de gerar o relatório.";
export const TEXTO_SEM_RASCUNHO = "Gere o relatório antes de aprovar.";
export const TEXTO_RELATORIO_APROVADO = "Relatório aprovado.";
export const TEXTO_RELATORIO_GERADO = "Relatório financeiro gerado. Confira as seções antes de aprovar.";

function recusaDesligada(): ResultadoDaFerramenta {
  return { ok: false, texto: TEXTO_ANALISE_DESLIGADA, codigo: "tool_unavailable" };
}

async function processoDaConversa(
  ctx: ContextoDaFerramenta,
  processoId?: string,
): Promise<{ id: string } | ResultadoDaFerramenta> {
  if (processoId) {
    const linha = await lerProcesso(ctx.admin, ctx.orgId, processoId);
    if (!linha) return { ok: false, texto: TEXTO_SEM_PROCESSO_RELATORIO, codigo: "validation_error" };
    return { id: processoId };
  }
  const lista = await listarProcessosDaConversa(ctx.admin, ctx.orgId, ctx.conversationId);
  const primeiro = lista[0];
  const id = typeof primeiro?.id === "string" ? primeiro.id : "";
  if (!id) return { ok: false, texto: TEXTO_SEM_PROCESSO_RELATORIO, codigo: "validation_error" };
  return { id };
}

export async function gerarRelatorioDoPainel(
  ctx: ContextoDaFerramenta,
  args: { processo_id?: string } = {},
): Promise<ResultadoDaFerramenta> {
  if (!analiseLigada(ctx.settings, "relatorio")) return recusaDesligada();
  const alvo = await processoDaConversa(ctx, args.processo_id);
  if ("ok" in alvo) return alvo;
  try {
    const [processo, doProcesso, daConversa, fcLinha, seguroLinha] = await Promise.all([
      lerProcesso(ctx.admin, ctx.orgId, alvo.id),
      lerFichaAtualDoProcesso(ctx.admin, ctx.orgId, alvo.id),
      lerFichaAtual(ctx.admin, ctx.orgId, ctx.conversationId),
      lerAnaliseFcMaisRecenteDoProcesso(ctx.admin, ctx.orgId, alvo.id),
      lerAnaliseSeguroMaisRecente(ctx.admin, ctx.orgId, alvo.id),
    ]);
    const ficha = doProcesso?.ficha
      ? completarFicha(doProcesso.ficha)
      : (daConversa?.ficha ?? null);
    const renda = lerBlocoDeRendaSalvo(doProcesso?.ficha ?? ficha);
    const resultadoFc = sanitizarResultadoFc(fcLinha?.resultado);
    const resultadoSeguro = seguroLinha?.resultado && typeof seguroLinha.resultado === "object"
      ? (seguroLinha.resultado as Record<string, unknown>)
      : {};
    const montado = montarRelatorioFinanceiro({
      ficha,
      relatorioPreliminar: daConversa?.relatorio ?? null,
      rendaConfirmada: typeof processo?.renda_confirmada_em === "string",
      renda,
      fc: fcLinha ? resultadoFc : null,
      fcEstado: typeof fcLinha?.estado === "string" ? fcLinha.estado : null,
      seguroCards: sanitizarCards(resultadoSeguro.cards),
      seguroEstado: typeof seguroLinha?.estado === "string" ? seguroLinha.estado : null,
    });
    await gravarRascunhoRelatorio(ctx.admin, {
      orgId: ctx.orgId,
      processoId: alvo.id,
      userId: ctx.userId,
      texto: montado.texto,
    });
    return {
      ok: true,
      texto: mascararPessoaNoTexto(montado.texto),
      extra: {
        risco: montado.risco,
        secoes: montado.secoes,
        renda: montado.renda,
        rascunho: true,
      },
    };
  } catch (err) {
    if (err instanceof LocacaoErro) {
      return { ok: false, texto: "Não foi possível gravar o rascunho do relatório.", codigo: "internal_error" };
    }
    return { ok: false, texto: "Não foi possível gerar o relatório.", codigo: "internal_error" };
  }
}

export async function aprovarRelatorioDoPainel(
  ctx: ContextoDaFerramenta,
  args: { processo_id?: string } = {},
): Promise<ResultadoDaFerramenta> {
  if (!analiseLigada(ctx.settings, "relatorio")) return recusaDesligada();
  const alvo = await processoDaConversa(ctx, args.processo_id);
  if ("ok" in alvo) return alvo;
  const processo = await lerProcesso(ctx.admin, ctx.orgId, alvo.id);
  const rascunho = typeof processo?.relatorio_rascunho === "string" ? processo.relatorio_rascunho : "";
  if (!rascunho.trim() || !processo?.relatorio_rascunho_em) {
    return { ok: false, texto: TEXTO_SEM_RASCUNHO, codigo: "validation_error" };
  }
  try {
    let documentoId: string | null = null;
    if (arquivosLigados(ctx.settings)) {
      documentoId = await guardarDocumentoRelatorio(ctx.admin, {
        orgId: ctx.orgId,
        processoId: alvo.id,
        userId: ctx.userId,
        bytes: Buffer.from(rascunho, "utf8"),
      });
    }
    await marcarRelatorioAprovado(ctx.admin, {
      orgId: ctx.orgId,
      processoId: alvo.id,
      userId: ctx.userId,
      documentoId,
    });
    return {
      ok: true,
      texto: TEXTO_RELATORIO_APROVADO,
      extra: {
        aprovado: true,
        documento_id: documentoId,
        arquivos_ligados: arquivosLigados(ctx.settings),
      },
    };
  } catch (err) {
    if (err instanceof LocacaoErro) {
      return { ok: false, texto: "Não foi possível aprovar o relatório.", codigo: "internal_error" };
    }
    return { ok: false, texto: "Não foi possível aprovar o relatório.", codigo: "internal_error" };
  }
}
