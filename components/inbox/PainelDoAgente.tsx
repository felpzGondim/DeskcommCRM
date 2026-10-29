"use client";
/**
 * PAINEL DO AGENTE (parte 1) — a IA conversa com o ATENDENTE, na coluna direita
 * da conversa, logo abaixo do bloco Contato.
 *
 * Regras que esta tela não pode quebrar:
 *  · Nunca envia nada ao cliente. "Usar como resposta" só preenche a caixa de
 *    texto (Composer); quem envia é a pessoa.
 *  · Ações do Hub são mostradas a todos os atendentes; análise e criação de
 *    contrato exigem confirmação.
 *  · O histórico do painel é só da tela: troca de conversa = painel limpo.
 *  · Qual IA responde é escolhido em IA › Provedores, ponto
 *    "IA do painel do atendente" (`painel_atendente`).
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { copyToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { randomId } from "@/lib/random-id";
import { ACOES_HUB, type AcaoHub } from "@/lib/agent-engine/agent/painel-acoes-hub";
import { ProcessoDeLocacaoPainel } from "@/components/locacao/ProcessoDeLocacaoPainel";
import { FichaPreliminarPainel } from "./FichaPreliminarPainel";
import { GerarContratoDialog } from "./GerarContratoDialog";

type Acao = "resumir" | "sugerir" | "pergunta";

interface Turno {
  autor: "atendente" | "ia";
  texto: string;
  /** Resposta que pode virar mensagem (só as de "Sugerir resposta"). */
  sugestao?: boolean;
  links?: Array<{ rotulo: string; url: string }>;
}

interface Props {
  conversationId: string;
  /** Preenche o Composer. Ausente ⇒ o botão vira "Copiar". */
  onUsarComoResposta?: (texto: string) => void;
  /** Bloqueia os botões (ex.: acesso de suporte só leitura). */
  desabilitado?: boolean;
}

/** Quantos turnos do painel vão de volta ao servidor como contexto. */
const TURNOS_NO_CONTEXTO = 8;
const POLL_CONSULTA_MS = 1_000;
const AVISO_AINDA_PROCESSANDO_MS = 180_000;
const TIMEOUT_PERGUNTA_POST_MS = 15_000;
const TIMEOUT_RESUMO_SUGERIR_MS = 120_000;

export function PainelDoAgente({
  conversationId,
  onUsarComoResposta,
  desabilitado = false,
}: Props) {
  const t = useT();
  const [aberto, setAberto] = useState(true);
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [pergunta, setPergunta] = useState("");
  const [carregando, setCarregando] = useState<Acao | AcaoHub | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pedidoAnalise, setPedidoAnalise] = useState<{
    pedidoId: string;
    previaToken: string;
  } | null>(null);
  const [avisosAnexos, setAvisosAnexos] = useState<
    Array<{ tipo: string; nome: string; tentativas?: number }>
  >([]);
  const [senhasPdf, setSenhasPdf] = useState<Record<string, string>>({});
  const [limitesAnexos, setLimitesAnexos] = useState<string | null>(null);
  const [consultaId, setConsultaId] = useState<string | null>(null);
  const [etapa, setEtapa] = useState<string | null>(null);
  const [propostas, setPropostas] = useState<Array<{ ferramenta: string; motivo: string }>>([]);
  const [podeContinuar, setPodeContinuar] = useState(false);
  const [ultimaPergunta, setUltimaPergunta] = useState("");
  const [ultimoModo, setUltimoModo] = useState<"normal" | "analise" | null>(null);
  const conversaAtual = useRef(conversationId);
  const esperandoConsulta = useRef(false);
  const inicioDaConsulta = useRef(0);

  // Troca de conversa = painel limpo: quem usa o painel passa
  // `key={conversationId}`, e o React remonta tudo do zero. A ref abaixo só
  // descarta uma resposta que chegue depois da troca.
  useEffect(() => {
    conversaAtual.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    if (carregando !== "pergunta" || !consultaId) return;
    let cancelado = false;
    const tick = async () => {
      try {
        const r = await apiClient.get<{
          data: {
            etapa: string | null;
            status: string;
            resposta?: string | null;
            propostas?: Array<{ ferramenta: string; motivo: string }>;
            parou_por?: string | null;
            modo?: "normal" | "analise" | null;
          };
        }>(`/api/v1/conversations/${conversationId}/painel-agente?consulta_id=${consultaId}`);
        if (cancelado) return;
        const status = r.data?.status;
        if (status === "pronto" || status === "erro" || status === "interrompida") {
          esperandoConsulta.current = false;
          if (status === "interrompida") {
            setErro(t("A consulta foi interrompida. Tente de novo."));
          } else {
            const resposta = (r.data?.resposta ?? "").trim();
            if (status === "erro" && !resposta) {
              setErro(t("Não deu para responder agora."));
            } else {
              setTurnos((ts) => [
                ...ts,
                {
                  autor: "ia",
                  texto: resposta || t("A IA não devolveu texto."),
                  sugestao: !!resposta,
                },
              ]);
              setPropostas(r.data?.propostas ?? []);
              setPodeContinuar(!!r.data?.parou_por && r.data.parou_por !== "fim");
              if (r.data?.modo) setUltimoModo(r.data.modo);
            }
          }
          setCarregando(null);
          setEtapa(null);
          setConsultaId(null);
          return;
        }
        if (Date.now() - inicioDaConsulta.current > AVISO_AINDA_PROCESSANDO_MS) {
          setEtapa(t("Ainda processando…"));
        } else if (r.data?.etapa) {
          setEtapa(r.data.etapa);
        }
      } catch {
        /* kill switch desligado ou consulta ainda não gravada */
        if (!cancelado && Date.now() - inicioDaConsulta.current > AVISO_AINDA_PROCESSANDO_MS) {
          setEtapa(t("Ainda processando…"));
        }
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), POLL_CONSULTA_MS);
    return () => {
      cancelado = true;
      window.clearInterval(id);
    };
  }, [carregando, consultaId, conversationId, t]);

  async function pedir(acao: Acao, textoLivre?: string) {
    if (carregando || desabilitado) return;
    const texto = (textoLivre ?? pergunta).trim();
    if (acao === "pergunta" && texto.length < 3) return;
    const rotulo =
      acao === "resumir"
        ? t("Resumir conversa")
        : acao === "sugerir"
          ? t("Sugerir resposta")
          : texto;
    const historico = turnos
      .slice(-TURNOS_NO_CONTEXTO)
      .map(({ autor, texto: tx }) => ({ autor, texto: tx.slice(0, 4000) }));
    const daConversa = conversationId;
    setErro(null);
    setCarregando(acao);
    setPropostas([]);
    setPodeContinuar(false);
    const novaConsulta = acao === "pergunta" ? randomId() : null;
    if (acao === "pergunta") {
      esperandoConsulta.current = true;
      inicioDaConsulta.current = Date.now();
      setConsultaId(novaConsulta);
      setEtapa(t("gerando resumo…"));
      setUltimaPergunta(texto);
    } else {
      esperandoConsulta.current = false;
    }
    setTurnos((ts) => [...ts, { autor: "atendente", texto: rotulo }]);
    if (acao === "pergunta") setPergunta("");
    try {
      const r = await apiClient.post<{
        data: {
          resposta?: string;
          status?: string;
          consulta_id?: string;
          propostas?: Array<{ ferramenta: string; motivo: string }>;
          parou_por?: string;
          modo?: "normal" | "analise";
          sugestao?: boolean;
        };
      }>(
        `/api/v1/conversations/${daConversa}/painel-agente`,
        {
          acao,
          ...(acao === "pergunta"
            ? {
                pergunta: texto,
                consulta_id: novaConsulta,
                ...(textoLivre && ultimoModo ? { modo: ultimoModo } : {}),
              }
            : {}),
          historico,
        },
        { timeoutMs: acao === "pergunta" ? TIMEOUT_PERGUNTA_POST_MS : TIMEOUT_RESUMO_SUGERIR_MS },
      );
      if (conversaAtual.current !== daConversa) return;
      if (
        acao === "pergunta" &&
        (r.data?.status === "rodando" || (!r.data?.resposta && r.data?.consulta_id))
      ) {
        return;
      }
      esperandoConsulta.current = false;
      const resposta = (r.data?.resposta ?? "").trim();
      const viraSugestao = (acao === "sugerir" || acao === "pergunta") && !!resposta;
      setTurnos((ts) => [
        ...ts,
        { autor: "ia", texto: resposta || t("A IA não devolveu texto."), sugestao: viraSugestao },
      ]);
      setPropostas(r.data?.propostas ?? []);
      setPodeContinuar(!!r.data?.parou_por && r.data.parou_por !== "fim");
      if (r.data?.modo) setUltimoModo(r.data.modo);
    } catch (e) {
      if (conversaAtual.current !== daConversa) return;
      esperandoConsulta.current = false;
      const msg = e instanceof Error && e.message ? e.message : t("Não deu para responder agora.");
      setErro(msg);
    } finally {
      if (conversaAtual.current === daConversa && !esperandoConsulta.current) {
        setCarregando(null);
        setEtapa(null);
        setConsultaId(null);
      }
    }
  }

  async function chamarHub(acao: AcaoHub) {
    if (carregando || desabilitado) return;
    const daConversa = conversationId;
    setErro(null);
    setCarregando(acao);
    try {
      const senhas = Object.entries(senhasPdf)
        .filter(([, senha]) => senha.trim().length > 0)
        .map(([nome, senha]) => ({ nome, senha }));
      const r = await apiClient.post<{
        data: { resumo: string; sugestao?: string; links?: Array<{ rotulo: string; url: string }> };
      }>(
        `/api/v1/conversations/${daConversa}/painel-agente/acoes`,
        acao === "analise"
          ? {
              acao,
              etapa: "confirmar",
              confirmar: true,
              pedidoId: pedidoAnalise?.pedidoId,
              previaToken: pedidoAnalise?.previaToken,
              ...(senhas.length ? { senhasPdf: senhas } : {}),
            }
          : { acao },
      );
      if (conversaAtual.current !== daConversa) return;
      setTurnos((ts) => [
        ...ts,
        { autor: "atendente", texto: t(ACOES_HUB[acao].rotulo) },
        { autor: "ia", texto: r.data.resumo, links: r.data.links },
        ...(r.data.sugestao
          ? [{ autor: "ia" as const, texto: r.data.sugestao, sugestao: true }]
          : []),
      ]);
      if (acao === "analise") setPedidoAnalise(null);
    } catch (e) {
      if (conversaAtual.current !== daConversa) return;
      setErro(
        e instanceof Error && e.message
          ? e.message
          : t("Não foi possível consultar o Brisa Hub agora."),
      );
    } finally {
      if (conversaAtual.current === daConversa) setCarregando(null);
    }
  }

  async function prepararAnalise() {
    if (carregando || desabilitado) return;
    const daConversa = conversationId;
    setErro(null);
    setPedidoAnalise(null);
    setCarregando("analise");
    try {
      const senhas = Object.entries(senhasPdf)
        .filter(([, senha]) => senha.trim().length > 0)
        .map(([nome, senha]) => ({ nome, senha }));
      const r = await apiClient.post<{
        data: {
          resumo: string;
          previaToken: string | null;
          pronto: boolean;
          avisos?: Array<{ tipo: string; nome: string; tentativas?: number }>;
          limites?: string;
        };
      }>(`/api/v1/conversations/${daConversa}/painel-agente/acoes`, {
        acao: "analise",
        etapa: "preparar",
        ...(senhas.length ? { senhasPdf: senhas } : {}),
      });
      if (conversaAtual.current !== daConversa) return;
      setTurnos((ts) => [
        ...ts,
        { autor: "atendente", texto: t("Preparar análise de inquilino") },
        { autor: "ia", texto: r.data.resumo },
      ]);
      setAvisosAnexos(r.data.avisos ?? []);
      setLimitesAnexos(r.data.limites ?? null);
      if (r.data.pronto && r.data.previaToken) {
        setPedidoAnalise({ pedidoId: randomId(), previaToken: r.data.previaToken });
      }
    } catch (e) {
      if (conversaAtual.current === daConversa)
        setErro(
          e instanceof Error && e.message ? e.message : t("Não foi possível preparar a análise."),
        );
    } finally {
      if (conversaAtual.current === daConversa) setCarregando(null);
    }
  }

  function usar(texto: string) {
    if (onUsarComoResposta) {
      onUsarComoResposta(texto);
      toast.success(t("Texto colocado na caixa de resposta. Revise e envie."));
      return;
    }
    void copyToClipboard(texto).then((ok) => {
      if (ok) toast.success(t("Copiado."));
    });
  }

  return (
    <section aria-label={t("Painel do agente")} data-testid="painel-do-agente">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-text">{t("Painel do agente")}</h3>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[11px]"
          aria-expanded={aberto}
          onClick={() => setAberto((v) => !v)}
        >
          {aberto ? t("Recolher") : t("Abrir")}
        </Button>
      </div>
      {aberto && (
        <Card className="mt-2 space-y-2 p-3 text-sm">
          <p className="text-[11px] text-muted-foreground">
            {t("Só você vê este painel. Nada aqui é enviado ao cliente.")}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {t(
              "A análise lê o conteúdo dos anexos (foto, PDF e PDF escaneado). PDF com senha pede a senha aqui.",
            )}
            {limitesAnexos ? ` ${limitesAnexos}` : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              disabled={desabilitado || carregando !== null}
              onClick={() => void pedir("resumir")}
            >
              {carregando === "resumir" ? t("Lendo a conversa…") : t("Resumir conversa")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              disabled={desabilitado || carregando !== null}
              onClick={() => void pedir("sugerir")}
            >
              {carregando === "sugerir" ? t("Escrevendo…") : t("Sugerir resposta")}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2" aria-label={t("Ações do Brisa Hub")}>
            <GerarContratoDialog
              key={conversationId}
              conversationId={conversationId}
              desabilitado={desabilitado || carregando !== null}
            />
            {(["boletos", "contrato", "ficha"] as const).map((acao) => (
              <Button
                key={acao}
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                disabled={desabilitado || carregando !== null}
                onClick={() => void chamarHub(acao)}
              >
                {t(ACOES_HUB[acao].rotulo)}
              </Button>
            ))}
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              disabled={desabilitado || carregando !== null}
              onClick={() => void prepararAnalise()}
            >
              {t(ACOES_HUB.analise.rotulo)}
            </Button>
          </div>
          <FichaPreliminarPainel
            conversationId={conversationId}
            desabilitado={desabilitado || carregando !== null}
            senhasPdf={Object.entries(senhasPdf)
              .filter(([, senha]) => senha)
              .map(([nome, senha]) => ({ nome, senha }))}
          />
          <ProcessoDeLocacaoPainel
            conversationId={conversationId}
            desabilitado={desabilitado || carregando !== null}
          />
          {turnos.length > 0 && (
            <ol className="max-h-80 space-y-2 overflow-y-auto" aria-live="polite">
              {turnos.map((turno, i) => (
                <li
                  key={i}
                  className={cn(
                    "rounded-md px-2 py-1.5 text-xs whitespace-pre-wrap",
                    turno.autor === "atendente" ? "bg-muted text-text" : "border border-border",
                  )}
                >
                  <span className="sr-only">
                    {turno.autor === "atendente" ? t("Você") : t("IA")}:{" "}
                  </span>
                  {turno.texto}
                  {turno.autor === "ia" &&
                    turno.links?.map((link) => (
                      <a
                        key={link.url}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 block text-primary underline"
                      >
                        {t(link.rotulo)}
                      </a>
                    ))}
                  {turno.autor === "ia" && turno.sugestao && (
                    <div className="mt-1.5">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-6 px-2 text-[11px]"
                        disabled={desabilitado}
                        onClick={() => usar(turno.texto)}
                      >
                        {onUsarComoResposta ? t("Usar como resposta") : t("Copiar")}
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}

          {avisosAnexos.some((a) => a.tipo === "pdf_protegido") && (
            <div
              className="space-y-2 rounded-md border border-border p-2"
              role="group"
              aria-label={t("Informe a senha do PDF protegido")}
            >
              <p className="text-[11px] text-muted-foreground">
                {t(
                  "Este PDF está protegido por senha. Digite a senha para a análise ler o arquivo. A senha não é gravada.",
                )}
              </p>
              {avisosAnexos
                .filter((a) => a.tipo === "pdf_protegido")
                .map((aviso) => (
                  <label key={aviso.nome} className="block space-y-1">
                    <span className="text-[11px] font-medium">
                      {t("Senha do PDF")}: {aviso.nome}
                    </span>
                    {(aviso.tentativas ?? 0) >= 3 ? (
                      <p className="text-[11px] text-destructive">
                        {t("Três tentativas falharam. Este arquivo fica pendente.")}
                      </p>
                    ) : (
                      <Input
                        type="password"
                        autoComplete="off"
                        className="h-8 text-xs"
                        value={senhasPdf[aviso.nome] ?? ""}
                        onChange={(e) =>
                          setSenhasPdf((atual) => ({ ...atual, [aviso.nome]: e.target.value }))
                        }
                        aria-label={`${t("Senha do PDF")} ${aviso.nome}`}
                      />
                    )}
                  </label>
                ))}
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                disabled={desabilitado || carregando !== null}
                onClick={() => void prepararAnalise()}
              >
                {t("Ler de novo com a senha")}
              </Button>
            </div>
          )}

          {pedidoAnalise && (
            <div
              className="rounded-md border border-border p-2 text-xs"
              role="group"
              aria-label={t("Confirmar análise")}
            >
              <p>
                {t(
                  "Confira a prévia acima e os documentos originais. Confirmar cria o pedido de análise no Brisa Hub; a cobrança FC Score+ ainda exige confirmação posterior.",
                )}
              </p>
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  disabled={desabilitado || carregando !== null}
                  onClick={() => void chamarHub("analise")}
                >
                  {t("Confirmar análise")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPedidoAnalise(null)}>
                  {t("Cancelar")}
                </Button>
              </div>
            </div>
          )}

          {carregando === "pergunta" && etapa && (
            <p role="status" aria-live="polite" className="text-[11px] text-muted-foreground">
              {etapa}
            </p>
          )}

          {propostas.length > 0 && (
            <div className="space-y-2" aria-label={t("Ações propostas")}>
              {propostas.map((p) => (
                <div key={p.ferramenta} className="rounded-md border border-border p-2 text-xs">
                  <p>{p.motivo}</p>
                  {p.ferramenta === "iniciar_analise" && (
                    <Button
                      size="sm"
                      className="mt-1.5 h-7 px-2 text-xs"
                      disabled={desabilitado || carregando !== null}
                      onClick={() => void prepararAnalise()}
                    >
                      {t("Preparar análise")}
                    </Button>
                  )}
                  {p.ferramenta === "confirmar_contrato" && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {t(
                        "Use Gerar contrato para conferir a prévia e confirmar. A IA não confirma sozinha.",
                      )}
                    </p>
                  )}
                  {p.ferramenta === "confirmar_renda" && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {t("Use Analisar renda no processo para conferir e confirmar. A IA não confirma sozinha.")}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {podeContinuar && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              disabled={desabilitado || carregando !== null}
              onClick={() => void pedir("pergunta", ultimaPergunta || "continue")}
            >
              {t("Continuar")}
            </Button>
          )}

          {erro && (
            <p role="alert" className="text-xs text-destructive">
              {erro}
            </p>
          )}

          <form
            className="flex flex-col gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void pedir("pergunta");
            }}
          >
            <Textarea
              value={pergunta}
              onChange={(e) => setPergunta(e.target.value)}
              placeholder={t("Pergunte algo sobre esta conversa…")}
              maxLength={1000}
              rows={2}
              disabled={desabilitado}
              className="min-h-0 text-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void pedir("pergunta");
                }
              }}
            />
            <Button
              type="submit"
              size="sm"
              className="h-7 self-end px-3 text-xs"
              disabled={desabilitado || carregando !== null || pergunta.trim().length < 3}
            >
              {carregando === "pergunta" ? t("Pensando…") : t("Perguntar")}
            </Button>
          </form>
        </Card>
      )}
    </section>
  );
}
