alter table public.oauth_tokens
  add column if not exists expires_at timestamptz;
