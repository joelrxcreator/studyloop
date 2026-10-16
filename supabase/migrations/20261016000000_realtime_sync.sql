-- Live-Abgleich zwischen Geräten: Änderungen über Supabase Realtime melden (RLS gilt weiterhin).
do $$ declare t text; begin
  foreach t in array array['semesters','subjects','series','occurrences','exams','settings'] loop
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
