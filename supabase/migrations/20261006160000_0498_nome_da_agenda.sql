-- 0498 — carimbo da última TENTATIVA de copiar o nome da agenda do celular.
--
-- O webhook só traz o apelido do perfil. Contato salvo no aparelho e sem
-- apelido fica sem nome na ficha, e a inbox mostra o telefone. A agenda se
-- pergunta ao canal numa varredura; sem carimbar a tentativa, os mesmos
-- primeiros N voltariam em toda rodada e o fim da fila nunca seria perguntado.
--
-- NULLABLE de propósito: NULL = nunca perguntado. Com valor e `name` ainda
-- nulo = o canal não tinha o nome na ocasião. Um default now() faria contato
-- novo nascer como "já tentado".
--
-- Índice PARCIAL: a varredura só olha quem NÃO tem name. Quem já tem nome
-- (ficha ou planilha) não entra.

alter table public.contacts
  add column if not exists name_lookup_at timestamptz;

comment on column public.contacts.name_lookup_at is
  'Última vez que se PERGUNTOU ao canal o nome salvo na agenda do celular. NULL = nunca perguntado. Com valor e name ainda null = o canal não tinha o nome na ocasião.';

create index if not exists idx_contacts_name_lookup_pendente
  on public.contacts (organization_id, name_lookup_at nulls first)
  where name is null and is_anonymized = false and kind = 'person';
