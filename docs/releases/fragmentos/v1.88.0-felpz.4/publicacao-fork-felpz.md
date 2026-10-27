---
impacto: exige_acao
secao: alterado
titulo: Atualizações personalizadas passam pelas versões do fork
---

O fork publica suas próprias imagens e disponibiliza a release personalizada
somente depois dos builds e dos testes de inicialização. Uma VPS já instalada
precisa de backup e migração para o origin e o kit deste fork antes de usar
esse fluxo. O procedimento e as verificações estão em docs/deploy-fork.md.

## Requer atenção

Antes de trocar uma instalação existente, publique uma versão personalizada,
confira o acesso público aos quatro pacotes e faça backup da instalação e do
banco. A migração deve configurar o origin e executar o kit deste fork;
alterar apenas a imagem da aplicação não preserva a escolha no próximo update.
Siga docs/deploy-fork.md e valide a aplicação após a troca.
