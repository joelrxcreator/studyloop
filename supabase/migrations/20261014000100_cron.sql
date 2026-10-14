-- Erinnerungen: alle 5 Minuten die Server-Funktion "reminders" aufrufen.
-- Voraussetzung (einmalig, NICHT ins Repo): Geheimnisse in private.app_secrets eintragen:
--   vapid_public, vapid_private (Web-Push-Schlüssel), vapid_subject (App-Adresse), cron_token (zufällig)
select cron.schedule('studyloop-reminders', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://ibmhbjwkkgjuzyztakmg.supabase.co/functions/v1/reminders',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-token',(select value from private.app_secrets where name='cron_token')),
    body := '{}'::jsonb, timeout_milliseconds := 20000);
$$);
