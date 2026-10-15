/**
 * A lista do inbox, no celular, ocupa o cabeçalho.
 *
 * O sino, o idioma e a conta saem da barra (a classe abaixo) e os filtros
 * rápidos entram no vão que ficou (o elemento com o id abaixo). Os dois lados
 * leem estas constantes: um nome escrito duas vezes é o que faz a faixa existir
 * no React e o CSS esconder outra coisa.
 */
export const ID_DA_FAIXA_DO_INBOX = "faixa-dos-filtros";
export const ATTR_LISTA_DO_INBOX = "data-inbox-lista";
export const CLASSE_QUE_SOME_NA_LISTA = "cabecalho-some-na-lista";

/** Liga o CSS do cabeçalho enquanto a LISTA está na tela. Conversa aberta desliga. */
export function sincronizarListaNoCabecalho(listaVisivel: boolean): void {
  if (typeof document === "undefined") return;
  const raiz = document.documentElement;
  if (listaVisivel) raiz.setAttribute(ATTR_LISTA_DO_INBOX, "");
  else raiz.removeAttribute(ATTR_LISTA_DO_INBOX);
}
