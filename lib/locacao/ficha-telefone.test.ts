import { describe, expect, it } from "vitest";

import { fichaVazia, pessoaVazia } from "@/lib/locacao/ficha-schema";
import { telefoneDoInquilinoPrincipal } from "@/lib/locacao/ficha-telefone";

describe("telefone do inquilino principal", () => {
  it("usa o celular do inquilino principal, não o do contato da conversa", () => {
    const ficha = fichaVazia();
    ficha.pessoas = [
      { ...pessoaVazia("contato"), celular: { valor: "11988880000", fonte: "M1", trecho: null, confianca: 1, message_id: null } },
      { ...pessoaVazia("inquilino"), principal: true, celular: { valor: "+55 11 91234-5678", fonte: "M2", trecho: null, confianca: 0.9, message_id: null } },
    ];
    expect(telefoneDoInquilinoPrincipal(ficha)).toBe("+55 11 91234-5678");
  });

  it("sem inquilino ou sem celular devolve nulo — o atendente preenche", () => {
    expect(telefoneDoInquilinoPrincipal(null)).toBeNull();
    expect(telefoneDoInquilinoPrincipal(fichaVazia())).toBeNull();
    const soContato = fichaVazia();
    soContato.pessoas = [pessoaVazia("contato")];
    expect(telefoneDoInquilinoPrincipal(soContato)).toBeNull();
  });
});
