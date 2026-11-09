---
impacto: nada_mudou
secao: corrigido
titulo: Atualizar a VPS deixa de apagar os vínculos da delegação e o acesso aos anexos
---

O `update.sh` reaplica o schema inteiro. A passada anterior derrubava a tabela de vínculo sessão→conta empresarial (os números da conta sumiam) e revogava a leitura de arquivos no storage sem devolver o SELECT quando o USAGE no schema já estava lá. A reaplicação agora cria as tabelas só se faltarem, não apaga linhas, e reconcede cada privilégio de leitura que estiver faltando. Quem já restaurou os vínculos à mão não precisa de SQL extra: o próximo atualizar é o conserto. Quem ainda não restaurou linhas apagadas não as recupera daqui — o backup/restauração manual continua sendo o caminho. Sem variável nova.
