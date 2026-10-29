---
impacto: capacidade_nova
secao: adicionado
titulo: Processo de locação, vínculo Superlógica e arquivos do processo (desligados por padrão)
---

Em Configurações › Locação, três chaves: processos, arquivos e cópia para o Google Drive. No Painel, Abrir processo cria um registro com as pessoas da conversa (papel contato) e o imóvel. Só quem está na lista de aprovadores (ou o dono da instalação) aprova; qualquer atendente reprova com motivo. Processo parado fecha em 30 dias. A cópia para o Drive lê `DESKCOMM_GOOGLE_SA_JSON` e `DESKCOMM_DRIVE_ID` — vazio, o cron não faz nada. A chave do Drive nasce desligada. Rollback: desligar as chaves; as tabelas ficam. Padrões sujeitos à revisão do Felipe estão em `docs/decisoes/locacao-fases-3-3b.md`.
