"use client";
import { useEffect, useState } from "react";

/**
 * O HTML da página sai antes da contagem. No recarregamento quente do dev a
 * primeira pintura do navegador já pode ter o número no cache. Desenhar o
 * span nesse instante, e não no HTML, é o erro de hidratação na aba. O efeito
 * roda depois dessa comparação.
 */
export function useContagemDepoisDaHidratacao(): boolean {
  const [pronta, setPronta] = useState(false);
  useEffect(() => {
    setPronta(true);
  }, []);
  return pronta;
}
