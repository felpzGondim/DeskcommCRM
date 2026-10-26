"use client";
/**
 * PAINEL DO AGENTE (parte 1) — a IA conversa com o ATENDENTE, na coluna direita
 * da conversa, logo abaixo do bloco Contato.
 *
 * Regras que esta tela não pode quebrar:
 *  · Nunca envia nada ao cliente. "Usar como resposta" só preenche a caixa de
 *    texto (Composer); quem envia é a pessoa.
 *  · Ações do Hub são mostradas a todos os atendentes; a análise exige confirmação.
 *  · O histórico do painel é só da tela: troca de conversa = painel limpo.
 *  · Qual IA responde é escolhido em IA › Provedores, ponto
 *    "IA do painel do atendente" (`painel_atendente`).
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { copyToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { ACOES_HUB, type AcaoHub } from "@/lib/agent-engine/agent/painel-acoes-hub";

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

export function PainelDoAgente({ conversationId, onUsarComoResposta, desabilitado = false }: Props) {
  const t = useT();
  const [aberto, setAberto] = useState(true);
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [pergunta, setPergunta] = useState("");
  const [carregando, setCarregando] = useState<Acao | AcaoHub | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pedidoAnalise, setPedidoAnalise] = useState<string | null>(null);
  const conversaAtual = useRef(conversationId);

  // Troca de conversa = painel limpo: quem usa o painel passa
  // `key={conversationId}`, e o React remonta tudo do zero. A ref abaixo só
  // descarta uma resposta que chegue depois da troca.
  useEffect(() => {
    conversaAtual.current = conversationId;
  }, [conversationId]);

  async function pedir(acao: Acao) {
    if (carregando || desabilitado) return;
    const texto = pergunta.trim();
    if (acao === "pergunta" && texto.length < 3) return;
    const rotulo =
      acao === "resumir" ? t("Resumir conversa") : acao === "sugerir" ? t("Sugerir resposta") : texto;
    const historico = turnos
      .slice(-TURNOS_NO_CONTEXTO)
      .map(({ autor, texto: tx }) => ({ autor, texto: tx.slice(0, 4000) }));
    const daConversa = conversationId;
    setErro(null);
    setCarregando(acao);
    setTurnos((ts) => [...ts, { autor: "atendente", texto: rotulo }]);
    if (acao === "pergunta") setPergunta("");
    try {
      const r = await apiClient.post<{ data: { resposta: string } }>(
        `/api/v1/conversations/${daConversa}/painel-agente`,
        { acao, ...(acao === "pergunta" ? { pergunta: texto } : {}), historico },
      );
      if (conversaAtual.current !== daConversa) return;
      const resposta = (r.data?.resposta ?? "").trim();
      setTurnos((ts) => [
        ...ts,
        { autor: "ia", texto: resposta || t("A IA não devolveu texto."), sugestao: acao === "sugerir" && !!resposta },
      ]);
    } catch (e) {
      if (conversaAtual.current !== daConversa) return;
      const msg = e instanceof Error && e.message ? e.message : t("Não deu para responder agora.");
      setErro(msg);
    } finally {
      if (conversaAtual.current === daConversa) setCarregando(null);
    }
  }

  async function chamarHub(acao: AcaoHub, pedidoId?: string) {
    if (carregando || desabilitado) return;
    const daConversa = conversationId;
    setErro(null);
    setCarregando(acao);
    try {
      const r = await apiClient.post<{ data: { resumo: string; sugestao?: string; links?: Array<{ rotulo: string; url: string }> } }>(
        `/api/v1/conversations/${daConversa}/painel-agente/acoes`,
        acao === "analise" ? { acao, confirmar: true, pedidoId } : { acao },
      );
      if (conversaAtual.current !== daConversa) return;
      setTurnos((ts) => [...ts,
        { autor: "atendente", texto: t(ACOES_HUB[acao].rotulo) },
        { autor: "ia", texto: r.data.resumo, links: r.data.links },
        ...(r.data.sugestao ? [{ autor: "ia" as const, texto: r.data.sugestao, sugestao: true }] : []),
      ]);
      if (acao === "analise") setPedidoAnalise(null);
    } catch (e) {
      if (conversaAtual.current !== daConversa) return;
      setErro(e instanceof Error && e.message ? e.message : t("Não foi possível consultar o Brisa Hub agora."));
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
            {(["boletos", "contrato", "ficha"] as const).map((acao) => (
              <Button key={acao} size="sm" variant="outline" className="h-7 px-2 text-xs"
                disabled={desabilitado || carregando !== null}
                onClick={() => void chamarHub(acao)}>
                {t(ACOES_HUB[acao].rotulo)}
              </Button>
            ))}
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs"
              disabled={desabilitado || carregando !== null}
              onClick={() => setPedidoAnalise(crypto.randomUUID())}>
              {t(ACOES_HUB.analise.rotulo)}
            </Button>
          </div>
          {pedidoAnalise && (
            <div className="rounded-md border border-border p-2 text-xs" role="group" aria-label={t("Confirmar análise")}>
              <p>{t("Iniciar análise de inquilino vinculado a esta conversa no FC Score+ e Migra? Esta ação será registrada no Brisa Hub.")}</p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" disabled={desabilitado || carregando !== null}
                  onClick={() => void chamarHub("analise", pedidoAnalise)}>{t("Confirmar análise")}</Button>
                <Button size="sm" variant="ghost" onClick={() => setPedidoAnalise(null)}>{t("Cancelar")}</Button>
              </div>
            </div>
          )}

          {turnos.length > 0 && (
            <ol className="max-h-80 space-y-2 overflow-y-auto" aria-live="polite">
              {turnos.map((turno, i) => (
                <li
                  key={i}
                  className={cn(
                    "whitespace-pre-wrap rounded-md px-2 py-1.5 text-xs",
                    turno.autor === "atendente" ? "bg-muted text-text" : "border border-border",
                  )}
                >
                  <span className="sr-only">{turno.autor === "atendente" ? t("Você") : t("IA")}: </span>
                  {turno.texto}
                  {turno.autor === "ia" && turno.links?.map((link) => (
                    <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer"
                      className="mt-1 block text-primary underline">
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
