# Hub: GET do pacote do imóvel (3×)

**Destino:** só este fork. O CRM já chama este contrato; o **brisa-hub ainda
não expõe a rota** — este arquivo é o pedido. Sem escrita na Superlógica.
Sem dado pessoal: ids e valores dos exemplos são fictícios.

A chave `locacao.pacote_superlogica_habilitado` continua **desligada**.
Ligada, o CRM lê aluguel, condomínio, IPTU e seguro-incêndio por este
endpoint. Seguro-fiança **não entra** no 3× e **não** deve vir na resposta.
Falhas caem nos valores da conversa com aviso; o fluxo não quebra.

**Comportamento no CRM (decisão Felipe, 01/11 10:12, reafirmada 19:36):**
a Superlógica **confronta** a ficha e **só sinaliza** divergência. Não
sobrescreve. Valores já preenchidos (conversa ou edição manual) continuam
valendo. O leitor compara aluguel, condomínio, IPTU, seguro-incêndio e, se
vierem, endereço/CEP. Quando diferirem, o modal e a ficha mostram um aviso
por campo (`ficha … × Superlógica …`). **Só o campo vazio da ficha** pode
receber o valor da Superlógica, com origem `"superlogica"`. Endereço/CEP
nunca são gravados da Superlógica — só o aviso.

---

## 1. O que o CRM chama hoje

Autenticação: a mesma do MCP cadastrado na organização
(`organizations.settings.mcp_externo` + chave cifrada). Cabeçalho
`Authorization: Bearer <chave>`. Sem querystring de segredo.

Identidade: só ids Superlógica. O CRM **não** manda telefone, CPF, nome
nem texto de conversa.

| Peça | Valor |
|---|---|
| Método | `GET` (nunca POST/PUT/PATCH/DELETE) |
| Rota | `{mesmo host do /mcp}/imovel/pacote` |
| Query | `id_imovel` e/ou `id_pessoa` (pelo menos um) |
| Timeout que o CRM espera | 8 s (o mesmo teto que o Hub já usa na Superlógica) |
| Ferramenta MCP equivalente | `ler_pacote_imovel` com `readOnlyHint=true` e os mesmos parâmetros no corpo |

Se o GET responder 404, o CRM tenta a ferramenta MCP do mesmo nome. Se as
duas faltarem ou falharem, devolve aviso e usa a conversa.

Código do lado do CRM: `lib/locacao/extrato/leitor-superlogica-hub.ts`.

---

## 2. Resposta

Formato alinhado a `consultar_contrato_inquilino` / `buscar_pessoas_superlogica`.

```json
{
  "resultado": "ok",
  "encontrado": true,
  "status": "ok",
  "pacote": {
    "aluguel_centavos": 200000,
    "condominio_centavos": 50000,
    "iptu_centavos": 12000,
    "seguro_incendio_centavos": 8000,
    "id_imovel": 77,
    "id_contrato": 358,
    "endereco": "Rua Exemplo, 100",
    "cep": "01310-100"
  }
}
```

| Campo | Regra |
|---|---|
| `status` | `ok` \| `nao_encontrado` \| `pedido_invalido` \| `multiplos_contratos` \| `indisponivel` \| `nao_permitido` |
| `encontrado` | `true` só com `status=ok` e pelo menos um dos quatro valores |
| `*_centavos` | inteiro ≥ 0, **mensal**. Ausente ou `null` = o Hub não achou aquele componente |
| `id_imovel` / `id_contrato` | opcionais, só o id numérico |
| `endereco` / `cep` | opcionais, só para o CRM **confrontar**. Texto curto; CEP com 8 dígitos ou `00000-000`. Sem nome de pessoa. O CRM **não grava** esses campos na ficha |
| seguro-fiança | **omitir**. Se a Superlógica trouxer, o Hub descarta |

`status=ok` com um componente só é válido: o CRM só usa Superlógica no
campo que a ficha deixou vazio; o resto fica na conversa/manual e, se
diferir, vira aviso.

---

## 3. Chamadas GET que o Hub faz na Superlógica

Base **CONFIRMADA** neste fork (`docs/planos/fase3-5-vinculo-superlogica.md`):
`https://apps.superlogica.net/imobiliaria/api`, cabeçalhos `app_token` +
`access_token`, só GET, timeout 8 s.

O Hub **já** lê:

- `GET /contratos?comStatus=ativos&comDadosDosInquilinos=1`
- `GET /imoveis`, `GET /pessoas`, `GET /locatarios`, `GET /proprietarios`

Para o pacote, o Hub deve ficar em GET. Ordem sugerida (os nomes de query
e de campo abaixo são **INFERIDOS** da API Imobiliárias — medir com uma
leitura de teste, sem gravar nada, antes de piná-los):

1. Se veio `id_imovel`: `GET /imoveis?id={id_imovel}` (ou o parâmetro de
   id que a leitura de teste confirmar).
2. Contrato ativo daquele imóvel: `GET /contratos?idImovel={id_imovel}&comStatus=ativos`
   (se só veio `id_pessoa`, filtrar o índice de inquilinos ativos que o
   Hub já monta e daí o contrato).
3. Encargos / despesas do imóvel ou do contrato — categorias da API:
   encargos do imóvel, lançamentos de IPTU, despesas de contrato. Dali
   saem condomínio (inclui rateio), IPTU e seguro-incêndio.
4. **Não** chamar `/cobrancas`, 2ª via, `/consultar` de boleto, nem
   qualquer POST/PUT/PATCH/DELETE.

Mapeamento que o CRM espera (Hub converte para centavos):

| Componente 3× | O que procurar na Superlógica (INFERIDO) |
|---|---|
| aluguel | valor de aluguel do contrato/imóvel (`vl_aluguel` ou equivalente) |
| condomínio | encargo/despesa de condomínio, **incluindo rateio** |
| IPTU | encargo/despesa ou lançamento de IPTU, mensalizado se vier anual |
| seguro-incêndio | encargo/despesa de seguro-incêndio (`incendio` / `incêndio`). **Não** é seguro-fiança |

Se houver mais de um contrato ativo: `status=multiplos_contratos` e
`encontrado=false`. O CRM não escolhe.

---

## 4. O que o Hub não faz

- Não grava na Superlógica.
- Não devolve nome, CPF, telefone nem texto livre. `endereco`/`cep` no
  pacote são opcionais e só para confronto.
- Não devolve seguro-fiança.
- Não exige o CRM mandar `organization_id` no body — a chave Bearer já
  identifica a instalação.

---

## 5. Como o CRM se comporta sem esta rota

A chave nasce desligada. Ligada sem o GET (e sem a ferramenta MCP): o
leitor devolve o aviso
«Valores da Superlógica indisponíveis agora; usando os da conversa.»
e o 3× segue com a ficha/conversa. Nenhum fluxo quebra.

Rollback: gravar `locacao.pacote_superlogica_habilitado=false`. Sem
migration. Sem mudança no Hub para desligar o lado do CRM.
