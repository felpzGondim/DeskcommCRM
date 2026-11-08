---
impacto: nada_mudou
secao: corrigido
titulo: Link direto de mídia e documentos de contato pessoal passa a 404
---

Comportamento para quem usa: o URL direto de mídia (`GET /api/v1/messages/[id]/media`) e o de documentos da locação (`GET|PATCH /api/v1/conversations/[id]/locacao/documentos`) de um contato marcado pessoal **antes abria o arquivo**; agora responde 404 mudo, sem assinar storage e sem ir ao provedor. PATCH pessoal não grava. A Inbox já escondia a conversa; o furo era o link. Contato operacional (`is_personal === false`, mesma organização) segue. Nada a configurar na VPS — `impacto: nada_mudou` significa **sem ação do operador**, não "a tela não muda". A irmã `notes/[noteId]/media` não entra neste corte.
