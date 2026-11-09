---
impacto: nada_mudou
secao: adicionado
titulo: Tela de consentimento OAuth em /oauth/consent
---

O Auth 2.1 do projeto redireciona a pessoa para `/oauth/consent` (`authorization_url_path` / `GOTRUE_OAUTH_SERVER_AUTHORIZATION_PATH=/oauth/consent`) com `authorization_id`. Sem login o CRM manda para `/login` e volta; a tela mostra o aplicativo, quem autoriza e os escopos `buscar` / `ler` / `baixar`; Permitir e Recusar usam as APIs oficiais do supabase-js e devolvem o redirect. Pedido inválido ou expirado recusa. Sem variável nova. Quem configura o Auth no Dashboard cola o path `/oauth/consent`.
