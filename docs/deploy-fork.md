# Versões personalizadas de felpzGondim

Este fork publica suas imagens em `ghcr.io/felpzgondim`. O código original
continua vindo de `https://github.com/melgarafael/DeskcommCRM.git`.
As personalizações ficam em commits deste fork e são preservadas por merge.

## Incorporar atualizações do original

Faça a integração em uma branch criada da `main` deste fork. Busque a `main`
do original e faça merge dela nessa branch, resolva conflitos, rode os checks
e revise o PR antes de integrar na `main` do fork. Nunca substitua a `main`
por reset, sincronização forçada ou rebase de commits publicados: isso pode
apagar as personalizações. Preserve os defaults de registro e de repositório
alterados neste fork quando houver conflitos com o original.

## Publicar uma versão

1. Habilite GitHub Actions no fork. O workflow existente **Publicar imagem
   Docker (GHCR)** constrói app, worker, scheduler e voice-agent para amd64 e
   arm64 usando o `GITHUB_TOKEN`, sem credenciais de produção.
2. Depois de revisar e integrar as mudanças na `main`, execute o CI e confira
   os resultados. Uma branch de configuração ainda não é uma versão de produção.
   Antes da próxima publicação, confira os fragmentos já presentes na tag da
   release anterior. Arquive somente os que continuam idênticos, preservando
   o texto integral em `docs/releases/fragmentos/<tag>/`; fragmentos novos ou
   alterados permanecem em `.changes/`. Assim, a guarda do acervo mede apenas
   mudanças ainda não publicadas neste fork.
   Acrescente as notas da revisão personalizada ao `CHANGELOG.md` sem mudar
   os números oficiais do upstream. Preserve um cabeçalho para a revisão
   anterior: ele permite ao atualizador reconhecer onde termina o histórico
   de quem já está nela. Confira a extração e o limite em bytes do agente.
3. Crie uma tag inédita no commit aprovado da `main`, no formato
   `v<versão-base>-felpz.<revisão>`, por exemplo `v1.66.1-felpz.1`.
   Use a versão-base REAL do upstream incorporado; o exemplo não recomenda
   instalar essa versão antiga. Incremente a revisão a cada personalização.
4. Envie somente essa tag ao fork. Não envie todas as tags do original.
   O push da tag aciona a publicação existente; uma tag sozinha não significa
   que a versão está disponível.
5. Aguarde todos os builds, manifests e testes de boot. Só então o job
   `publicar-release-do-fork` cria uma release não marcada como prerelease e a
   indica como latest, para que `/releases/latest` do fork a encontre.
6. Na primeira publicação, torne os quatro pacotes GHCR públicos nas suas
   configurações e confirme que os manifests da versão podem ser baixados sem
   login. Repositório público não torna os pacotes públicos automaticamente.

O workflow de release do original usa um GitHub App. Não é necessário copiar
seus segredos: o caminho deste fork é o push da tag personalizada, seguido da
publicação das imagens e da release pelo próprio workflow de imagens.

No CI, enquanto o fork não tiver sua primeira release, a comparação do kit de
atualização usa a release publicada do original. As tags necessárias são
buscadas apenas no checkout do runner, sem publicá-las no fork. O teste do kit
antigo (`v1.63.0`) continua sendo executado. Depois da primeira release própria,
a comparação passa a usar a release do fork.

## Conectar uma VPS que já usa a versão oficial

Esta configuração do fork NÃO muda uma VPS existente. Antes da migração,
inspecione a instalação real, a versão das imagens, o origin e o estado do Git;
faça backup do banco, dos arquivos de configuração e dos volumes necessários;
registre como restaurar a versão anterior. Não copie segredos para o repositório.

Só mude a instalação para o fork depois que uma release personalizada estiver
publicada e os quatro pacotes estiverem acessíveis. O origin deve apontar para
`https://github.com/felpzGondim/DeskcommCRM.git`, e o kit executado precisa ser
o DESTE fork. Apenas editar `APP_IMAGE` no `.env` é insuficiente: o atualizador
regrava as imagens do conjunto a partir de `IMG_NS` em `_common.sh`.

O procedimento exato da primeira troca depende da instalação inspecionada.
Não execute o instalador de instalação nova nem troque o checkout de produção
sem preservar alterações locais e sem um plano de rollback.

Após a troca validada, o botão Atualizar consulta as releases do fork pelo
origin e instala as imagens de `ghcr.io/felpzgondim`. Atualizações do original
passam primeiro por integração, testes e publicação neste fork. O botão não
faz merge de código nem resolve conflitos.
