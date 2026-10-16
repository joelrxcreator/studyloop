// Studyloop – Kernlogik ohne Abhängigkeiten.
// Läuft im Browser, in Node (Tests) und in Deno (Server-Funktion für Erinnerungen).
// Datumswerte sind immer Strings 'YYYY-MM-DD', Uhrzeiten 'HH:MM' – keine Zeitzonen-Fallen.

export const KINDS = {
  lesson:   { label: 'Unterricht', short: 'U' },
  lecture:  { label: 'Vorlesung',  short: 'V' },
  exercise: { label: 'Übung',      short: 'Ü' },
  lab:      { label: 'Praktikum',  short: 'P' },
};

export const EXAM_KINDS = {
  exam:         { label: 'Klausur' },
  oral:         { label: 'Mündliche Prüfung' },
  submission:   { label: 'Abgabe' },
  registration: { label: 'Anmeldung' },
  period:       { label: 'Prüfungszeitraum' },
  other:        { label: 'Termin' },
};

export const WEEK_KINDS = {
  lecture: 'Vorlesungswoche',
  project: 'Projektwoche',
  free:    'Vorlesungsfrei',
  exams:   'Prüfungszeit',
};

const DAY = 864e5;
export const pad = (n) => String(n).padStart(2, '0');

export function toUTC(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
export function fromUTC(t) {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
export const addDays = (s, n) => fromUTC(toUTC(s) + n * DAY);
export const diffDays = (a, b) => Math.round((toUTC(b) - toUTC(a)) / DAY); // b - a
/** 1 = Montag … 7 = Sonntag */
export const weekday = (s) => ((new Date(toUTC(s)).getUTCDay() + 6) % 7) + 1;
export const mondayOf = (s) => addDays(s, 1 - weekday(s));
export function isoWeek(s) {
  const thursday = addDays(s, 4 - weekday(s));
  const jan1 = thursday.slice(0, 4) + '-01-01';
  return Math.floor(diffDays(jan1, thursday) / 7) + 1;
}
export const isValidDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fromUTC(toUTC(s)) === s;

export function toMin(t) {
  if (!t) return 0;
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + (m || 0);
}
export const hhmm = (t) => (t ? String(t).slice(0, 5) : '');
export const minToHHMM = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

/** Lokales Datum im Browser/Node als 'YYYY-MM-DD'. */
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const localMinutes = (d = new Date()) => d.getHours() * 60 + d.getMinutes();

// ---------------- Zeitzonen (für den Server) ----------------
/** Datum + Uhrzeit in einer Zeitzone → UTC-Millisekunden. */
export function zonedToUtc(dateStr, timeStr, tz) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = (timeStr || '00:00').split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off1 = tzOffset(guess, tz);
  const t = guess - off1;
  const off2 = tzOffset(t, tz);
  return off1 === off2 ? t : guess - off2;
}
/** Offset der Zone zu UTC in ms zum Zeitpunkt t. */
export function tzOffset(t, tz) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUTC - Math.floor(t / 1000) * 1000;
}
/** UTC-Zeitpunkt → { date, min } in der Zone. */
export function utcToZoned(t, tz) {
  const z = t + tzOffset(t, tz);
  const d = new Date(z);
  return { date: fromUTC(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())), min: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

// ---------------- Semester ----------------
export function semesterFor(semesters, date) {
  return (semesters || []).find((s) => s.starts_on <= date && date <= s.ends_on) || null;
}

/** Woche des Semesters: { kind, parity } – ohne Eintrag gilt 'lecture'. */
export function weekInfo(sem, date) {
  if (!sem || date < sem.starts_on || date > sem.ends_on) return null;
  const mon = mondayOf(date);
  const w = (sem.weeks || []).find((x) => x.w === mon);
  return { kind: w?.k || 'lecture', parity: w?.p || null, monday: mon };
}

export function holidayOn(sem, date) {
  if (!sem) return null;
  return (sem.holidays || []).find((h) => h.from <= date && date <= (h.to || h.from)) || null;
}

export function parityLabel(sem, parity) {
  if (!parity) return '';
  const labels = Array.isArray(sem?.parity_labels) ? sem.parity_labels : ['Woche A', 'Woche B'];
  return parity === 'A' ? labels[0] : labels[1];
}

// ---------------- Termine erzeugen ----------------
/**
 * Baut einen Index für schnelle Abfragen.
 * data: { semesters, subjects, series, occurrences, exams }
 */
export function buildIndex(data) {
  const semById = new Map((data.semesters || []).map((s) => [s.id, s]));
  const subById = new Map((data.subjects || []).map((s) => [s.id, s]));
  const occ = new Map();
  for (const o of data.occurrences || []) occ.set(o.series_id + '|' + o.on_date, o);
  const seriesBySem = new Map();
  for (const sr of data.series || []) {
    const sub = subById.get(sr.subject_id);
    if (!sub) continue;
    const list = seriesBySem.get(sub.semester_id) || [];
    list.push(sr);
    seriesBySem.set(sub.semester_id, list);
  }
  return { data, semById, subById, occ, seriesBySem };
}

/** Findet die Reihe an diesem Datum statt? (ohne Ausfall-Markierung) */
export function seriesOccursOn(sr, sem, date) {
  if (!sem) return false;
  if (sr.once_on) return sr.once_on === date;
  if (weekday(date) !== Number(sr.weekday)) return false;
  if (date < sem.starts_on || date > sem.ends_on) return false;
  if (sr.valid_from && date < sr.valid_from) return false;
  if (sr.valid_until && date > sr.valid_until) return false;
  if (holidayOn(sem, date)) return false;
  const wi = weekInfo(sem, date);
  if (!sr.every_week && wi.kind !== 'lecture') return false;
  if (sr.weeks_rule === 'A' || sr.weeks_rule === 'B') {
    if (wi.parity !== sr.weeks_rule) return false;
  } else if (sr.weeks_rule === 'custom') {
    if (!(sr.custom_weeks || []).includes(wi.monday)) return false;
  }
  return true;
}

/** Alle Termine eines Tages, sortiert. Ausgefallene sind enthalten (cancelled: true). */
export function occurrencesOn(idx, date) {
  const out = [];
  const sem = semesterFor(idx.data.semesters, date);
  const candidates = [];
  // Einzeltermine dürfen auch außerhalb des Semesters liegen → alle Semester prüfen
  for (const [semId, list] of idx.seriesBySem) {
    const s = idx.semById.get(semId);
    for (const sr of list) {
      if (sr.once_on) { if (sr.once_on === date) candidates.push([sr, s]); }
      else if (s === sem) candidates.push([sr, s]);
    }
  }
  for (const [sr, s] of candidates) {
    if (!seriesOccursOn(sr, s, date)) continue;
    out.push(makeOcc(idx, sr, date));
  }
  out.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin || a.subject.name.localeCompare(b.subject.name));
  markOverlaps(out);
  return out;
}

export function makeOcc(idx, sr, date) {
  const st = idx.occ.get(sr.id + '|' + date) || null;
  const subject = idx.subById.get(sr.subject_id);
  const starts = hhmm(st?.starts_at || sr.starts_at);
  const ends = hhmm(st?.ends_at || sr.ends_at);
  const mandatory = st && st.mandatory != null ? !!st.mandatory : !!sr.mandatory;
  return {
    key: sr.id + '|' + date,
    series: sr, subject, date, state: st,
    starts, ends, startMin: toMin(starts), endMin: toMin(ends),
    duration: Math.max(0, toMin(ends) - toMin(starts)),
    room: st?.room || sr.room || '',
    progress: st?.progress ?? 0,
    stars: st?.stars ?? null,
    note: st?.note || '',
    mandatory,
    cancelled: !!st?.cancelled,
    moved: !!(st && (st.starts_at || st.ends_at || st.room)),
    overlaps: false,
  };
}

function markOverlaps(list) {
  const act = list.filter((o) => !o.cancelled);
  for (let i = 0; i < act.length; i++)
    for (let j = i + 1; j < act.length; j++)
      if (act[j].startMin < act[i].endMin && act[i].startMin < act[j].endMin) act[i].overlaps = act[j].overlaps = true;
}

/** Spalten für überlappende Termine (für Raster-Ansicht). */
export function layoutColumns(list) {
  const items = list.filter((o) => !o.cancelled).map((o) => ({ o, col: 0, cols: 1 }));
  let cluster = [], clusterEnd = -1;
  const flush = () => {
    const colsEnd = [];
    for (const it of cluster) {
      let c = colsEnd.findIndex((e) => e <= it.o.startMin);
      if (c < 0) { c = colsEnd.length; colsEnd.push(0); }
      colsEnd[c] = it.o.endMin; it.col = c;
    }
    for (const it of cluster) it.cols = colsEnd.length;
    cluster = [];
  };
  for (const it of items) {
    if (cluster.length && it.o.startMin >= clusterEnd) { flush(); clusterEnd = -1; }
    cluster.push(it); clusterEnd = Math.max(clusterEnd, it.o.endMin);
  }
  if (cluster.length) flush();
  return items;
}

/** Termine in einem Datumsbereich [from, to]. */
export function occurrencesBetween(idx, from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(...occurrencesOn(idx, d));
  return out;
}

/** Prüfungen/Fristen an einem Tag (inkl. Zeiträume, die den Tag umfassen). */
export function examsOn(data, date) {
  return (data.exams || [])
    .filter((e) => e.on_date === date || (e.until_date && e.on_date <= date && date <= e.until_date))
    .sort((a, b) => toMin(a.starts_at) - toMin(b.starts_at));
}

// ---------------- Fälligkeit, Statistik ----------------
/**
 * Ein Termin gilt als "fällig", sobald er begonnen hat.
 * from: Termine davor zählen nur, wenn man sie selbst bearbeitet hat (Einstieg mitten im Semester).
 */
export function isDue(o, today, nowMin, from = null) {
  if (o.cancelled) return false;
  if (from && o.date < from && !touched(o)) return false;
  if (o.date < today) return true;
  return o.date === today && o.startMin <= nowMin;
}
const touched = (o) => !!o.state && (o.progress > 0 || o.stars != null || !!o.note);

export const isOpen = (o) => o.progress < 100;
export const isWeak = (o) => o.stars != null && o.stars <= 2;

/** Statistik pro Fach über alle fälligen Termine. */
export function subjectStats(idx, subjectId, today, nowMin, from = null) {
  const sub = idx.subById.get(subjectId);
  const sem = sub && idx.semById.get(sub.semester_id);
  if (!sub || !sem) return null;
  const end = today < sem.ends_on ? today : sem.ends_on;
  const series = (idx.seriesBySem.get(sem.id) || []).filter((s) => s.subject_id === subjectId);
  const due = [];
  let total = 0;
  for (const sr of series) {
    if (sr.once_on) {
      const o = makeOcc(idx, sr, sr.once_on);
      if (!o.cancelled) { total++; if (isDue(o, today, nowMin, from)) due.push(o); }
      continue;
    }
    for (let d = sem.starts_on; d <= sem.ends_on; d = addDays(d, 1)) {
      if (!seriesOccursOn(sr, sem, d)) continue;
      const o = makeOcc(idx, sr, d);
      if (o.cancelled) continue;
      total++;
      if (d <= end && isDue(o, today, nowMin, from)) due.push(o);
    }
  }
  const rated = due.filter((o) => o.stars != null);
  const avgStars = rated.length ? rated.reduce((a, o) => a + o.stars, 0) / rated.length : null;
  const progress = due.length ? due.reduce((a, o) => a + o.progress, 0) / due.length : null;
  const open = due.filter(isOpen);
  const weak = due.filter((o) => !isOpen(o) && isWeak(o));
  const openMinutes = open.reduce((a, o) => a + (o.duration * (100 - o.progress)) / 100, 0);
  return { subject: sub, due, total, rated: rated.length, avgStars, progress, open, weak, openMinutes };
}

/** Sortierung für das Cockpit: zuerst schwach bewertet, dann wenig Fortschritt, dann älteste. */
export function sortForReview(list) {
  return [...list].sort((a, b) => (a.stars ?? 3) - (b.stars ?? 3) || a.progress - b.progress || (a.date < b.date ? -1 : a.date > b.date ? 1 : a.startMin - b.startMin));
}

/** Rückstand insgesamt (alle Fächer des Semesters). */
export function backlog(idx, semId, today, nowMin, from = null) {
  const out = { count: 0, minutes: 0, weak: 0 };
  for (const sub of idx.data.subjects || []) {
    if (sub.semester_id !== semId) continue;
    const st = subjectStats(idx, sub.id, today, nowMin, from);
    if (!st) continue;
    out.count += st.open.length;
    out.minutes += st.openMinutes;
    out.weak += st.weak.length;
  }
  return out;
}

/** Wochenlast: pro Tag Termin-Minuten und offene Minuten. */
export function weekLoad(idx, monday, today, nowMin, from = null) {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    const list = occurrencesOn(idx, d).filter((o) => !o.cancelled);
    const minutes = list.reduce((a, o) => a + o.duration, 0);
    const open = list.filter((o) => isDue(o, today, nowMin, from) && isOpen(o)).reduce((a, o) => a + (o.duration * (100 - o.progress)) / 100, 0);
    const done = list.reduce((a, o) => a + (o.duration * o.progress) / 100, 0);
    days.push({ date: d, minutes, open, done, count: list.length, exams: examsOn(idx.data, d).filter((e) => e.kind !== 'period' && (e.until_date ? e.until_date === d : e.on_date === d)).length });
  }
  return days;
}

/**
 * Serie: aufeinanderfolgende Tage mit Einträgen.
 * Tage ohne Termine (Wochenende, Ferien) unterbrechen nicht. Heute ohne Eintrag zählt noch nicht als Lücke.
 */
export function streak(idx, activityDays, today) {
  const set = activityDays instanceof Set ? activityDays : new Set(activityDays || []);
  if (!set.size) return 0;
  const first = [...set].sort()[0];
  let n = 0;
  let d = today;
  if (set.has(d)) n++;
  for (let i = 0; i < 400; i++) {
    d = addDays(d, -1);
    if (d < first) break;
    if (set.has(d)) { n++; continue; }
    if (occurrencesOn(idx, d).some((o) => !o.cancelled)) break; // Tag mit Terminen ohne Eintrag
  }
  return n;
}

// ---------------- Erinnerungen (Server) ----------------
export const DEFAULT_SETTINGS = {
  offsets: [1440, 180],      // Minuten vor Beginn: 1 Tag, 3 Std.
  examWeek: true,            // Prüfungen zusätzlich 1 Woche vorher
  quiet: { on: true, from: '22:00', to: '07:00' },
};

export function normalizeSettings(raw) {
  const s = { ...DEFAULT_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) };
  s.offsets = Array.isArray(s.offsets) ? [...new Set(s.offsets.map(Number).filter((n) => n > 0 && n <= 20160))].sort((a, b) => b - a) : DEFAULT_SETTINGS.offsets;
  s.examWeek = s.examWeek !== false;
  s.trackFrom = isValidDate(s.trackFrom) ? s.trackFrom : null;
  const q = s.quiet && typeof s.quiet === 'object' ? s.quiet : {};
  s.quiet = { on: q.on !== false, from: /^\d\d:\d\d$/.test(q.from) ? q.from : '22:00', to: /^\d\d:\d\d$/.test(q.to) ? q.to : '07:00' };
  s.badge = ['unread', 'open', 'off'].includes(s.badge) ? s.badge : 'unread'; // Zahl am App-Symbol
  return s;
}

export function offsetLabel(min) {
  if (min % 10080 === 0) return min === 10080 ? '1 Woche' : `${min / 10080} Wochen`;
  if (min % 1440 === 0) return min === 1440 ? '1 Tag' : `${min / 1440} Tage`;
  if (min % 60 === 0) return min === 60 ? '1 Std.' : `${min / 60} Std.`;
  return `${min} Min.`;
}

function inQuiet(min, q) {
  const f = toMin(q.from), t = toMin(q.to);
  return f > t ? (min >= f || min < t) : (min >= f && min < t);
}

/** Verschiebt einen Erinnerungszeitpunkt aus der Ruhezeit heraus (lokal: date+min). */
export function adjustForQuiet(local, eventLocal, q) {
  if (!q?.on || !inQuiet(local.min, q)) return local;
  const F = toMin(q.from), T = toMin(q.to);
  const overnight = F > T;
  const eveningPart = overnight && local.min >= F;
  // 1. Wahl: Ende der Ruhezeit (falls noch vor dem Termin)
  const end = { date: eveningPart ? addDays(local.date, 1) : local.date, min: T };
  const key = (x) => x.date + pad(Math.floor(x.min / 60)) + pad(x.min % 60);
  if (key(end) < key(eventLocal)) return end;
  // 2. Wahl: kurz bevor die Ruhezeit beginnt
  const startDate = overnight && !eveningPart ? addDays(local.date, -1) : local.date;
  return { date: startDate, min: F - 1 };
}

function relText(diffMin) {
  if (diffMin < 60) return `in ${Math.max(1, Math.round(diffMin))} Min.`;
  if (diffMin < 22 * 60) { const h = Math.round(diffMin / 60); return `in ${h} Std.`; }
  const d = Math.round(diffMin / 1440);
  return d === 1 ? 'morgen' : `in ${d} Tagen`;
}

/**
 * Berechnet fällige Erinnerungen im Fenster (fromT, toT] (UTC ms).
 * Liefert [{ key, at, title, body, url }]
 */
export function dueReminders(data, settingsRaw, tz, fromT, toT) {
  const settings = normalizeSettings(settingsRaw);
  const idx = buildIndex(data);
  const out = [];
  const startDay = utcToZoned(fromT, tz).date;
  const maxOff = Math.max(10080, ...settings.offsets);
  const endDay = addDays(utcToZoned(toT + maxOff * 60000, tz).date, 1);

  const push = (key, eventDate, eventMin, offsets, mk) => {
    const evT = zonedToUtc(eventDate, minToHHMM(eventMin), tz);
    const seen = [];
    for (const off of offsets) {
      let local = utcToZoned(evT - off * 60000, tz);
      local = adjustForQuiet(local, { date: eventDate, min: eventMin }, settings.quiet);
      const at = zonedToUtc(local.date, minToHHMM(local.min), tz);
      if (at >= evT) continue;
      if (seen.some((x) => Math.abs(x - at) < 30 * 60000)) continue; // nicht doppelt
      seen.push(at);
      if (at > fromT && at <= toT) {
        const m = mk((evT - at) / 60000);
        out.push({ key: `${key}|${off}`, at, ...m });
      }
    }
  };

  for (let d = startDay; d <= endDay; d = addDays(d, 1)) {
    for (const o of occurrencesOn(idx, d)) {
      if (!o.mandatory || o.cancelled) continue;
      push(`o|${o.key}`, o.date, o.startMin, settings.offsets, (diff) => ({
        title: `${o.subject?.name || 'Termin'} · ${KINDS[o.series.kind]?.label || ''}`.trim(),
        body: `Pflichttermin ${relText(diff)} um ${o.starts}${o.room ? ' · ' + o.room : ''}`,
        url: `./#day/${o.date}`,
      }));
    }
  }
  for (const e of data.exams || []) {
    if (!e.remind) continue;
    const sub = idx.subById.get(e.subject_id);
    const label = EXAM_KINDS[e.kind]?.label || 'Termin';
    const name = e.title || sub?.name || label;
    if (e.kind === 'registration' || e.kind === 'submission' || (e.until_date && e.kind !== 'period')) {
      // Frist: am Vortag des Endes 18:00 und am letzten Tag 09:00
      const last = e.until_date || e.on_date;
      if (last < startDay || last > endDay) continue;
      const evMin = e.ends_at ? toMin(e.ends_at) : 23 * 60 + 59;
      push(`e|${e.id}|end`, last, evMin, [evMin - 9 * 60 + 0, evMin + (24 * 60 - 18 * 60)].filter((x) => x > 0), (diff) => ({
        title: `${label}: ${name}`,
        body: diff > 20 * 60 ? 'Frist endet morgen' : `Frist endet heute${e.ends_at ? ' um ' + hhmm(e.ends_at) : ''}`,
        url: './#exams',
      }));
      if (e.until_date && e.on_date !== e.until_date && e.on_date >= startDay && e.on_date <= endDay) {
        push(`e|${e.id}|start`, e.on_date, 9 * 60, [1], () => ({ title: `${label}: ${name}`, body: `Ab heute möglich – bis ${fmtShort(e.until_date)}`, url: './#exams' }));
      }
      continue;
    }
    if (e.kind === 'period') continue;
    if (e.on_date < startDay || e.on_date > endDay) continue;
    const evMin = e.starts_at ? toMin(e.starts_at) : 8 * 60;
    const offs = [...settings.offsets];
    if (settings.examWeek) offs.unshift(10080);
    push(`e|${e.id}`, e.on_date, evMin, offs, (diff) => ({
      title: `${label}: ${name}`,
      body: `${relText(diff)[0].toUpperCase() + relText(diff).slice(1)}${e.starts_at ? ' um ' + hhmm(e.starts_at) : ''}${e.room ? ' · ' + e.room : ''}`,
      url: './#exams',
    }));
  }
  return out.sort((a, b) => a.at - b.at);
}

export function fmtShort(s) {
  return `${Number(s.slice(8, 10))}.${Number(s.slice(5, 7))}.`;
}
