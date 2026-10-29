"use client";

import { useT } from "@/hooks/i18n/useT";

/**
 * Encaixe da aba Dados para os campos do imóvel (aluguel, condomínio, IPTU,
 * seguro-incêndio, seguro-fiança). O cadastro desses valores vem de um PR
 * paralelo de banco — aqui só o lugar visível.
 */
export function EncaixeCamposDoImovel() {
  const t = useT();
  return (
    <div
      data-testid="encaixe-campos-do-imovel"
      className="space-y-1 rounded-md border border-dashed border-border p-2"
    >
      <p className="text-xs font-medium">{t("Valores do imóvel")}</p>
      <p className="text-[11px] text-muted-foreground">
        {t("Aluguel, condomínio, IPTU, seguro-incêndio e seguro-fiança entram aqui quando o cadastro do imóvel estiver disponível.")}
      </p>
    </div>
  );
}
