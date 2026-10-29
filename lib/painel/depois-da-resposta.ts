/**
 * Agenda trabalho depois da response HTTP. `after()` do Next não lê cookies.
 */
import { after } from "next/server";

export function depoisDaResposta(trabalho: () => void | Promise<void>): void {
  after(trabalho);
}
