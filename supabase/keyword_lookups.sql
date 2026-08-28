create table if not exists keyword_lookups (
  id uuid primary key default gen_random_uuid(),
  term text not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

-- Lookups are read back by normalized term, newest first, within a cache window.
create index if not exists keyword_lookups_term_created_idx
  on keyword_lookups (term, created_at desc);

grant select, insert, update, delete on public.keyword_lookups to service_role;
