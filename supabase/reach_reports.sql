create table if not exists reach_reports (
  id uuid primary key default gen_random_uuid(),
  video_id text not null,
  report_date date not null,
  impressions integer,
  click_through_rate numeric,
  pulled_at timestamptz not null default now()
);

create unique index if not exists reach_reports_video_date_key
  on reach_reports (video_id, report_date);

grant select, insert, update, delete on public.reach_reports to service_role;
