/**
 * ÚNICO registro de ferramentas do Painel do agente.
 * Botão e campo /pergunta passam por `executarFerramenta` — mesma entrada.
 * Nível P não existe. C e S nunca entram no ToolSet do modelo.
 */
import { z } from "zod";

import { analisarRendaDoPainel, confirmarRendaDoPainel } from "@/lib/painel/acoes/analise";
import { consultarLeituraHub, executarConsultaHub, NOMES_HUB_IMOVEL, NOMES_HUB_PESSOAS, confirmarAnaliseHub, prepararAnaliseHub } from "@/lib/painel/acoes/hub";
import { lerAnexoDoPainel } from "@/lib/painel/acoes/anexo";
import { confirmarContratoDoPainel, prepararContratoDoPainel } from "@/lib/painel/acoes/contrato";
import { lerConversaDoPainel, resumirOuSugerir } from "@/lib/painel/acoes/conversa";
import { gerarRelatorioPreliminarDoPainel, lerFichaDoPainel } from "@/lib/painel/acoes/ficha";
import { lerFcExistenteDoPainel, lerProcessoDoPainel } from "@/lib/painel/acoes/processo";
import { dadosContratoSchema } from "@/lib/agent-engine/agent/painel-contrato";
import type { DefinicaoDaFerramenta, NivelFerramenta } from "./tipos";

const vazio = z.object({}).strict();

export const FERRAMENTAS_DO_PAINEL: readonly DefinicaoDaFerramenta[] = [
  {
    nome: "ler_conversa",
    descricao: "Lê mais mensagens desta conversa (texto). Filtro opcional de data ISO e limite até 200.",
    nivel: "L",
    entrada: z.object({ limite: z.number().int().min(1).max(200).optional(), a_partir_de: z.string().datetime().optional() }).strict(),
    rotuloAndamento: "lendo a conversa…",
    padraoLigada: true,
    executar: (ctx, args) => lerConversaDoPainel(ctx, (args ?? {}) as { limite?: number; a_partir_de?: string }),
  },
  {
    nome: "ler_anexo",
    descricao: "Lê o texto extraído de um anexo (foto/PDF). A leitura por visão gasta modelo e conta no teto de análise.",
    nivel: "L",
    entrada: z.object({ nome: z.string().max(120).optional(), message_id: z.string().uuid().optional(), senha: z.string().max(200).optional() }).strict(),
    rotuloAndamento: "lendo anexos…",
    padraoLigada: true,
    executar: (ctx, args) => lerAnexoDoPainel(ctx, (args ?? {}) as { nome?: string; message_id?: string; senha?: string }),
  },
  {
    nome: "resumir_conversa",
    descricao: "Resumo curto da conversa para o atendente. Mesma ação do botão Resumir conversa.",
    nivel: "L",
    entrada: vazio,
    rotuloAndamento: "gerando resumo…",
    acaoDoBotao: "resumir",
    padraoLigada: true,
    executar: (ctx) => resumirOuSugerir(ctx, "resumir"),
  },
  {
    nome: "sugerir_resposta",
    descricao: "Escreve uma resposta pronta. Só preenche o Composer; nunca envia ao cliente. Mesma ação do botão Sugerir resposta.",
    nivel: "L",
    entrada: z.object({ orientacao: z.string().max(500).optional() }).strict(),
    rotuloAndamento: "escrevendo sugestão…",
    acaoDoBotao: "sugerir",
    padraoLigada: true,
    executar: (ctx, args) =>
      resumirOuSugerir(ctx, "sugerir", (args as { orientacao?: string } | null)?.orientacao ?? null),
  },
  {
    nome: "consultar_contrato",
    descricao: "Consulta o contrato ativo no Brisa Hub (só leitura). Mesma ação do botão Consultar contrato e inquilino.",
    nivel: "L",
    entrada: vazio,
    rotuloAndamento: "consultando Superlógica…",
    acaoDoBotao: "contrato",
    padraoLigada: true,
    executar: (ctx) => executarConsultaHub(ctx, "contrato"),
  },
  {
    nome: "consultar_inquilino",
    descricao: "Consulta a pessoa/inquilino no Brisa Hub (só leitura). Se o Hub não anunciar a ferramenta, avisa.",
    nivel: "L",
    entrada: vazio,
    rotuloAndamento: "consultando Superlógica…",
    padraoLigada: true,
    executar: (ctx) =>
      consultarLeituraHub(
        ctx,
        NOMES_HUB_PESSOAS,
        "O Brisa Hub não anuncia consulta de inquilino/pessoa nesta instalação.",
      ),
  },
  {
    nome: "consultar_imovel",
    descricao: "Consulta o imóvel no Brisa Hub (só leitura). Se o Hub não anunciar a ferramenta, avisa.",
    nivel: "L",
    entrada: vazio,
    rotuloAndamento: "consultando Superlógica…",
    padraoLigada: true,
    executar: (ctx) =>
      consultarLeituraHub(ctx, NOMES_HUB_IMOVEL, "O Brisa Hub não anuncia consulta de imóvel nesta instalação."),
  },
  {
    nome: "buscar_boletos",
    descricao: "Consulta boletos em aberto (só leitura). Usa os 3 dígitos que o cliente enviou; nunca pede CPF completo. Mesma ação do botão Buscar boletos.",
    nivel: "L",
    entrada: vazio,
    rotuloAndamento: "consultando Superlógica…",
    acaoDoBotao: "boletos",
    padraoLigada: true,
    executar: (ctx) => executarConsultaHub(ctx, "boletos"),
  },
  {
    nome: "consultar_ficha",
    descricao: "Consulta documentos da ficha no Brisa Hub (só leitura). Mesma ação do botão Ficha cadastral / pedir documentos.",
    nivel: "L",
    entrada: vazio,
    rotuloAndamento: "consultando Superlógica…",
    acaoDoBotao: "ficha",
    padraoLigada: true,
    executar: (ctx) => executarConsultaHub(ctx, "ficha"),
  },
  {
    nome: "ler_ficha",
    descricao: "Lê a ficha preliminar já gravada nesta conversa (não chama o Hub).",
    nivel: "L",
    entrada: vazio,
    rotuloAndamento: "lendo a ficha…",
    padraoLigada: true,
    executar: (ctx) => lerFichaDoPainel(ctx),
  },
  {
    nome: "gerar_relatorio_preliminar",
    descricao: "Gera o relatório preliminar e a ficha JSON a partir da conversa e anexos. Mesma ação do botão Gerar relatório preliminar. Não chama FC nem grava Superlógica.",
    nivel: "L",
    entrada: z.object({ senhas: z.record(z.string(), z.string()).optional() }).strict(),
    rotuloAndamento: "gerando relatório…",
    acaoDoBotao: "relatorio_preliminar",
    padraoLigada: true,
    executar: (ctx, args) =>
      gerarRelatorioPreliminarDoPainel(ctx, (args as { senhas?: Record<string, string> } | null)?.senhas ?? {}),
  },
  {
    nome: "ler_processo",
    descricao: "Lê o processo de locação da Fase 3 ligado a esta conversa (status, participantes mascarados). Só se processos_habilitado.",
    nivel: "L",
    entrada: vazio,
    rotuloAndamento: "lendo o processo…",
    padraoLigada: true,
    executar: (ctx) => lerProcessoDoPainel(ctx),
  },
  {
    nome: "ler_fc_existente",
    descricao: "Lê laudo FC já existente (reaproveitável até 90 dias). Nunca dispara FC nova.",
    nivel: "L",
    entrada: z.object({ cpf_hash: z.string().max(128).optional() }).strict(),
    rotuloAndamento: "lendo FC existente…",
    padraoLigada: true,
    executar: (ctx, args) => lerFcExistenteDoPainel(ctx, (args ?? {}) as { cpf_hash?: string }),
  },
  {
    nome: "preparar_analise",
    descricao: "Monta a prévia da análise (leitura de anexos + relatório interno). Não cobra FC. Mesma ação do primeiro clique em Iniciar análise.",
    nivel: "L",
    entrada: z.object({ senhas: z.record(z.string(), z.string()).optional() }).strict(),
    rotuloAndamento: "preparando análise…",
    acaoDoBotao: "analise_preparar",
    padraoLigada: true,
    executar: (ctx, args) =>
      prepararAnaliseHub(ctx, (args as { senhas?: Record<string, string> } | null)?.senhas ?? {}),
  },
  {
    nome: "iniciar_analise",
    descricao: "Inicia a análise paga (FC Score+/Migra) no Hub. Nível C: o modelo só PROPÕE; o atendente clica em Confirmar análise.",
    nivel: "C",
    entrada: z
      .object({
        pedidoId: z.string().uuid(),
        previaToken: z.string().min(1).max(20_000),
        senhas: z.record(z.string(), z.string()).optional(),
      })
      .strict(),
    rotuloAndamento: "iniciando análise…",
    acaoDoBotao: "analise_confirmar",
    padraoLigada: true,
    executar: async (ctx, args) => {
      const a = args as { pedidoId: string; previaToken: string; senhas?: Record<string, string> };
      try {
        return await confirmarAnaliseHub(ctx, { pedidoId: a.pedidoId, previaToken: a.previaToken, senhasPdf: a.senhas });
      } catch (e) {
        const { ehFalhaDoHub } = await import("@/lib/painel/acoes/hub");
        if (ehFalhaDoHub(e)) return { ok: false, texto: e.message, codigo: e.codigo };
        throw e;
      }
    },
  },
  {
    nome: "preparar_contrato",
    descricao: "Prepara a prévia do contrato no Hub (não grava). Mesma ação de Preparar locação.",
    nivel: "L",
    entrada: dadosContratoSchema,
    rotuloAndamento: "preparando contrato…",
    acaoDoBotao: "contrato_preparar",
    padraoLigada: true,
    executar: (ctx, args) => prepararContratoDoPainel(ctx, dadosContratoSchema.parse(args)),
  },
  {
    nome: "confirmar_contrato",
    descricao: "Confirma a criação do contrato no Superlógica. Nível S: o modelo só PROPÕE; qualquer atendente clica no painel.",
    nivel: "S",
    entrada: z.object({ token: z.string().min(1).max(2000) }).strict(),
    rotuloAndamento: "confirmando contrato…",
    acaoDoBotao: "contrato_confirmar",
    padraoLigada: true,
    executar: (ctx, args) => confirmarContratoDoPainel(ctx, (args as { token: string }).token),
  },
  {
    nome: "analisar_renda",
    descricao: "Analisa a renda do candidato a inquilino a partir da conversa e dos PDFs originais. Exclui autotransferência, poupança e Rende Fácil; PIX de terceiros fica à parte. Não confirma sozinha.",
    nivel: "L",
    entrada: z.object({
      processo_id: z.string().uuid().optional(),
      participante_id: z.string().uuid().optional(),
      senhas: z.record(z.string(), z.string()).optional(),
    }).strict(),
    rotuloAndamento: "analisando renda…",
    acaoDoBotao: "analisar_renda",
    padraoLigada: true,
    exigeChaveAnalise: "renda",
    executar: (ctx, args) =>
      analisarRendaDoPainel(ctx, (args ?? {}) as {
        processo_id?: string;
        participante_id?: string;
        senhas?: Record<string, string>;
      }),
  },
  {
    nome: "confirmar_renda",
    descricao: "Confirma a renda analisada. Nível S: o modelo só PROPÕE; qualquer atendente clica no painel. Sem renda confirmada, seguro e FC ficam recusados.",
    nivel: "S",
    entrada: z.object({
      processo_id: z.string().uuid().optional(),
      renda_proposta_fc: z.number().finite().nonnegative().optional(),
    }).strict(),
    rotuloAndamento: "confirmando renda…",
    acaoDoBotao: "confirmar_renda",
    padraoLigada: true,
    exigeChaveAnalise: "renda",
    executar: (ctx, args) =>
      confirmarRendaDoPainel(ctx, (args ?? {}) as { processo_id?: string; renda_proposta_fc?: number }),
  },
];

const POR_NOME = new Map(FERRAMENTAS_DO_PAINEL.map((f) => [f.nome, f]));

export function ferramentaDoPainel(nome: string): DefinicaoDaFerramenta | undefined {
  return POR_NOME.get(nome);
}

export function ferramentasDoNivel(nivel: NivelFerramenta): readonly DefinicaoDaFerramenta[] {
  return FERRAMENTAS_DO_PAINEL.filter((f) => f.nivel === nivel);
}

export function nomesProibidosNoRegistro(): string[] {
  return FERRAMENTAS_DO_PAINEL.filter((f) =>
    /send|enviar|criar|editar|apagar|delete|write|gravar_super|escrever/.test(f.nome),
  ).map((f) => f.nome);
}

export const NOMES_C_OU_S = FERRAMENTAS_DO_PAINEL.filter((f) => f.nivel === "C" || f.nivel === "S").map((f) => f.nome);

export const FERRAMENTAS_DE_ANALISE = new Set([
  "ler_anexo",
  "gerar_relatorio_preliminar",
  "preparar_analise",
  "iniciar_analise",
  "analisar_renda",
]);
