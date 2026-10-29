---
impacto: capacidade_nova
secao: corrigido
titulo: A prévia do contrato mostra a pergunta do Hub e o recado quando o serviço recusa
---

Ao preparar uma locação, a pendência do Hub aparece como pergunta (por exemplo o valor do IPTU), não como erro genérico. Se o Hub recusar — serviço de contratos desligado ou chave sem permissão — o painel mostra o recado que ele devolveu. O formulário passa a pedir split (repasse) e meses de isenção de multa, que o Hub exige. Continua chamando `/contrato/preparar` e `/contrato/confirmar` no mesmo endereço do MCP.
