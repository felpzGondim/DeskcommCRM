/**
 * No celular a lista do inbox entrega o cabeçalho aos filtros.
 *
 * Não lidos, Grupos e cada etiqueta ficam na mesma faixa, ao lado do menu,
 * e a faixa rola para o lado. O seletor "Filtrar por tag" continua no desktop:
 * quem já procura esse controle (e o teste que vigia a desmontagem) não pode
 * perder o menu. jsdom não aplica `md:`, então a prova da faixa é o portal
 * para o elemento que o cabeçalho reserva — e a prova de que o CSS esconde a
 * conta é a regra lendo as MESMAS constantes que o componente usa.
 */
import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { InboxFilters, type InboxFiltersValue } from "@/components/inbox/InboxFilters";
import {
  ATTR_LISTA_DO_INBOX,
  CLASSE_QUE_SOME_NA_LISTA,
  ID_DA_FAIXA_DO_INBOX,
  sincronizarListaNoCabecalho,
} from "@/lib/inbox/lista-no-cabecalho";
import type { ActiveOrg } from "@/lib/auth/types";

const activeOrgRef: { current: ActiveOrg | null } = { current: null };
vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => ({ activeOrg: activeOrgRef.current }),
}));
vi.mock("@/hooks/channels/useChannelSessions", () => ({
  useChannelSessions: () => ({ data: [] }),
  channelLabel: () => "",
}));
const tagsRef: { current: string[] | undefined } = { current: [] };
const tagsDoContatoRef: { current: string[] | undefined } = { current: [] };
vi.mock("@/hooks/inbox/useConversationTags", () => ({
  useConversationTagVocabulary: () => ({ data: tagsRef.current }),
}));
vi.mock("@/hooks/contacts/useContactTagVocabulary", () => ({
  useContactTagVocabulary: () => ({ data: tagsDoContatoRef.current }),
}));
vi.mock("@/hooks/inbox/useConversationCounts", () => ({
  useConversationCounts: () => ({ data: { fila: 1, mine: 0, all: 1 } }),
}));

const VALUE: InboxFiltersValue = { tab: "unassigned", search: "", onlyUnread: false };

beforeEach(() => {
  activeOrgRef.current = { orgId: "org-1", name: "Org", role: "manager", visibility_mode: "all" };
  tagsRef.current = ["vip", "retorno"];
  tagsDoContatoRef.current = [];
  document.getElementById(ID_DA_FAIXA_DO_INBOX)?.remove();
  document.documentElement.removeAttribute(ATTR_LISTA_DO_INBOX);
});
afterEach(() => {
  cleanup();
  document.getElementById(ID_DA_FAIXA_DO_INBOX)?.remove();
  document.documentElement.removeAttribute(ATTR_LISTA_DO_INBOX);
});

describe("filtros da lista no cabeçalho", () => {
  it("as etiquetas entram na faixa, na mesma rolagem de Não lidos e Grupos", () => {
    const faixa = document.createElement("div");
    faixa.id = ID_DA_FAIXA_DO_INBOX;
    document.body.appendChild(faixa);
    const onChange = vi.fn();

    render(<InboxFilters value={VALUE} onChange={onChange} encaixarNoCabecalho />);

    const grupo = within(faixa).getByRole("group", { name: "Filtros da caixa" });
    expect(grupo.className).toContain("overflow-x-auto");
    expect(within(grupo).getByRole("button", { name: "Não lidos" })).toBeInTheDocument();
    expect(within(grupo).getByRole("button", { name: "Grupos" })).toBeInTheDocument();

    const vip = within(grupo).getByRole("button", { name: "vip" });
    expect(vip).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(vip);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ tag: ["vip"] }));

    // O menu do desktop continua sendo o controle de várias etiquetas.
    expect(screen.getByRole("button", { name: "Filtrar por tag" })).toBeInTheDocument();
  });

  it("conversa aberta não porta a faixa — ela cobriria o cabeçalho da conta", () => {
    const faixa = document.createElement("div");
    faixa.id = ID_DA_FAIXA_DO_INBOX;
    document.body.appendChild(faixa);

    render(<InboxFilters value={VALUE} onChange={() => {}} encaixarNoCabecalho={false} />);

    expect(within(faixa).queryByRole("group")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Não lidos" })).toBeInTheDocument();
  });
});

describe("o cabeçalho sabe quando a lista está na tela", () => {
  it("liga e desliga o atributo que o CSS lê", () => {
    sincronizarListaNoCabecalho(true);
    expect(document.documentElement.getAttribute(ATTR_LISTA_DO_INBOX)).toBe("");
    sincronizarListaNoCabecalho(false);
    expect(document.documentElement.hasAttribute(ATTR_LISTA_DO_INBOX)).toBe(false);
  });

  it("a regra do CSS usa o mesmo atributo, a mesma classe e o mesmo id", () => {
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toContain(`html[${ATTR_LISTA_DO_INBOX}] .${CLASSE_QUE_SOME_NA_LISTA}`);
    expect(css).toContain(`#${ID_DA_FAIXA_DO_INBOX}`);
    // A barra usa as constantes, não uma segunda grafia do mesmo nome.
    const barra = readFileSync("components/shell/TopBar.tsx", "utf8");
    expect(barra).toContain("CLASSE_QUE_SOME_NA_LISTA");
    expect(barra).toContain("ID_DA_FAIXA_DO_INBOX");
  });
});
