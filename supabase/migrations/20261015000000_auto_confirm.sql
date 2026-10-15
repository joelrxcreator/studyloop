-- Neue Konten sofort bestätigen (kein Bestätigungs-Link nötig; der Gratis-Mailversand ist stark begrenzt).
create or replace function public.auto_confirm_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email_confirmed_at is null then new.email_confirmed_at = now(); end if;
  return new;
end $$;
revoke execute on function public.auto_confirm_user() from public, anon, authenticated;
create trigger studyloop_auto_confirm before insert on auth.users for each row execute function public.auto_confirm_user();
