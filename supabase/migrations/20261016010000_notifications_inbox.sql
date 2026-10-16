-- Mitteilungszentrale: jede verschickte Erinnerung landet hier (gelesen/ungelesen, geräteübergreifend).
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key text not null,
  title text not null,
  body text not null default '',
  url text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (user_id, key)
);
create index if not exists notifications_user_created on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;
create policy own_rows on public.notifications for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.notifications to authenticated;
alter publication supabase_realtime add table public.notifications;
