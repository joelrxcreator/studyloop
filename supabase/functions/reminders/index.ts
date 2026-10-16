// Studyloop – Server-Funktion "reminders"
// 1) Alle 5 Minuten per pg_cron (Header x-cron-token): fällige Erinnerungen als Web Push verschicken.
// 2) Aus der App (angemeldet): { action: "test" } schickt eine Test-Mitteilung,
//    { action: "delete_account" } löscht das eigene Konto samt aller Daten.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { dueReminders, normalizeSettings, utcToZoned, addDays } from './schedule.js';
import { sendPush } from './webpush.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let secretsCache: Record<string, string> | null = null;
async function secrets() {
  if (secretsCache) return secretsCache;
  const names = ['vapid_public', 'vapid_private', 'vapid_subject', 'cron_token'];
  const out: Record<string, string> = {};
  for (const n of names) {
    const { data, error } = await admin.rpc('get_app_secret', { p_name: n });
    if (error) throw new Error('Geheimnis fehlt: ' + n);
    out[n] = data as string;
  }
  secretsCache = out;
  return out;
}

async function log(user_id: string | null, level: string, message: string) {
  await admin.from('push_log').insert({ user_id, level, message: message.slice(0, 500) });
}

type Sub = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string; fail_count: number };

async function deliver(subs: Sub[], payload: Record<string, unknown>, vapid: { publicKey: string; privateKey: string; subject: string }) {
  let delivered = 0;
  const errors: string[] = [];
  for (const s of subs) {
    const r = await sendPush(s, payload, vapid);
    if (r.ok) {
      delivered++;
      await admin.from('push_subscriptions').update({ last_success_at: new Date().toISOString(), last_error: null, fail_count: 0 }).eq('id', s.id);
    } else if (r.gone) {
      await admin.from('push_subscriptions').delete().eq('id', s.id);
      await log(s.user_id, 'info', 'Gerät abgemeldet (Abo abgelaufen) – bitte Mitteilungen in der App neu erlauben, falls nötig.');
    } else {
      errors.push(r.error || 'unbekannt');
      await admin.from('push_subscriptions').update({ last_error: r.error, fail_count: (s.fail_count || 0) + 1 }).eq('id', s.id);
    }
  }
  return { delivered, errors };
}

// Mitteilungszentrale: Eintrag anlegen (einmal pro Schlüssel) und Zahl fürs App-Symbol bestimmen
async function addToInbox(userId: string, n: { key: string; title: string; body: string; url?: string }) {
  await admin.from('notifications').upsert({ user_id: userId, key: n.key, title: n.title, body: n.body, url: n.url || null }, { onConflict: 'user_id,key', ignoreDuplicates: true });
}
async function badgeFor(userId: string, settings: Record<string, unknown>) {
  const mode = (settings?.badge as string) || 'unread';
  if (mode === 'off') return 0;
  if (mode !== 'unread') return undefined; // „Offene Termine“ zählt die App selbst
  const { count } = await admin.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', userId).is('read_at', null);
  return count ?? undefined;
}

async function loadUserData(userId: string, fromDay: string, toDay: string) {
  const q = (t: string) => admin.from(t).select('*').eq('user_id', userId);
  const [sem, sub, ser, occ, ex, set] = await Promise.all([
    q('semesters'), q('subjects'), q('series'),
    q('occurrences').gte('on_date', fromDay).lte('on_date', toDay),
    q('exams'), admin.from('settings').select('*').eq('user_id', userId).maybeSingle(),
  ]);
  for (const r of [sem, sub, ser, occ, ex]) if (r.error) throw r.error;
  return {
    data: { semesters: sem.data, subjects: sub.data, series: ser.data, occurrences: occ.data, exams: ex.data },
    settings: set.data?.data || {},
    tz: set.data?.timezone || 'Europe/Berlin',
  };
}

async function runCron() {
  const sec = await secrets();
  const vapid = { publicKey: sec.vapid_public, privateKey: sec.vapid_private, subject: sec.vapid_subject };
  const { data: subs, error } = await admin.from('push_subscriptions').select('*');
  if (error) throw error;
  const byUser = new Map<string, Sub[]>();
  for (const s of (subs || []) as Sub[]) byUser.set(s.user_id, [...(byUser.get(s.user_id) || []), s]);

  const now = Date.now();
  const fromT = now - 30 * 60000; // verpasste Läufe nachholen, aber nichts Veraltetes
  let sent = 0;
  for (const [userId, list] of byUser) {
    try {
      const today = utcToZoned(now, 'Europe/Berlin').date;
      const { data, settings, tz } = await loadUserData(userId, addDays(today, -2), addDays(today, 30));
      const due = dueReminders(data, normalizeSettings(settings), tz, fromT, now);
      if (!due.length) continue;
      const { data: done } = await admin.from('push_sent').select('key').eq('user_id', userId).in('key', due.map((d) => d.key));
      const doneSet = new Set((done || []).map((d: { key: string }) => d.key));
      for (const r of due) {
        if (doneSet.has(r.key)) continue;
        await addToInbox(userId, r);
        const badge = await badgeFor(userId, settings);
        const res = await deliver(list, { title: r.title, body: r.body, url: r.url, tag: r.key, badge }, vapid);
        if (res.delivered > 0) {
          // nur als verschickt markieren, wenn es wirklich angekommen ist
          await admin.from('push_sent').insert({ user_id: userId, key: r.key });
          sent++;
        } else if (res.errors.length) {
          await log(userId, 'error', `Erinnerung nicht zugestellt (${r.title}): ${res.errors[0]}`);
        }
      }
    } catch (e) {
      await log(userId, 'error', 'Fehler beim Berechnen der Erinnerungen: ' + String((e as Error)?.message || e));
    }
  }
  // einmal pro Stunde aufräumen
  if (new Date(now).getUTCMinutes() < 5) {
    await admin.from('push_sent').delete().lt('sent_at', new Date(now - 60 * 864e5).toISOString());
    await admin.from('push_log').delete().lt('at', new Date(now - 30 * 864e5).toISOString());
    await admin.from('notifications').delete().lt('created_at', new Date(now - 60 * 864e5).toISOString());
  }
  return { users: byUser.size, sent };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST erwartet' }, 405);
  try {
    const sec = await secrets();
    const cronToken = req.headers.get('x-cron-token');
    if (cronToken) {
      if (cronToken !== sec.cron_token) return json({ error: 'nicht erlaubt' }, 401);
      return json(await runCron());
    }

    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: u, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !u?.user) return json({ error: 'Bitte neu anmelden.' }, 401);
    const userId = u.user.id;
    const body = await req.json().catch(() => ({}));

    if (body.action === 'test') {
      const { data: subs } = await admin.from('push_subscriptions').select('*').eq('user_id', userId);
      if (!subs?.length) return json({ delivered: 0, devices: 0, error: 'Auf diesem Konto ist noch kein Gerät für Mitteilungen angemeldet.' });
      const vapid = { publicKey: sec.vapid_public, privateKey: sec.vapid_private, subject: sec.vapid_subject };
      const n = { key: 'test|' + Date.now(), title: 'Studyloop', body: 'Test-Mitteilung – so kommen deine Erinnerungen an.', url: './' };
      await addToInbox(userId, n);
      const { data: set } = await admin.from('settings').select('data').eq('user_id', userId).maybeSingle();
      const badge = await badgeFor(userId, set?.data || {});
      const res = await deliver(subs as Sub[], { title: n.title, body: n.body, url: n.url, tag: n.key, badge }, vapid);
      await log(userId, res.delivered ? 'info' : 'error', res.delivered ? `Test an ${res.delivered} Gerät(e) zugestellt.` : `Test fehlgeschlagen: ${res.errors[0] || 'kein Gerät erreichbar'}`);
      return json({ delivered: res.delivered, devices: subs.length, error: res.errors[0] || null });
    }

    if (body.action === 'delete_account') {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) return json({ error: 'Konto konnte nicht gelöscht werden.' }, 500);
      return json({ deleted: true });
    }

    return json({ error: 'Unbekannte Aktion' }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
