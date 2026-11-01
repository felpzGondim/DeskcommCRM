"use client";

import { useT } from "@/hooks/i18n/useT";
import {
  rotuloDoSeloDeOrigem,
  type SeloDeOrigem,
} from "@/lib/locacao/origem-do-campo";

export function SeloOrigem({
  origem,
}: {
  origem: SeloDeOrigem;
}) {
  const t = useT();
  return (
    <span className="text-[10px] text-muted-foreground" data-testid="selo-origem" data-origem={origem}>
      {t("Origem")}: {t(rotuloDoSeloDeOrigem(origem))}
    </span>
  );
}
