"use client";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useT } from "@/hooks/i18n/useT";
import { SidebarContent } from "@/components/shell/Sidebar";
import { AlertsBell } from "@/components/shell/AlertsBell";
import { TenantSwitcher } from "@/components/shell/TenantSwitcher";
import { UserMenu } from "@/components/shell/UserMenu";
import { List, MagnifyingGlass } from "@/lib/ui/icons";

/**
 * Navegação mobile do app autenticado.
 *
 * O estado "Recolher" é do sidebar desktop e persiste em cookie. No mobile a
 * navegação é uma gaveta temporária: abrir/fechar não escreve esse cookie, para
 * não trocar a preferência que a pessoa escolheu no laptop.
 */
export function MobileSidebar() {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-11 w-11 md:hidden"
          aria-label={t("Abrir navegação")}
        >
          <List size={22} aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-0 p-0 sm:max-w-xs"
      >
        <SheetTitle className="sr-only">{t("Navegação principal")}</SheetTitle>
        {/*
          O que saiu do cabeçalho na lista do inbox (sino, idioma, conta,
          busca, organização) continua a um toque. Os ids de teste são outros
          para não duplicar os da barra, que segue montada — só escondida.
          O atalho do tema fica na barra: dois ouvintes trocariam o tema duas vezes.
        */}
        <div className="flex flex-wrap items-center gap-1 border-b px-3 py-2 pr-12">
          <TenantSwitcher idDeTeste="tenant-switcher-menu" />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2 text-muted-foreground"
            onClick={() => {
              setOpen(false);
              window.dispatchEvent(new Event("deskcomm:abrir-busca"));
            }}
          >
            <MagnifyingGlass size={14} aria-hidden />
            {t("Buscar...")}
          </Button>
          <AlertsBell idDeTeste="alerts-bell-menu" />
          <UserMenu idDoSeletor="seletor-de-idioma-menu" atalhoDoTema={false} />
        </div>
        <SidebarContent
          collapsed={false}
          showCollapseControl={false}
          onNavigate={() => setOpen(false)}
        />
      </SheetContent>
    </Sheet>
  );
}
