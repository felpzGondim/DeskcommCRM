import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { comIdempotencia } from "@/lib/api/idempotency";

describe("análise: falha fechada se recibo não puder ser reservado", () => {
  it("não chama o Hub quando o banco recusa a reserva", async () => {
    const executar = vi.fn();
    const db = { from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ gt: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) }),
      insert: async () => ({ error: { code: "42501" } }),
    }) } as unknown as SupabaseClient;
    await expect(comIdempotencia({
      db, organizationId: "org-1", endpoint: "/analise/conversa-1", chave: "pedido-1",
      corpo: { conversa: "conversa-1" }, executar, exigirReserva: true,
    })).rejects.toThrow("idempotency_storage_unavailable");
    expect(executar).not.toHaveBeenCalled();
  });
});
