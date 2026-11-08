---
impacto: nada_mudou
secao: adicionado
titulo: Papel Postgres de leitura corporativa delegada (desligado no Auth)
---

A Inbox por cookie não muda. O banco passa a ter o papel `oauth_delegado` (sem herança da sessão), o hook SQL versionado por client autorizado e policies só nesse papel para conversa/mensagem/documento/arquivo corporativos (`is_personal` falso + grant vivo). Pessoal, outra organização, client desconhecido e grant revogado continuam invisíveis nesse papel. O hook do Auth desta instalação **não é ligado** por esta atualização — `impacto: nada_mudou` significa **sem ação do operador na VPS agora**, não "nada foi criado". Ligar o hook, registrar o client e o grant da pessoa são passos à parte, com login/consentimento dela.
