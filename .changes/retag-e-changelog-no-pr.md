---
impacto: nada_mudou
secao: corrigido
titulo: A próxima revisão do fork data o CHANGELOG no PR da feature e reusa a imagem da main
---

Quem já instalou não precisa fazer nada. A próxima tag `felpz.N` nasce no merge da feature (sem PR extra de CHANGELOG). Quando a main já publicou o mesmo commit, worker/scheduler/voz são retag; o app reconstrói só para gravar o número da versão em `APP_VERSION`, que a tela de atualização usa depois de um rollback. pg17, e2e, arm64 e o smoke antes do `stable` continuam iguais.
