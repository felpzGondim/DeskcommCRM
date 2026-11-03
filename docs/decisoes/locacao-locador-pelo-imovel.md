# Locador pelo imóvel na Superlógica

**Autorização:** dono (Felipe). Destino: só este fork. Sem migration:
`locacao_imoveis.superlogica_imovel_id` já existe (0763).

O locador na aba Dados **não** depende mais do contato da conversa ser
proprietário. A fonte é o **imóvel**: `GET /imovel/pacote` (ou a ferramenta
MCP `ler_pacote_imovel`) devolve `proprietario` quando `status=ok`.

## Comportamento

1. Chave `locacao.pacote_superlogica_habilitado` desligada: não chama o Hub.
2. Sem id Superlógica no imóvel: busca por endereço/código (`busca`).
3. Um candidato: grava `superlogica_imovel_id` e lê o pacote + locador.
4. Vários: a aba Dados lista `{id_imovel, codigo, endereco, cep}` (sem PII).
5. Locador vazio recebe Superlógica com selo; **manual não é sobrescrito**.
6. Pacote 3× (aluguel + condomínio + IPTU; incêndio fora): continua
   manual > conversa > Superlógica (só preenche vazio). Endereço/CEP da
   Superlógica só avisam.
7. Hub 404/`indisponivel`: aviso em português; o fluxo não quebra.

Contrato do Hub: `docs/planos/hub-pacote-imovel-superlogica.md` (PR
felpzGondim/brisa-hub#27, ainda não instalado).

## Living System

- **Entrada:** «Preencher pela conversa» e «Validar no Superlógica».
- **Saída:** locador na ficha (`fonte=superlogica`) e id no `locacao_imoveis`.
- **Log:** `locacao.imovel_superlogica_validado` (status e ids, sem PII).
- **Tela:** `CamposLocador` + `ValidarImovelSuperlogica` na aba Dados.
- **Porta:** modal Cadastro e locação, já existente.
- **Anti-morte:** aviso + lista de candidatos; não inventa locador.
- **Laço:** atendente escolhe o candidato ou edita o locador (origem `manual`).
- **Mapa:** `docs/architecture/locacao-processo.architecture.json` (e48, e49).
