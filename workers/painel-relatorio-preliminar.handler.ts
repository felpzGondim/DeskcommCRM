import type { EventHandler } from "@/lib/event-log/dispatcher";
import {
  CONSUMIDOR_RELATORIO_PRELIMINAR,
  EVENTO_RELATORIO_PRELIMINAR,
} from "@/lib/painel/relatorio-preliminar-fila";
import { processarRelatorioPreliminar } from "@/workers/painel-relatorio-preliminar";

export const painelRelatorioPreliminarHandler: EventHandler = {
  key: CONSUMIDOR_RELATORIO_PRELIMINAR,
  naOrgParada: "pula",
  events: [EVENTO_RELATORIO_PRELIMINAR],
  handle: processarRelatorioPreliminar,
};
