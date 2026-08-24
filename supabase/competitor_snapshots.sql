create table if not exists competitor_snapshots (
  id uuid primary key default gen_random_uuid(),
  channel_id text not null,
  video_id text not null,
  title text,
  views integer,
  likes integer,
  comments integer,
  published_at timestamptz,
  pulled_at timestamptz not null default now()
);

grant select, insert, update, delete on public.competitor_snapshots to service_role;
