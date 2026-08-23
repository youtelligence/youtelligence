create table if not exists oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  access_token text not null,
  refresh_token text,
  updated_at timestamptz not null default now()
);
