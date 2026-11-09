---
impacto: nada_mudou
secao: adicionado
titulo: Papel Postgres de leitura corporativa delegada (desligado no Auth)
---

A Inbox por cookie não muda. O banco passa a ter o papel `oauth_delegado` (sem herança da sessão), o hook SQL versionado por client autorizado, a conta empresarial com vínculo de sessão (números novos/substituídos herdam; pessoal/desconhecida recusam) e policies só nesse papel para conversa/mensagem/documento/arquivo corporativos (`is_personal` falso + grant vivo + vínculo). Pessoal, outra organização, client desconhecido, sessão sem vínculo e grant revogado continuam invisíveis nesse papel. O hook do Auth desta instalação **não é ligado** por esta atualização — `impacto: nada_mudou` significa **sem ação do operador na VPS agora**, não "nada foi criado". Ligar o hook, registrar o client, o grant da pessoa e o levantamento administrativo das sessões da conta são passos à parte.

Cadastro mínimo (sem número/PII): PUT/DELETE `/api/v1/channel-sessions/:id/conta-empresarial` (cookie + admin). POST de número novo não classifica — a sessão fica desconhecida e a leitura delegada recusa até o vínculo oficial. Substituição herda só se o cadastro gravar o mesmo `conta_id`. Apply do schema com `storage.objects` RLS off e sem privilégio de ENABLE aborta antes de GRANT SELECT ao papel.
