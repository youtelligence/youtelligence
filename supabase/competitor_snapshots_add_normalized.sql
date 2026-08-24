alter table public.competitor_snapshots
  add column if not exists channel_name text,
  add column if not exists views_per_day numeric,
  add column if not exists like_rate numeric,
  add column if not exists comment_rate numeric;
