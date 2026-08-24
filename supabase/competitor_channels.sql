create table if not exists competitor_channels (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  channel_id text not null,
  channel_name text not null
);

create unique index if not exists competitor_channels_client_channel_key
  on competitor_channels (client_name, channel_id);

grant select, insert, update, delete on public.competitor_channels to service_role;
