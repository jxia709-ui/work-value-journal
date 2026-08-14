alter table public.profiles
  add column if not exists role text not null default '',
  add column if not exists kpis jsonb not null default '[]'::jsonb;

comment on column public.profiles.role is 'User job title or role used for AI context';
comment on column public.profiles.kpis is 'User-confirmed KPI hierarchy stored as JSON';
