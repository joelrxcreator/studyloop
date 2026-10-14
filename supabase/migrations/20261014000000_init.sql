-- Studyloop: Grundschema
-- Jede Zeile gehört genau einem Konto (user_id). RLS ist überall an.
-- IDs erzeugt der Client (uuid), damit Offline-Speichern + Wiederholen idempotent ist.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------- Hilfsfunktion: updated_at ----------
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

-- ---------- Semester ----------
create table public.semesters (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  starts_on date not null,
  ends_on date not null check (ends_on >= starts_on),
  -- [{ "w": "2026-09-28", "k": "lecture|project|free|exams", "p": "A|B|null" }]
  weeks jsonb not null default '[]'::jsonb,
  -- [{ "from": "2026-12-19", "to": "2027-01-03", "name": "Weihnachtsferien" }]
  holidays jsonb not null default '[]'::jsonb,
  parity_labels jsonb not null default '["Woche A","Woche B"]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Fächer ----------
create table public.subjects (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  semester_id uuid not null references public.semesters(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  code text check (char_length(code) <= 12),
  color text not null default 'blue',
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Terminreihen (wiederkehrend oder einmalig) ----------
create table public.series (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  kind text not null default 'lesson' check (kind in ('lesson','lecture','exercise','lab')),
  weekday smallint check (weekday between 1 and 7),
  starts_at time not null,
  ends_at time not null,
  room text check (char_length(room) <= 60),
  lecturer text check (char_length(lecturer) <= 60),
  group_label text check (char_length(group_label) <= 30),
  note text check (char_length(note) <= 500),
  weeks_rule text not null default 'all' check (weeks_rule in ('all','A','B','custom')),
  custom_weeks jsonb not null default '[]'::jsonb,
  valid_from date,
  valid_until date,
  once_on date,                       -- gesetzt = Einzeltermin
  every_week boolean not null default false, -- auch in Projekt-/freien Wochen
  mandatory boolean not null default false,  -- jede Wiederholung ist Pflicht
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (once_on is not null or weekday is not null)
);

-- ---------- Stand pro einzelnem Termin ----------
create table public.occurrences (
  series_id uuid not null references public.series(id) on delete cascade,
  on_date date not null,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  progress smallint not null default 0 check (progress between 0 and 100),
  stars smallint check (stars between 1 and 5),
  note text check (char_length(note) <= 2000),
  mandatory boolean,                  -- null = wie Reihe
  cancelled boolean not null default false,
  starts_at time,                     -- nur dieser Termin verlegt
  ends_at time,
  room text check (char_length(room) <= 60),
  updated_at timestamptz not null default now(),
  primary key (series_id, on_date)
);

-- ---------- Prüfungen, Fristen, Zeiträume ----------
create table public.exams (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  semester_id uuid references public.semesters(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete set null,
  kind text not null default 'exam' check (kind in ('exam','oral','submission','registration','period','other')),
  title text not null check (char_length(title) between 1 and 100),
  on_date date not null,
  until_date date,
  starts_at time,
  ends_at time,
  room text check (char_length(room) <= 60),
  note text check (char_length(note) <= 1000),
  remind boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Einstellungen ----------
create table public.settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  timezone text not null default 'Europe/Berlin',
  updated_at timestamptz not null default now()
);

-- ---------- Aktivität (für die Serie) ----------
create table public.activity (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day date not null,
  primary key (user_id, day)
);

-- ---------- Web Push ----------
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_error text,
  fail_count int not null default 0
);

create table public.push_sent (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, key)
);

create table public.push_log (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade,
  at timestamptz not null default now(),
  level text not null default 'info',
  message text not null
);

-- ---------- Indizes ----------
create index on public.semesters (user_id);
create index on public.subjects (user_id);
create index on public.subjects (semester_id);
create index on public.series (user_id);
create index on public.series (subject_id);
create index on public.occurrences (user_id, on_date);
create index on public.exams (user_id);
create index on public.exams (semester_id);
create index on public.exams (subject_id);
create index on public.push_subscriptions (user_id);
create index on public.push_log (user_id, at desc);
create index on public.push_sent (sent_at);

-- ---------- updated_at-Trigger ----------
create trigger t_semesters before update on public.semesters for each row execute function public.touch_updated_at();
create trigger t_subjects  before update on public.subjects  for each row execute function public.touch_updated_at();
create trigger t_series    before update on public.series    for each row execute function public.touch_updated_at();
create trigger t_occ       before update on public.occurrences for each row execute function public.touch_updated_at();
create trigger t_exams     before update on public.exams     for each row execute function public.touch_updated_at();
create trigger t_settings  before update on public.settings  for each row execute function public.touch_updated_at();

-- ---------- RLS: nur eigene Zeilen ----------
alter table public.semesters enable row level security;
alter table public.subjects enable row level security;
alter table public.series enable row level security;
alter table public.occurrences enable row level security;
alter table public.exams enable row level security;
alter table public.settings enable row level security;
alter table public.activity enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.push_sent enable row level security;
alter table public.push_log enable row level security;

do $$
declare t text;
begin
  foreach t in array array['semesters','subjects','series','occurrences','exams','settings','activity'] loop
    execute format('create policy own_rows on public.%I for all to authenticated
      using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

create policy own_select on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy own_delete on public.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));
create policy own_select on public.push_log for select to authenticated using (user_id = (select auth.uid()));
-- push_sent: nur Server (Service-Rolle)

-- Verweise müssen auf eigene Zeilen zeigen (sonst könnte man fremde IDs referenzieren)
create or replace function public.check_owner_refs() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'subjects' then
    if not exists (select 1 from public.semesters s where s.id = new.semester_id and s.user_id = new.user_id) then
      raise exception 'semester gehört nicht zum Konto';
    end if;
  elsif tg_table_name = 'series' then
    if not exists (select 1 from public.subjects s where s.id = new.subject_id and s.user_id = new.user_id) then
      raise exception 'fach gehört nicht zum Konto';
    end if;
  elsif tg_table_name = 'occurrences' then
    if not exists (select 1 from public.series s where s.id = new.series_id and s.user_id = new.user_id) then
      raise exception 'termin gehört nicht zum Konto';
    end if;
  elsif tg_table_name = 'exams' then
    if new.subject_id is not null and not exists (select 1 from public.subjects s where s.id = new.subject_id and s.user_id = new.user_id) then
      raise exception 'fach gehört nicht zum Konto';
    end if;
    if new.semester_id is not null and not exists (select 1 from public.semesters s where s.id = new.semester_id and s.user_id = new.user_id) then
      raise exception 'semester gehört nicht zum Konto';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.check_owner_refs() from public, anon, authenticated;

create trigger r_subjects before insert or update on public.subjects for each row execute function public.check_owner_refs();
create trigger r_series   before insert or update on public.series   for each row execute function public.check_owner_refs();
create trigger r_occ      before insert or update on public.occurrences for each row execute function public.check_owner_refs();
create trigger r_exams    before insert or update on public.exams    for each row execute function public.check_owner_refs();

-- ---------- Push-Abo registrieren (Gerät kann den Besitzer wechseln) ----------
create or replace function public.register_push(p_endpoint text, p_p256dh text, p_auth text, p_ua text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'nicht angemeldet'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_ua, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, fail_count = 0, last_error = null;
end $$;
revoke execute on function public.register_push(text,text,text,text) from public, anon;
grant execute on function public.register_push(text,text,text,text) to authenticated;

-- Konto löschen läuft über die Server-Funktion (auth.admin.deleteUser) – Kaskade löscht alle Daten.

-- ---------- Server-Geheimnisse (nur Service-Rolle) ----------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table private.app_secrets (name text primary key, value text not null);
revoke all on private.app_secrets from public, anon, authenticated;

create or replace function public.get_app_secret(p_name text) returns text
language sql security definer set search_path = '' as $$
  select value from private.app_secrets where name = p_name
$$;
revoke execute on function public.get_app_secret(text) from public, anon, authenticated;
grant execute on function public.get_app_secret(text) to service_role;

-- Aufräumen alter Versand-Marker/Protokolle erledigt die Server-Funktion stündlich.
