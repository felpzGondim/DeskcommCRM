# Valores do imóvel no processo (2a + 2c)

**Autorização:** dono, opções 2a e 2c. Um PR de banco (0771). Destino: só este fork.
Sem merge, tag ou apply em produção daqui. Chaves da Fase 4 e
`locacao.pacote_superlogica_habilitado` continuam desligadas.

Sem dado pessoal neste arquivo. Valores em **reais mensais** (`numeric`), não em
centavos: é o contrato desta fatia (override explícito da doutrina `_cents` para
estes cinco campos).

---

## O que a 0771 cria

| Peça | Decisão |
|---|---|
| Colunas no **processo** (`locacao_processos`) | 2a: snapshot por negócio, não no catálogo `locacao_imoveis` |
| `aluguel`, `condominio`, `iptu`, `seguro_incendio`, `seguro_fianca` | mensais, nullable |
| `*_origem` `superlogica \| conversa \| manual` | e `*_editado_por` / `*_editado_em` |
| Evento `valores_imovel` | só nomes de campo, sem valores |
| 3× | 2c: aluguel + condomínio (inclui rateio) + IPTU + seguro-incêndio. Fiança fora. |
| FC e Migra | usam o snapshot; recusam se faltar um dos quatro, apontando o campo |
| Superlógica | só GET, injetável; chave desligada = pula essa fonte |
| Edição humana | origem `manual`; pré-preenchimento posterior não sobrescreve |

Não há função SECURITY DEFINER nova. RLS da tabela já existente (SELECT
authenticated, escrita só `service_role`).

---

## Pré-preenchimento

1. Se a chave `locacao.pacote_superlogica_habilitado` estiver ligada **e** o
   contato/imóvel tiver vínculo Superlógica (`superlogica_imovel_id`,
   `contato_superlogica_vinculos` ou `custom_fields superlogica_*`), lê
   aluguel/condomínio/IPTU/seguro-incêndio via `LeitorDePacoteSuperlogica`
   (GET). Sem cliente HTTP neste repo: o stub devolve `null`.
2. Senão (ou para o que a Superlógica não trouxe): ficha/relatório preliminar.
3. Manual vence Superlógica, que vence conversa.

---

## UI

`CamposImovelProcesso` é isolado (props `valores` + `onSalvar`). O PR do modal
com abas encaixa na aba **Dados**. Enquanto isso, aparece onde a ficha
preliminar já é exibida (`FichaPreliminarPainel`) e no detalhe do processo.

---

## Living System

- **Entrada:** GET Superlógica (se a chave ligar) / conversa-ficha / PATCH humano.
- **Saída:** payload FC/Migra (`imovel.aluguel` do snapshot) e 3×.
- **Log:** `api_audit_log` `locacao.valores_imovel_editados` (ids e nomes de
  campo) + evento `valores_imovel`.
- **Tela:** `CamposImovelProcesso` na ficha.
- **Porta:** inbox e `/app/locacao/[id]` já existentes; sem navegação nova.
- **Anti-morte:** FC/Migra recusam apontando o campo que falta.
- **Laço:** o atendente preenche o campo; a origem vira `manual`.
- **Mapa:** `docs/architecture/locacao-processo.architecture.json` (peça
  `valores`, arestas `e29`–`e32`).
