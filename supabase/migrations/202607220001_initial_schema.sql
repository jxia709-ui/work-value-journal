create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  phone text unique,
  full_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists public.work_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  details text,
  project text,
  goal text,
  polished boolean not null default false,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  report_type text not null check (report_type in ('周报', '月报', '自定义总结')),
  status text not null default '草稿' check (status in ('已确认', '草稿')),
  report_date date not null default current_date,
  range_start date not null,
  range_end date not null,
  source_count integer not null default 0,
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.source_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  file_name text not null,
  file_type text,
  file_size bigint,
  category text not null check (category in ('profile', 'weekly_report')),
  status text not null default 'metadata_saved',
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, phone, full_name)
  values (new.id, new.raw_user_meta_data ->> 'phone', coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do update set
    phone = excluded.phone,
    full_name = excluded.full_name,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of raw_user_meta_data on auth.users
  for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.goals enable row level security;
alter table public.work_records enable row level security;
alter table public.reports enable row level security;
alter table public.source_files enable row level security;

drop policy if exists "profiles_owner_all" on public.profiles;
create policy "profiles_owner_all" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "projects_owner_all" on public.projects;
create policy "projects_owner_all" on public.projects for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "goals_owner_all" on public.goals;
create policy "goals_owner_all" on public.goals for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "work_records_owner_all" on public.work_records;
create policy "work_records_owner_all" on public.work_records for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "reports_owner_all" on public.reports;
create policy "reports_owner_all" on public.reports for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "source_files_owner_all" on public.source_files;
create policy "source_files_owner_all" on public.source_files for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.projects, public.goals, public.work_records, public.reports, public.source_files to authenticated;
