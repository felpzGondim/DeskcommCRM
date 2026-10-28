---
impacto: nada_mudou
secao: corrigido
titulo: A próxima revisão do fork data o CHANGELOG no PR da feature e reusa a imagem da main
---

Quem já instalou não precisa fazer nada. A próxima tag `felpz.N` nasce no merge da feature (sem PR extra de CHANGELOG) e, quando a main já publicou o mesmo commit, a imagem versionada é um retag do manifesto — o digest não muda. pg17, e2e, arm64 e o smoke antes do `stable` continuam iguais.
