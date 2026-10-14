// Web Push auf diesem Gerät: Status, Erlauben, Abmelden, Test.
import { sb } from './store.js';
import { VAPID_PUBLIC } from './config.js';

const b64uToBytes = (s) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

export function pushState() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  return { ios, standalone, supported, permission: supported ? Notification.permission : 'unsupported' };
}

async function register(sub) {
  const j = sub.toJSON();
  const { error } = await sb.rpc('register_push', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ua: navigator.userAgent });
  if (error) throw new Error(error.message);
}

/** Muss direkt aus einem Tipp heraus aufgerufen werden (iOS-Regel). */
export async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, permission: perm };
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(VAPID_PUBLIC) });
  await register(sub);
  return { ok: true, permission: perm };
}

/** Beim Start: Abo dieses Geräts erneut melden (iOS tauscht Abos gelegentlich aus). */
export async function syncPush() {
  try {
    const st = pushState();
    if (!st.supported || st.permission !== 'granted') return false;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(VAPID_PUBLIC) });
    await register(sub);
    return true;
  } catch (e) {
    console.warn('Push-Abgleich fehlgeschlagen', e);
    return false;
  }
}

export async function deviceSubscribed() {
  try {
    if (!pushState().supported) return false;
    const reg = await navigator.serviceWorker.getRegistration();
    return !!(await reg?.pushManager.getSubscription());
  } catch { return false; }
}

export async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      await sub.unsubscribe();
    }
  } catch (e) { console.warn(e); }
}

export async function testPush() {
  const { data, error } = await sb.functions.invoke('reminders', { body: { action: 'test' } });
  if (error) {
    let msg = error.message;
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error; } catch { /* egal */ }
    return { delivered: 0, error: msg };
  }
  return data;
}

export async function pushLog() {
  const { data, error } = await sb.from('push_log').select('*').order('at', { ascending: false }).limit(20);
  if (error) throw error;
  return data;
}

export async function devices() {
  const { data } = await sb.from('push_subscriptions').select('id,user_agent,created_at,last_success_at,last_error');
  return data || [];
}
