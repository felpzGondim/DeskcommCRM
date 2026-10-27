import type { Page } from "@playwright/test";

/**
 * A sugestão revisável fica no compositor (sem rascunho) ou na assistência
 * (com rascunho). O painel interno tem outro botão com o mesmo nome, que
 * conversa com a IA e não cria um rascunho em /draft-reply.
 */
export function botaoDeSugestaoAssistida(page: Page) {
  const nome = { name: "Sugerir resposta", exact: true };
  return page.getByTestId("modos-do-composer").getByRole("button", nome).or(
    page.getByRole("region", { name: "Assistência do agente", exact: true }).getByRole("button", nome),
  );
}
