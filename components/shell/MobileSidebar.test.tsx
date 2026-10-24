import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
vi.mock("@/components/shell/Sidebar", () => ({ SidebarContent: () => <nav>Destinos</nav> }));
// Os controles têm testes próprios; aqui importa que a gaveta os ofereça uma
// vez só. A Sheet e seus gatilhos são reais, inclusive fechamento e evento.
vi.mock("@/components/shell/TenantSwitcher", () => ({
  TenantSwitcher: () => <button>Organização</button>,
}));
vi.mock("@/components/shell/AlertsBell", () => ({ AlertsBell: () => <button>Avisos</button> }));
vi.mock("@/components/shell/UserMenu", () => ({ UserMenu: () => <button>Conta</button> }));

import { GavetaDeNavegacao } from "./MobileSidebar";

describe("controles da gaveta do celular", () => {
  it.each([false, true])("uma cópia por controle, aberta pela aba: %s", (comoAba) => {
    render(<GavetaDeNavegacao comoAba={comoAba} />);
    fireEvent.click(screen.getByRole("button", { name: comoAba ? "Mais" : "Abrir navegação" }));
    const menu = within(screen.getByRole("dialog", { name: "Navegação principal" }));
    for (const name of ["Buscar...", "Organização", "Avisos", "Conta"]) {
      expect(menu.getAllByRole("button", { name })).toHaveLength(1);
    }
    const abrirBusca = vi.fn();
    window.addEventListener("app:abrir-busca", abrirBusca);
    try {
      fireEvent.click(menu.getByRole("button", { name: "Buscar..." }));
      expect(abrirBusca).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("dialog", { name: "Navegação principal" })).toBeNull();
    } finally {
      window.removeEventListener("app:abrir-busca", abrirBusca);
    }
  });
});
