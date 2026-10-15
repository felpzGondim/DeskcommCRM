"use client";
import { AlertsBell } from "./AlertsBell";
import { AvisoDePropostaEmDestaque } from "./AvisoDePropostaEmDestaque";
import { MobileSidebar } from "./MobileSidebar";
import { TenantSwitcher } from "./TenantSwitcher";
import { UserMenu } from "./UserMenu";
import { SearchTrigger } from "./SearchTrigger";
import {
  CLASSE_QUE_SOME_NA_LISTA,
  ID_DA_FAIXA_DA_CONVERSA,
  ID_DA_FAIXA_DO_INBOX,
} from "@/lib/inbox/lista-no-cabecalho";

export function TopBar() {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-2 border-b bg-background/95 px-3 backdrop-blur md:gap-4 md:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <MobileSidebar />
        {/*
          Na lista do inbox, no celular, isto sai da barra. O CSS em
          `app/globals.css` é quem esconde — a classe sozinha não faz nada no
          desktop, e a conversa aberta tira o atributo que liga a regra.
        */}
        <div className={CLASSE_QUE_SOME_NA_LISTA}>
          <TenantSwitcher />
        </div>
      </div>
      {/*
        O vão dos filtros. Nasce vazio e invisível; o InboxFilters porta a
        faixa para cá quando a lista está na tela. Fora disso o CSS deixa
        `display: none`, e este flex não come o lugar da busca.
      */}
      <div id={ID_DA_FAIXA_DO_INBOX} />
      {/*
        Conversa aberta no celular: Conversas e Ficha ocupam o lugar que a
        lista entregava aos filtros. O CSS só mostra um dos dois vãos.
      */}
      <div id={ID_DA_FAIXA_DA_CONVERSA} />
      <div className={`${CLASSE_QUE_SOME_NA_LISTA} flex min-w-0 flex-1 justify-center md:max-w-md`}>
        <SearchTrigger />
      </div>
      <div className={`${CLASSE_QUE_SOME_NA_LISTA} flex shrink-0 items-center gap-2`}>
        <AlertsBell />
        <AvisoDePropostaEmDestaque />
        <UserMenu />
      </div>
    </header>
  );
}
