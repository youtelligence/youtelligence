alter table public.competitor_snapshots
  add column if not exists runtime_seconds integer;
