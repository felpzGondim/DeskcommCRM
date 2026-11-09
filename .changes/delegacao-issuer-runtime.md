---
impacto: nada_mudou
secao: corrigido
titulo: Well-known OAuth da delegação deixa de anunciar o placeholder do build
---

O GET `/.well-known/oauth-protected-resource/api/mcp/delegacao` (e o well-known raiz) monta `authorization_servers` com a URL pública do Auth lida em runtime (`NEXT_PUBLIC_SUPABASE_URL` via `lib/env`), não com o valor assado na imagem (`https://placeholder.supabase.co`). Sem essa URL real — ou com o placeholder do Dockerfile — o campo sai vazio e o JWT é recusado (fail-closed). O 401 com `WWW-Authenticate` não muda. Quem já instalou não precisa de variável nova: conferir que o contêiner `app` tem `NEXT_PUBLIC_SUPABASE_URL` no `.env` de runtime (a mesma que o resto do CRM já usa). `SUPABASE_SERVER_URL` continua só para o transporte interno; não entra no issuer anunciado ao Bot.
