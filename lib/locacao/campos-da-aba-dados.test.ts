import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SYSTEM_DO_RELATORIO_PRELIMINAR } from "@/lib/agent-engine/agent/painel-relatorio-preliminar";
import {
  CAMPOS_DA_ABA_DADOS,
  ROTULOS_DO_PACOTE_NA_FICHA,
  valorNoCaminhoDaFicha,
} from "@/lib/locacao/campos-da-aba-dados";
import { completarFicha } from "@/lib/locacao/ficha-schema";

const FIXTURA_CONVERSA = {
  imovel: {
    logradouro: "Rua das Flores",
    numero: "100",
    complemento: "ap 12",
    bairro: "Centro",
    cep: "01310-100",
    cidade: "São Paulo",
    uf: "SP",
    tipo: "residencial",
    codigo_fc: "Flores12",
    aluguel: 2100,
    condominio: "350,00",
    iptu: { valor: 120 },
    seguro_incendio: 85,
  },
  vigencia: { inicio: "2026-11-10", fim: "2029-05-10" },
  garantia: { tipo: "seguro_fianca", valor_mensal: 99 },
  contrato: { indice_reajuste: "IGPM", taxa_adm: 8, taxa_locacao: 50, observacao: "reajuste anual" },
} as const;

const ESPERADO: Record<string, unknown> = {
  "imovel.logradouro": "Rua das Flores",
  "imovel.numero": "100",
  "imovel.complemento": "ap 12",
  "imovel.bairro": "Centro",
  "imovel.cep": "01310-100",
  "imovel.cidade": "São Paulo",
  "imovel.uf": "SP",
  "imovel.tipo": "residencial",
  "imovel.codigo_fc": "Flores12",
  "imovel.aluguel": 2100,
  "imovel.condominio": 350,
  "imovel.iptu": 120,
  "imovel.seguro_incendio": 85,
  "vigencia.inicio": "2026-11-10",
  "vigencia.fim": "2029-05-10",
  "garantia.tipo": "seguro_fianca",
  "garantia.valor_mensal": 99,
  "contrato.indice_reajuste": "IGPM",
  "contrato.taxa_adm": 8,
  "contrato.taxa_locacao": 50,
  "contrato.observacao": "reajuste anual",
};

function valorExibido(bruto: unknown): unknown {
  if (bruto && typeof bruto === "object" && "valor" in bruto) {
    return (bruto as { valor: unknown }).valor;
  }
  return bruto;
}

function fonteDoCampo(bruto: unknown): unknown {
  if (bruto && typeof bruto === "object" && "fonte" in bruto) {
    return (bruto as { fonte: unknown }).fonte;
  }
  return undefined;
}

describe("campos da aba Dados preenchidos pela conversa", () => {
  it.each([...CAMPOS_DA_ABA_DADOS])(
    "parseia $tela ($path) com origem conversa",
    (campo) => {
      const ficha = completarFicha(FIXTURA_CONVERSA);
      const bruto = valorNoCaminhoDaFicha(ficha, campo.path);
      expect(valorExibido(bruto), campo.path).toBe(ESPERADO[campo.path]);
      if (campo.tipo !== "enum") {
        expect(fonteDoCampo(bruto), campo.path).toBe("conversa");
      }
    },
  );

  it.each([...CAMPOS_DA_ABA_DADOS])(
    "o formato da IA cita a chave $json de $tela",
    (campo) => {
      expect(SYSTEM_DO_RELATORIO_PRELIMINAR).toContain(`"${campo.json}"`);
    },
  );

  it.each(CAMPOS_DA_ABA_DADOS.filter((c) => c.superficie === "ficha"))(
    "a ficha da aba Dados liga $tela em $path",
    (campo) => {
      const src = readFileSync("components/inbox/FichaPreliminarPainel.tsx", "utf8");
      const [bloco, chave] = campo.path.split(".");
      expect(src, campo.path).toContain(`ficha.${bloco}`);
      expect(src, campo.path).toContain(chave!);
      expect(src, campo.tela).toContain(campo.tela);
    },
  );

  it.each(CAMPOS_DA_ABA_DADOS.filter((c) => c.superficie === "processo"))(
    "o bloco com origem liga $tela",
    (campo) => {
      const src = readFileSync("components/locacao/CamposImovelProcesso.tsx", "utf8");
      expect(src, campo.tela).toContain(campo.tela);
    },
  );

  it("a aba Dados não duplica o pacote: valores só no bloco com origem", () => {
    const ficha = readFileSync("components/inbox/FichaPreliminarPainel.tsx", "utf8");
    const dialog = readFileSync("components/inbox/AnaliseInquilinoDialog.tsx", "utf8");
    for (const rotulo of ROTULOS_DO_PACOTE_NA_FICHA) {
      expect(ficha, rotulo).not.toContain(rotulo);
    }
    expect(ficha).not.toMatch(/ficha\.imovel\.(aluguel|condominio|iptu|seguro_incendio)/);
    expect(ficha).toContain("CamposImovelProcessoNaFicha");
    expect(dialog).not.toContain("CamposImovelProcessoNaFicha");
  });

  it("a aba Dados mostra garantia e contrato extraídos", () => {
    const src = readFileSync("components/inbox/FichaPreliminarPainel.tsx", "utf8");
    expect(src).toContain("ficha.garantia");
    expect(src).toContain("ficha.contrato");
    expect(src).toContain("Valor mensal da garantia (R$)");
    expect(src).toContain("Índice de reajuste");
  });
});
