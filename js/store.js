// Datenhaltung: lokaler Zustand + Supabase.
// Jede Änderung wirkt sofort lokal und geht über eine Warteschlange (nacheinander, mit Wiederholung) an den Server.
// Ohne Netz bleibt die Warteschlange im Gerät gespeichert und wird später abgearbeitet.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import * as S from './schedule.js';

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'sl.auth', flowType: 'implicit' },
});

export const TABLES = ['semesters', 'subjects', 'series', 'occurrences', 'exams'];
const KEYS = {
  semesters: ['id'], subjects: ['id'], series: ['id'], occurrences: ['series_id', 'on_date'], exams: ['id'],
  settings: ['user_id'], activity: ['user_id', 'day'],
};
export const COLS = {
  semesters: ['id', 'user_id', 'name', 'starts_on', 'ends_on', 'weeks', 'holidays', 'parity_labels'],
  subjects: ['id', 'user_id', 'semester_id', 'name', 'code', 'color', 'sort'],
  series: ['id', 'user_id', 'subject_id', 'kind', 'weekday', 'starts_at', 'ends_at', 'room', 'lecturer', 'group_label', 'note', 'weeks_rule', 'custom_weeks', 'valid_from', 'valid_until', 'once_on', 'every_week', 'mandatory'],
  occurrences: ['series_id', 'on_date', 'user_id', 'progress', 'stars', 'note', 'mandatory', 'cancelled', 'starts_at', 'ends_at', 'room'],
  exams: ['id', 'user_id', 'semester_id', 'subject_id', 'kind', 'title', 'on_date', 'until_date', 'starts_at', 'ends_at', 'room', 'note', 'remind'],
  settings: ['user_id', 'data', 'timezone'],
  activity: ['user_id', 'day'],
};
const keyOf = (table, row) => KEYS[table].map((k) => row[k]).join('|');
function pick(table, row) {
  const o = {};
  for (const c of COLS[table]) o[c] = row[c] === undefined ? null : row[c];
  if (table === 'occurrences') { o.progress = o.progress ?? 0; o.cancelled = !!o.cancelled; }
  if (table === 'series') { o.weeks_rule = o.weeks_rule || 'all'; o.custom_weeks = o.custom_weeks || []; o.every_week = !!o.every_week; o.mandatory = !!o.mandatory; o.kind = o.kind || 'lesson'; }
  if (table === 'semesters') { o.weeks = o.weeks || []; o.holidays = o.holidays || []; o.parity_labels = o.parity_labels || ['Woche A', 'Woche B']; }
  if (table === 'exams') { o.remind = o.remind !== false; o.kind = o.kind || 'exam'; }
  if (table === 'subjects') { o.sort = o.sort ?? 0; o.color = o.color || 'blue'; }
  return o;
}

const empty = () => ({ semesters: [], subjects: [], series: [], occurrences: [], exams: [] });

export const store = {
  user: null,
  data: empty(),
  settings: S.normalizeSettings({}),
  activity: new Set(),
  loaded: false,
  loading: false,
  lastLoad: 0,
  status: 'ok',        // ok | saving | offline
  version: 0,
};

const listeners = new Set();
export const onChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));
let idxCache = null;
export const idx = () => (idxCache ||= S.buildIndex(store.data));
function emit() {
  store.version++;
  idxCache = null;
  for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } }
}

let errorHandler = (msg) => console.warn(msg);
export const onError = (fn) => { errorHandler = fn; };

// ---------------- Cache auf dem Gerät ----------------
const cacheKey = () => 'sl.cache.' + store.user?.id;
const queueKey = () => 'sl.queue.' + store.user?.id;
let cacheTimer = 0;
function saveCacheSoon() {
  clearTimeout(cacheTimer);
  cacheTimer = setTimeout(saveCache, 400);
}
function saveCache() {
  if (!store.user) return;
  try {
    localStorage.setItem(cacheKey(), JSON.stringify({ data: store.data, settings: store.settings, activity: [...store.activity], at: Date.now() }));
  } catch { /* voll – egal, Server hat die Daten */ }
}
function loadCache() {
  try {
    const c = JSON.parse(localStorage.getItem(cacheKey()) || 'null');
    if (!c?.data) return false;
    store.data = { ...empty(), ...c.data };
    store.settings = S.normalizeSettings(c.settings);
    store.activity = new Set(c.activity || []);
    store.loaded = true;
    return true;
  } catch { return false; }
}

// ---------------- Warteschlange ----------------
let queue = [];
let running = false;
let retryTimer = 0;
let backoff = 0;
const persistQueue = () => { try { localStorage.setItem(queueKey(), JSON.stringify(queue)); } catch { /* ignorieren */ } };
const loadQueue = () => { try { queue = JSON.parse(localStorage.getItem(queueKey()) || '[]'); } catch { queue = []; } };
export const pendingCount = () => queue.length;

function enqueue(op) {
  op.k = op.table + '#' + (op.op === 'up' ? keyOf(op.table, op.row) : JSON.stringify(op.match));
  const last = queue[queue.length - 1];
  // Schnelle Folge-Änderungen am selben Datensatz zusammenfassen (nur wenn ganz hinten und nicht in Arbeit)
  if (last && last.k === op.k && last.op === 'up' && op.op === 'up' && !(running && queue.length === 1)) queue[queue.length - 1] = op;
  else queue.push(op);
  persistQueue();
  setStatus();
  kick();
}

function isRetryable(res) {
  const st = res.status ?? 0;
  if (st === 0 || st >= 500 || st === 401 || st === 408 || st === 429) return true;
  const m = String(res.error?.message || res.error || '');
  return /fetch|network|load failed|timeout|abort/i.test(m);
}

async function exec(op) {
  if (op.op === 'up') {
    return sb.from(op.table).upsert(op.row, { onConflict: KEYS[op.table].join(','), ignoreDuplicates: op.table === 'activity', returning: 'minimal' });
  }
  let q = sb.from(op.table).delete();
  for (const [k, v] of Object.entries(op.match)) q = q.eq(k, v);
  return q;
}

async function kick() {
  if (running || !queue.length || !store.user) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { setStatus('offline'); return; }
  running = true;
  setStatus();
  while (queue.length && store.user) {
    const op = queue[0];
    let res;
    try { res = await exec(op); } catch (e) { res = { error: e, status: 0 }; }
    if (res.error) {
      if (isRetryable(res)) {
        running = false;
        if (res.status === 401) await sb.auth.refreshSession().catch(() => {});
        scheduleRetry();
        setStatus('offline');
        return;
      }
      queue.shift();
      persistQueue();
      errorHandler('Eine Änderung konnte nicht gespeichert werden. Die Daten werden neu geladen.');
      console.error('Speichern fehlgeschlagen', op, res.error);
      setTimeout(() => load({ quiet: true }), 300);
      continue;
    }
    queue.shift();
    persistQueue();
    backoff = 0;
  }
  running = false;
  setStatus();
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  backoff = Math.min(60000, backoff ? backoff * 2 : 2000);
  retryTimer = setTimeout(kick, backoff);
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { backoff = 0; kick(); });
  window.addEventListener('offline', () => setStatus('offline'));
}

let statusTimer = 0;
function setStatus(force) {
  const next = force || (queue.length ? (navigator.onLine === false ? 'offline' : 'saving') : 'ok');
  if (next === store.status) return;
  store.status = next;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => emitStatus(), next === 'saving' ? 600 : 0); // kurze Speichervorgänge nicht anzeigen
}
const statusListeners = new Set();
export const onStatus = (fn) => (statusListeners.add(fn), () => statusListeners.delete(fn));
const emitStatus = () => { for (const fn of statusListeners) fn(store.status); };

// ---------------- Lokale Änderungen ----------------
function applyLocal(data, op) {
  const arr = data[op.table];
  if (!arr) return;
  if (op.op === 'up') {
    const k = keyOf(op.table, op.row);
    const i = arr.findIndex((r) => keyOf(op.table, r) === k);
    if (i >= 0) arr[i] = { ...arr[i], ...op.row }; else arr.push({ ...op.row });
  } else {
    const k = KEYS[op.table].map((c) => op.match[c]).join('|');
    const i = arr.findIndex((r) => keyOf(op.table, r) === k);
    if (i >= 0) arr.splice(i, 1);
  }
}

export function put(table, row) {
  const clean = pick(table, { ...row, user_id: store.user.id });
  if (table === 'settings' || table === 'activity') { enqueue({ op: 'up', table, row: clean }); return clean; }
  applyLocal(store.data, { op: 'up', table, row: clean });
  enqueue({ op: 'up', table, row: clean });
  emit();
  saveCacheSoon();
  return clean;
}

/** Löscht einen Datensatz samt abhängigen Daten (lokal wie in der Datenbank per Kaskade). */
export function remove(table, row) {
  const d = store.data;
  const match = Object.fromEntries(KEYS[table].map((k) => [k, row[k]]));
  if (table === 'semesters') {
    const subIds = new Set(d.subjects.filter((s) => s.semester_id === row.id).map((s) => s.id));
    const serIds = new Set(d.series.filter((s) => subIds.has(s.subject_id)).map((s) => s.id));
    d.occurrences = d.occurrences.filter((o) => !serIds.has(o.series_id));
    d.series = d.series.filter((s) => !serIds.has(s.id));
    d.subjects = d.subjects.filter((s) => !subIds.has(s.id));
    d.exams = d.exams.filter((e) => e.semester_id !== row.id);
  } else if (table === 'subjects') {
    const serIds = new Set(d.series.filter((s) => s.subject_id === row.id).map((s) => s.id));
    d.occurrences = d.occurrences.filter((o) => !serIds.has(o.series_id));
    d.series = d.series.filter((s) => !serIds.has(s.id));
    d.exams = d.exams.map((e) => (e.subject_id === row.id ? { ...e, subject_id: null } : e));
  } else if (table === 'series') {
    d.occurrences = d.occurrences.filter((o) => o.series_id !== row.id);
  }
  applyLocal(d, { op: 'del', table, match });
  enqueue({ op: 'del', table, match });
  emit();
  saveCacheSoon();
}

/** Mehrere Zeilen auf einmal (z. B. Vorlage übernehmen) – Reihenfolge Eltern → Kinder. */
export function putMany(rows) {
  for (const [table, row] of rows) {
    const clean = pick(table, { ...row, user_id: store.user.id });
    applyLocal(store.data, { op: 'up', table, row: clean });
    enqueue({ op: 'up', table, row: clean });
  }
  emit();
  saveCacheSoon();
}

export function patchOcc(o, patch) {
  const base = o.state || { series_id: o.series.id, on_date: o.date, progress: 0 };
  put('occurrences', { ...base, ...patch, series_id: o.series.id, on_date: o.date });
  markActive();
}

export function markActive() {
  const d = S.localDate();
  if (store.activity.has(d)) return;
  store.activity.add(d);
  put('activity', { day: d });
  emit();
}

export function putSettings(patch) {
  store.settings = S.normalizeSettings({ ...store.settings, ...patch });
  put('settings', { data: store.settings, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin' });
  emit();
  saveCacheSoon();
}

// ---------------- Laden ----------------
async function fetchAll(table, build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error, status } = await build(sb.from(table).select('*')).range(from, from + 999);
    if (error) throw Object.assign(new Error(error.message), { status });
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

let lastLoadError = null;
export const loadError = () => lastLoadError;

export async function load({ quiet = false } = {}) {
  if (!store.user || store.loading) return;
  store.loading = true;
  try {
    const id = (q) => q.order('created_at', { ascending: true });
    const since = S.addDays(S.localDate(), -400);
    const [semesters, subjects, series, occurrences, exams, activity, settingsRes] = await Promise.all([
      fetchAll('semesters', id), fetchAll('subjects', id), fetchAll('series', id),
      fetchAll('occurrences', (q) => q.order('on_date')), fetchAll('exams', id),
      fetchAll('activity', (q) => q.gte('day', since)),
      sb.from('settings').select('*').maybeSingle(),
    ]);
    if (settingsRes.error) throw Object.assign(new Error(settingsRes.error.message), { status: settingsRes.status });
    const fresh = { semesters, subjects, series, occurrences, exams };
    for (const op of queue) applyLocal(fresh, op); // eigene, noch nicht gesendete Änderungen behalten
    store.data = fresh;
    store.activity = new Set(activity.map((a) => a.day));
    for (const op of queue) if (op.table === 'activity') store.activity.add(op.row.day);
    const pendingSettings = queue.filter((o) => o.table === 'settings').pop();
    if (pendingSettings) store.settings = S.normalizeSettings(pendingSettings.row.data);
    else if (settingsRes.data) store.settings = S.normalizeSettings(settingsRes.data.data);
    else putSettings({}); // erstes Mal: Standard-Einstellungen anlegen
    store.loaded = true;
    store.lastLoad = Date.now();
    lastLoadError = null;
    saveCache();
    emit();
    kick();
    return true;
  } catch (e) {
    lastLoadError = e;
    if (!quiet && !(e.status === 0 || /fetch|network|load failed/i.test(e.message))) errorHandler('Laden fehlgeschlagen: ' + e.message);
    if (!store.loaded) emit();
    setStatus(navigator.onLine === false ? 'offline' : undefined);
    return false;
  } finally {
    store.loading = false;
  }
}

// ---------------- Konto ----------------
export function setUser(user) {
  if (store.user?.id === user?.id) return;
  store.user = user || null;
  store.data = empty();
  store.settings = S.normalizeSettings({});
  store.activity = new Set();
  store.loaded = false;
  queue = [];
  if (user) { loadQueue(); loadCache(); }
  emit();
  if (user) kick();
}

export function clearLocal() {
  if (!store.user) return;
  try { localStorage.removeItem(cacheKey()); localStorage.removeItem(queueKey()); } catch { /* egal */ }
  queue = [];
}

export function exportData() {
  return {
    app: 'studyloop', version: 1, exported_at: new Date().toISOString(),
    settings: store.settings, ...Object.fromEntries(TABLES.map((t) => [t, store.data[t].map((r) => pick(t, r))])),
  };
}

/** Backup einspielen: alles wird per upsert übernommen (bestehende Zeilen gleicher ID werden überschrieben). */
export function importData(json) {
  if (!json || json.app !== 'studyloop') throw new Error('Das ist keine Studyloop-Sicherung.');
  const rows = [];
  for (const t of TABLES) {
    const list = Array.isArray(json[t]) ? json[t] : [];
    for (const r of list) {
      if (!r || typeof r !== 'object') continue;
      if (t === 'occurrences' ? !(r.series_id && S.isValidDate(r.on_date)) : !r.id) continue;
      rows.push([t, r]);
    }
  }
  // nur Kinder übernehmen, deren Eltern existieren
  const ids = { semesters: new Set(), subjects: new Set(), series: new Set() };
  for (const s of store.data.semesters) ids.semesters.add(s.id);
  for (const s of store.data.subjects) ids.subjects.add(s.id);
  for (const s of store.data.series) ids.series.add(s.id);
  const ok = [];
  for (const [t, r] of rows) {
    if (t === 'semesters') { if (!S.isValidDate(r.starts_on) || !S.isValidDate(r.ends_on)) continue; ids.semesters.add(r.id); }
    if (t === 'subjects') { if (!ids.semesters.has(r.semester_id)) continue; ids.subjects.add(r.id); }
    if (t === 'series') { if (!ids.subjects.has(r.subject_id)) continue; ids.series.add(r.id); }
    if (t === 'occurrences' && !ids.series.has(r.series_id)) continue;
    if (t === 'exams') { if (!S.isValidDate(r.on_date)) continue; if (r.subject_id && !ids.subjects.has(r.subject_id)) r.subject_id = null; if (r.semester_id && !ids.semesters.has(r.semester_id)) r.semester_id = null; }
    ok.push([t, r]);
  }
  putMany(ok);
  if (json.settings) putSettings(json.settings);
  return ok.length;
}
