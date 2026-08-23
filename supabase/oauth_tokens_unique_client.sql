alter table public.oauth_tokens
  add constraint oauth_tokens_client_name_key unique (client_name);
