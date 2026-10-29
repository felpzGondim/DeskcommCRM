/** Texto sintético no layout Stone. Sem dado real. Só para testes. */
export const EXTRATO_STONE_SINTETICO = `
STONE INSTITUIÇÃO DE PAGAMENTO S.A.
Titular: TITULAR TESTE ALFA
CPF: 529.982.247-25
Período 01/08/2026 a 31/10/2026
Página 1 de 2

01/08/2026 SALDO ANTERIOR 10.000,00
05/08/2026 PIX RECEBIDO EMPRESA FOLHA LTDA 4.500,00 C 14.500,00
10/08/2026 TED ENVIADA TITULAR TESTE ALFA 2.000,00 D 12.500,00
12/08/2026 RESGATE RENDA FIXA 1.000,00 C 13.500,00
15/08/2026 APLICACAO CDB 500,00 D 13.000,00
20/08/2026 ESTORNO PIX 200,00 C 13.200,00
25/08/2026 EMPRESTIMO CONSIGNADO 3.000,00 C 16.200,00
28/08/2026 PIX RECEBIDO PAGADOR PF BETA 800,00 C 17.000,00
30/08/2026 PAGAMENTO FATURA 1.200,00 D 15.800,00

Página 2 de 2

05/09/2026 PIX RECEBIDO EMPRESA FOLHA LTDA 4.500,00 C 20.300,00
10/09/2026 PIX RECEBIDO PAGADOR PF BETA 800,00 C 21.100,00
15/09/2026 ANTECIPACAO STONE 2.200,00 C 23.300,00
28/09/2026 PAGAMENTO FATURA 1.200,00 D 22.100,00
`.trim();

/**
 * Layout Stone realista (2–5 linhas por lançamento, cabeçalho repetido).
 * Nomes e CPF fictícios. Saldo fecha: 10.000 + 4.500 − 1.200 + 800 − 10 = 14.090.
 */
export const EXTRATO_STONE_MULTILINHA = `
STONE INSTITUIÇÃO DE PAGAMENTO S.A.
Conta Stone

Nome
TITULAR TESTE ALFA

Documento
529.982.247-25

Período
01/08/26 a 31/08/26

Saldo anterior R$ 10.000,00

DATA TIPO DESCRIÇÃO VALOR SALDO
Página 1 de 2

01/08/26 Entrada
Pix recebido
Empresa Folha Ltda
R$ 4.500,00 R$ 14.500,00

03/08/26 Saída
Pix enviado
Aluguel Imovel
R$ 1.200,00 R$ 13.300,00

Página 2 de 2
DATA TIPO DESCRIÇÃO VALOR SALDO

05/08/26 Entrada
Ted recebida
Pagador Pf Beta
R$ 800,00 R$ 14.100,00

10/08/26 Saída
Tarifa mensal
- R$ 10,00 R$ 14.090,00
`.trim();

/**
 * Layout inventado estilo Nubank: data, tipo e valor em linhas distintas.
 * O parser automático não lê; a extração por IA é o caminho.
 */
export const EXTRATO_NUBANK_SINTETICO = `
Nu Pagamentos S.A. - Instituição de Pagamento
extrato da conta
agosto 2026

Página 1 de 1
LANC-P01
data 05/08/2026
tipo credito
contraparte EMPRESA FOLHA LTDA
valor 4.500,00
saldo 4.500,00

LANC-P02
data 12/08/2026
tipo debito
contraparte ALUGUEL CENTRO
valor 1.200,00
saldo 3.300,00
`.trim();
