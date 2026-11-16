// Hauptansichten: Heute, Woche (Stundenplan), Fächer, Fach, Nachholen, Prüfungen.
import * as S from './schedule.js';
import { store, idx, putSettings } from './store.js';
import { icon } from './icons.js';
import { esc, fmtDate, fmtLong, fmtRange, fmtHours, relDays, fmtStars, miniStars, WD, WD_LONG, navBar, largeTitle, backBtn } from './ui.js';
import { ui, today, nowMin, currentSemester, subjectsOf } from './ctx.js';
import { bellBtn } from './inbox.js';
import { pushState } from './push.js';
import { pflichtItems, pflichtRow } from './overview.js';

const KIND = (k) => S.KINDS[k]?.label || 'Termin';
const F = () => store.settings.trackFrom;
/** Knöpfe oben rechts auf den Hauptansichten (am Desktop übernimmt das die Seitenleiste). */
const settingsBtn = () => `${bellBtn()}<button class="nav-btn compact-only" data-act="new" aria-label="Neu">${icon('plus')}</button><button class="nav-btn compact-only" data-act="settings" aria-label="Einstellungen">${icon('gear')}</button>`;
const wide = () => matchMedia('(min-width: 900px) and (min-height: 500px)').matches;

function durText(min) {
  min = Math.max(1, Math.round(min));
  if (min < 60) return `${min} Min.`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}:${String(m).padStart(2, '0')} Std.` : `${h} Std.`;
}

/** Prüfungen/Fristen, die an diesem Tag als Termin zählen (Zeiträume nur am letzten Tag). */
const markedExams = (d) => S.examsOn(store.data, d).filter((e) => (e.kind === 'exam' || e.kind === 'oral' || e.kind === 'submission' || e.kind === 'other') ? e.on_date === d : e.kind !== 'period' && (e.until_date || e.on_date) === d);

/** Hängt im Stundenplan etwas von hellen/dunklen Wochen ab? Sonst blenden wir das aus. */
function usesParity(sem) {
  const subIds = new Set(store.data.subjects.filter((x) => x.semester_id === sem.id).map((x) => x.id));
  return store.data.series.some((sr) => subIds.has(sr.subject_id) && (sr.weeks_rule === 'A' || sr.weeks_rule === 'B'));
}

function weekText(date) {
  const sem = S.semesterFor(store.data.semesters, date);
  const wi = S.weekInfo(sem, date);
  const kw = `KW ${S.isoWeek(date)}`;
  if (!wi) return kw;
  if (wi.kind === 'lecture') return wi.parity && usesParity(sem) ? `${kw} · ${S.parityLabel(sem, wi.parity)}` : kw;
  return `${kw} · ${S.WEEK_KINDS[wi.kind]}`;
}

// ---------------- Bausteine ----------------
export function checkBtn(o) {
  const done = o.progress >= 100;
  return `<button class="check ${done ? 'done' : ''}" data-act="done" data-key="${esc(o.key)}" data-p="${o.progress}" aria-label="${done ? 'Als offen markieren' : 'Als erledigt markieren'}"><i style="--p:${o.progress}"></i></button>`;
}

/**
 * Eine Termin-Zeile. showDate: Datum statt Uhrzeit links. kindTitle: Art als Titel (für Listen,
 * die ohnehin nach Fach gruppiert sind – dann steht das Fach nicht in jeder Zeile).
 */
export function occRow(o, { showDate = false, kindTitle = false } = {}) {
  const t = today(), nm = nowMin();
  const past = o.date < t || (o.date === t && o.endMin <= nm);
  const now = o.date === t && o.startMin <= nm && o.endMin > nm && !o.cancelled;
  const meta = [
    kindTitle ? (o.series.lecturer ? esc(o.series.lecturer) : '') : KIND(o.series.kind) + (o.series.lecturer ? ' · ' + esc(o.series.lecturer) : ''),
    o.room ? esc(o.room) : '',
    o.series.group_label ? esc(o.series.group_label) : '',
    o.moved ? 'verlegt' : '',
    o.cancelled ? 'fällt aus' : '',
    o.mandatory && !o.cancelled ? '<span class="pflicht">Pflicht</span>' : '',
  ].filter(Boolean).join(' · ');
  const extra = (o.stars != null || (o.progress > 0 && o.progress < 100)) && !o.cancelled
    ? `<div class="extra">${o.progress > 0 && o.progress < 100 ? `<span class="pct">${o.progress} %</span>` : ''}${miniStars(o.stars)}</div>` : '';
  return `<div class="cell occ ${o.cancelled ? 'cancelled' : ''} ${past ? 'past' : ''} ${now ? 'now' : ''}" data-c="${o.subject?.color || 'slate'}" role="button" tabindex="0" data-act="occ" data-key="${esc(o.key)}">
    <div class="tm">${showDate ? `<b>${WD[S.weekday(o.date) - 1]}</b><span>${Number(o.date.slice(8))}.${Number(o.date.slice(5, 7))}.</span>` : `<b>${o.starts}</b><span>${o.ends}</span>`}</div>
    <span class="bar"></span>
    <div class="main"><div class="name">${kindTitle ? KIND(o.series.kind) : esc(o.subject?.name)}</div><div class="meta">${showDate ? o.starts + (meta ? ' · ' : '') : ''}${meta}</div>
      ${o.note ? `<div class="note">${icon('note')}<span>${esc(o.note)}</span></div>` : ''}${extra}</div>
    ${o.cancelled ? '' : checkBtn(o)}
  </div>`;
}

/** Tagesliste: Termine untereinander, nur Überschneidungen werden eigens markiert. */
function dayList(list) {
  let h = '', prevEnd = null;
  for (const o of list) {
    if (prevEnd != null && !o.cancelled && o.startMin - prevEnd < 0) h += `<div class="cell gap warn">Überschneidet sich mit dem vorherigen Termin</div>`;
    h += occRow(o);
    if (!o.cancelled) prevEnd = Math.max(prevEnd ?? 0, o.endMin);
  }
  return `<div class="group">${h}</div>`;
}

export function examRow(e, ref = today()) {
  const sub = idx().subById.get(e.subject_id);
  const label = S.EXAM_KINDS[e.kind]?.label || 'Termin';
  const isRange = e.until_date && e.until_date !== e.on_date;
  const deadline = e.kind === 'registration' || e.kind === 'submission';
  const [sq, ic] = e.kind === 'period' ? ['gray', 'cal'] : deadline ? ['orange', 'hourglass'] : e.kind === 'other' ? ['blue', 'info'] : ['red', 'cap'];
  let v;
  if (isRange && e.on_date <= ref) { const left = S.diffDays(ref, e.until_date); v = left === 0 ? 'endet heute' : `noch ${left + 1} T.`; }
  else { const d = S.diffDays(ref, e.on_date); v = d === 0 ? 'heute' : d === 1 ? 'morgen' : d > 0 ? `in ${d} T.` : ''; }
  const when = `${isRange ? fmtRange(e.on_date, e.until_date) : fmtDate(e.on_date)}${e.starts_at ? ' · ' + S.hhmm(e.starts_at) : ''}${e.room ? ' · ' + esc(e.room) : ''}`;
  return `<button class="cell ic" data-act="exam" data-id="${e.id}">
    <span class="sq ${sq}">${icon(ic)}</span>
    <span class="main"><span class="t">${esc(e.title)}</span><span class="s">${e.kind === 'period' || e.title.includes(label) ? '' : label + ' · '}${when}${sub && sub.name !== e.title ? ' · ' + esc(sub.name) : ''}</span></span>
    <span class="v">${v}</span></button>`;
}

function nextClass(from) {
  for (let i = 1; i <= 60; i++) {
    const d = S.addDays(from, i);
    const l = S.occurrencesOn(idx(), d).filter((o) => !o.cancelled);
    if (l.length) return l[0];
  }
  return null;
}
export function nextExam(from = today()) {
  return store.data.exams.filter((e) => (e.kind === 'exam' || e.kind === 'oral' || e.kind === 'submission') && e.on_date >= from)
    .sort((a, b) => (a.on_date < b.on_date ? -1 : a.on_date > b.on_date ? 1 : S.toMin(a.starts_at) - S.toMin(b.starts_at)))[0] || null;
}
export function nextExamFor(subjectId, from = today()) {
  return store.data.exams.filter((e) => e.subject_id === subjectId && e.kind !== 'period' && (e.until_date || e.on_date) >= from)
    .sort((a, b) => (a.on_date < b.on_date ? -1 : 1))[0] || null;
}

/** Alles Offene (fällig, nicht erledigt) im aktuellen Semester. */
export function openItems() {
  const sem = currentSemester();
  if (!sem) return { open: [], weak: [] };
  const I = idx(), t = today(), nm = nowMin();
  const open = [], weak = [];
  for (const s of subjectsOf(sem.id)) {
    const st = S.subjectStats(I, s.id, t, nm, F());
    open.push(...st.open);
    weak.push(...st.weak);
  }
  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.startMin - b.startMin);
  return { open: open.sort(byDate), weak: weak.sort(byDate) };
}

// ======================= LERNPLAN =======================
let planSavedFor = null;
/**
 * Lernplan für heute. Wird einmal am Tag festgelegt und in den Einstellungen gespeichert,
 * damit Abhaken ihn nicht verschiebt und alle Geräte denselben Plan sehen. fresh: neu verteilen.
 */
export function todayPlan({ fresh = false } = {}) {
  const sem = currentSemester();
  if (!sem) return [];
  const t = today(), I = idx();
  let items = !fresh && store.settings.plan?.date === t ? store.settings.plan.items : null;
  if (!items) {
    items = S.studyPlan(I, sem.id, t, nowMin(), F()).flatMap((p) => p.items.map((o) => ({ k: o.key, t: o.progress >= 100 ? 'weak' : 'open' })));
    // erst speichern, wenn die echten Daten da sind – sonst würde ein leerer Plan festgeschrieben
    if (store.loaded && (fresh || planSavedFor !== t)) {
      planSavedFor = t;
      const plan = { date: t, items };
      if (fresh) putSettings({ plan }); else setTimeout(() => putSettings({ plan }), 0); // nicht mitten im Zeichnen speichern
    }
  }
  const out = [];
  for (const { k, t: type } of items) {
    const [sid, d] = k.split('|');
    const sr = store.data.series.find((s) => s.id === sid);
    if (!sr) continue;
    const o = S.makeOcc(I, sr, d);
    if (!o.subject || o.cancelled) continue;
    out.push({ o, type, done: S.planItemDone(o, type) });
  }
  return out;
}

/** Geschätzte Restzeit: Offenes anteilig, Wiederholen etwa ein Drittel der Termindauer. */
const planMinutes = (plan) => plan.filter((x) => !x.done).reduce((a, x) => a + (x.type === 'weak' ? x.o.duration / 3 : (x.o.duration * (100 - x.o.progress)) / 100), 0);

function planRow({ o, type, done }) {
  const ex = S.nextExamOf(store.data, o.subject.id, today());
  const meta = [
    type === 'weak' ? 'Wiederholen' : o.progress > 0 && o.progress < 100 ? `Nachholen · ${o.progress} %` : 'Nachholen',
    `${KIND(o.series.kind)} vom ${fmtDate(o.date, { weekday: false })}`,
    ex ? `${S.EXAM_KINDS[ex.kind]?.label || 'Prüfung'} ${relDays(S.diffDays(today(), ex.on_date))}` : '',
  ].filter(Boolean).join(' · ');
  const right = type === 'open' ? checkBtn(o)
    : `<span class="check ${done ? 'done' : ''}" aria-hidden="true"><i style="--p:${done ? 100 : 0}"></i></span>`;
  return `<div class="cell occ plan ${done ? 'is-done' : ''}" data-c="${o.subject.color || 'slate'}" role="button" tabindex="0" data-act="occ" data-key="${esc(o.key)}">
    <span class="bar"></span>
    <div class="main"><div class="name">${esc(o.subject.name)}</div><div class="meta">${meta}</div>
      ${type === 'weak' ? `<div class="extra">${miniStars(o.stars)}${done ? '' : '<span class="hint">neu bewerten</span>'}</div>` : ''}</div>
    ${right}
  </div>`;
}

function planSection(plan) {
  if (!plan.length) return '';
  const done = plan.filter((x) => x.done).length;
  return `<div class="gh" id="plan">Heute lernen · ${done}/${plan.length}<button class="link" data-act="replan">Neu verteilen</button></div>
    <div class="group">${plan.map(planRow).join('')}</div>`;
}

/** Karte oben auf „Heute“: eine Zahl, eine Zeile, darunter Offenes und nächste Prüfung als Links. */
function heroCard(plan, sem) {
  const t = today(), I = idx();
  const done = plan.filter((x) => x.done).length, left = plan.length - done;
  const back = S.backlog(I, sem.id, t, nowMin(), F());
  const ne = nextExam();
  const neDays = ne ? S.diffDays(t, ne.on_date) : null;
  const subs = [...new Set(plan.filter((x) => !x.done).map((x) => x.o.subject.name))];
  let num, unit, line;
  if (!plan.length) { num = icon('checkCircle'); unit = back.count ? 'Heute nichts' : 'Alles erledigt'; line = back.count ? 'Offenes ist auf andere Tage verteilt.' : 'Nichts offen – genieß den Tag.'; }
  else if (!left) { num = icon('checkCircle'); unit = 'Geschafft'; line = `Alles für heute erledigt (${plan.length} von ${plan.length}).`; }
  else { num = left; unit = 'zum Nachholen'; line = `ca. ${fmtHours(planMinutes(plan))} · ${subs.slice(0, 2).map(esc).join(', ')}${subs.length > 2 ? ` +${subs.length - 2}` : ''}`; }
  const pct = plan.length ? Math.round((done / plan.length) * 100) : 100;
  const foot = [
    back.count ? `<button class="hero-link" data-act="backlog">${back.count} offen insgesamt${icon('right', 'chev')}</button>` : '',
    ne ? `<button class="hero-link" data-act="toExams">${esc(S.EXAM_KINDS[ne.kind]?.label || 'Prüfung')} ${relDays(neDays)}${icon('right', 'chev')}</button>` : '',
  ].filter(Boolean).join('');
  return `<div class="hero ${plan.length && !left ? 'win' : ''}">
    <button class="hero-main" ${plan.length ? 'data-act="toPlan"' : back.count ? 'data-act="backlog"' : 'disabled'}>
      <span class="hero-k">Heute lernen</span>
      <span class="hero-num">${num}${unit ? `<small>${unit}</small>` : ''}</span>
      <span class="hero-line">${line}</span>
      ${plan.length ? `<span class="hero-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></span>` : ''}
    </button>
    ${foot ? `<div class="hero-foot">${foot}</div>` : ''}
  </div>`;
}

/** Zeile ganz oben: was gerade läuft bzw. als Nächstes ansteht – mit Restzeit. */
function nowBar(list) {
  const t = today(), nm = nowMin();
  const act = list.filter((o) => !o.cancelled);
  const cur = act.find((o) => o.startMin <= nm && o.endMin > nm);
  const next = act.find((o) => o.startMin > nm);
  const where = (o) => [KIND(o.series.kind), o.room ? esc(o.room) : ''].filter(Boolean).join(' · ');
  if (cur) {
    const pct = Math.round(((nm - cur.startMin) / Math.max(1, cur.duration)) * 100);
    return `<button class="nowbar live" data-act="occ" data-key="${esc(cur.key)}" data-c="${cur.subject.color || 'slate'}">
      <span class="pulse" aria-hidden="true"></span>
      <span class="main"><span class="k">Läuft gerade</span><span class="t">${esc(cur.subject.name)}</span><span class="s">${where(cur)} · bis ${cur.ends}${next ? ` · danach ${esc(next.subject.name)} ${next.starts}` : ''}</span></span>
      <span class="v"><small>noch</small>${durText(cur.endMin - nm)}</span>
      <i class="prog" style="width:${pct}%"></i></button>`;
  }
  if (next) {
    return `<button class="nowbar" data-act="occ" data-key="${esc(next.key)}" data-c="${next.subject.color || 'slate'}">
      <span class="bar" aria-hidden="true"></span>
      <span class="main"><span class="k">Als Nächstes</span><span class="t">${esc(next.subject.name)}</span><span class="s">${next.starts} · ${where(next)}</span></span>
      <span class="v"><small>in</small>${durText(next.startMin - nm)}</span></button>`;
  }
  if (act.length) return '';
  const nc = nextClass(t);
  if (!nc) return '';
  const dd = S.diffDays(t, nc.date);
  return `<button class="nowbar" data-act="day" data-d="${nc.date}" data-c="${nc.subject.color || 'slate'}">
    <span class="bar" aria-hidden="true"></span>
    <span class="main"><span class="k">Nächster Termin</span><span class="t">${esc(nc.subject.name)}</span><span class="s">${fmtDate(nc.date)} · ${nc.starts} · ${where(nc)}</span></span>
    <span class="v">${dd === 1 ? 'morgen' : `<small>in</small>${dd} Tagen`}</span></button>`;
}

/** „Erste Schritte“: zeigt Neuen in vier Punkten, wie die App funktioniert. Verschwindet, wenn alles erledigt ist. */
function setupCard() {
  try { if (localStorage.getItem('sl.setup.hide') === '1') return { html: '', early: false }; } catch { return { html: '', early: false }; }
  const ps = pushState();
  const steps = [
    { done: store.data.series.length > 0, t: 'Stundenplan eintragen', s: 'Fächer und Termine einmal anlegen – gilt dann für jede Woche.', act: 'editTT' },
    { done: store.data.occurrences.some((o) => o.progress > 0 || o.stars != null), t: 'Einen Termin abhaken', s: 'Kreis antippen = nachgearbeitet. Termin antippen für Prozent, Sterne und Notiz.', act: 'firstOcc' },
    { done: store.data.exams.some((e) => e.kind === 'exam' || e.kind === 'oral' || e.kind === 'submission'), t: 'Prüfung eintragen', s: 'Dann zählt Studyloop die Tage und verteilt das Lernen bis dahin.', act: 'newExam' },
  ];
  if (ps.supported && ps.permission !== 'denied') steps.push({ done: ps.permission === 'granted', t: 'Erinnerungen einschalten', s: 'Vor Pflichtterminen, Fristen und Prüfungen.', act: 'reminders' });
  const n = steps.filter((x) => x.done).length;
  if (n === steps.length) return { html: '', early: false };
  // Ganz neu (noch nichts abgehakt): die Liste steht oben, danach rutscht sie ans Ende
  const early = !steps[0].done || !steps[1].done;
  const html = `<div class="gh">Erste Schritte · ${n}/${steps.length}<button class="link" data-act="setupHide">Ausblenden</button></div>
    <div class="group setup">${steps.map((x, i) => `<button class="cell ic ${x.done ? 'is-done' : ''}" data-act="${x.act}" ${x.done ? 'disabled' : ''}>
      <span class="step">${x.done ? icon('check') : i + 1}</span>
      <span class="main"><span class="t">${x.t}</span>${x.done ? '' : `<span class="s">${x.s}</span>`}</span>${x.done ? '' : icon('right', 'chev')}</button>`).join('')}</div>`;
  return { html, early };
}

// ======================= HEUTE =======================
export function renderDay(el) {
  const date = ui.day, t = today();
  const I = idx();
  const sem = S.semesterFor(store.data.semesters, date);
  const wi = S.weekInfo(sem, date);
  const list = S.occurrencesOn(I, date);
  const exams = S.examsOn(store.data, date).filter((e) => e.kind !== 'period' || e.on_date === date);
  const diff = S.diffDays(t, date);
  const title = diff === 0 ? 'Heute' : diff === 1 ? 'Morgen' : diff === -1 ? 'Gestern' : WD_LONG[S.weekday(date) - 1];
  const sub = `${diff === 0 || Math.abs(diff) === 1 ? fmtLong(date) : fmtLong(date, { weekday: false })}${date.slice(0, 4) !== t.slice(0, 4) ? ' ' + date.slice(0, 4) : ''} · ${esc(weekText(date))}`;

  const mon = S.mondayOf(date);
  let strip = '';
  for (let i = 0; i < 7; i++) {
    const d = S.addDays(mon, i);
    const l = S.occurrencesOn(I, d).filter((o) => !o.cancelled);
    const ex = markedExams(d);
    const dots = ex.length ? '<i class="red"></i>' : l.length ? '<i></i>' : '';
    strip += `<button data-act="day" data-d="${d}" class="${d === t ? 'today' : ''} ${d === date ? 'sel' : ''} ${i > 4 ? 'weekend' : ''}" aria-label="${fmtLong(d)}" ${d === date ? 'aria-current="date"' : ''}>
      <span class="wd">${WD[i]}</span><span class="dn">${Number(d.slice(8))}</span><span class="dots">${dots}</span></button>`;
  }

  // Hinweis zum Tag (Feiertag, Projektwoche …)
  let note = '';
  const hol = S.holidayOn(sem, date);
  if (hol) note = `${icon('sun')}<span>${esc(hol.name)} – frei</span>`;
  else if (!sem) note = `${icon('info')}<span>Außerhalb deines Semesters</span>`;
  else if (wi && wi.kind !== 'lecture') note = `${icon(wi.kind === 'exams' ? 'cap' : 'info')}<span>${{ project: 'Projektwoche – keine regulären Vorlesungen', free: 'Vorlesungsfreie Zeit', exams: 'Prüfungszeit – viel Erfolg!' }[wi.kind]}</span>`;

  let content;
  const nAct = list.filter((o) => !o.cancelled).length;
  if (list.length) content = `<div class="gh">Stundenplan<span class="num">${nAct} ${nAct === 1 ? 'Termin' : 'Termine'}</span></div>${dayList(list)}`;
  else {
    const nc = nextClass(date);
    content = `<div class="empty">${icon('cal')}<h3>Keine Termine</h3><p>${nc ? `Als Nächstes: ${esc(nc.subject.name)} am ${fmtDate(nc.date)} um ${nc.starts}.` : 'Sobald dein Stundenplan steht, erscheinen hier deine Termine.'}</p>
      ${nc ? `<button class="btn small" data-act="day" data-d="${nc.date}">Zum nächsten Termin</button>` : '<button class="btn small primary" data-act="editTT">Stundenplan anlegen</button>'}</div>`;
  }

  // Nur auf "Heute": was läuft, Lernplan, erste Schritte
  let catchUp = '', hero = '', now = '', setup = { html: '', early: false };
  const curSem = diff === 0 ? currentSemester() : null;
  if (diff === 0) {
    setup = setupCard();
    now = nowBar(list);
    if (curSem && subjectsOf(curSem.id).length) {
      const plan = todayPlan();
      hero = heroCard(plan, curSem);
      catchUp = planSection(plan);
    }
  }

  el.innerHTML = `
    ${navBar({ title, right: settingsBtn() })}
    ${largeTitle(title, sub, diff !== 0 ? `<button class="pill-btn" data-act="day" data-d="${t}" title="Zurück zu heute (T)">Heute</button>` : '')}
    <div class="strip-wrap"><div class="strip" data-swipe="week">${strip}</div></div>
    <div class="wrap slide" data-swipe="day">
      ${now}
      ${setup.early ? `<div class="setup-top">${setup.html}</div>` : ''}
      ${hero}
      ${note ? `<div class="note-banner" style="margin:12px 4px 0">${note}</div>` : ''}
      <div class="split"><div class="primary">
      ${exams.length ? `<div class="gh">Prüfungen & Fristen</div><div class="group">${exams.map((e) => examRow(e, date)).join('')}</div>` : ''}
      ${content}
      </div><aside class="side">
      ${catchUp}
      ${setup.early ? '' : setup.html}
      </aside></div>
    </div>`;
}

// ======================= WOCHE (Stundenplan) =======================
export function renderWeek(el) {
  const mon = ui.weekMon, sun = S.addDays(mon, 6), t = today(), nm = nowMin();
  const I = idx();
  const sem = S.semesterFor(store.data.semesters, mon) || S.semesterFor(store.data.semesters, S.addDays(mon, 4));
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = S.addDays(mon, i);
    days.push({ d, i, list: S.occurrencesOn(I, d), exams: markedExams(d) });
  }
  const deadlines = days.flatMap((x) => x.exams.filter((e) => !e.starts_at && e.kind !== 'exam' && e.kind !== 'oral').map((e) => ({ e, d: x.d })));
  for (const x of days) x.exams = x.exams.filter((e) => !deadlines.some((y) => y.e === e));
  const weekend = days.slice(5).some((x) => x.list.length || x.exams.length);
  const shown = weekend ? days : days.slice(0, 5);
  const times = shown.flatMap((x) => [...x.list.filter((o) => !o.cancelled).map((o) => [o.startMin, o.endMin]), ...x.exams.filter((e) => e.starts_at).map((e) => [S.toMin(e.starts_at), e.ends_at ? S.toMin(e.ends_at) : S.toMin(e.starts_at) + 90])]);
  const start = times.length ? Math.floor(Math.min(...times.map((x) => x[0])) / 60) * 60 : 8 * 60;
  const end = times.length ? Math.ceil(Math.max(...times.map((x) => x[1])) / 60) * 60 : 18 * 60;
  // Am großen Bildschirm passt der ganze Tag ohne Scrollen; am Handy bleibt die Höhe gut lesbar
  const ppm = wide() ? Math.max(0.85, Math.min(1.5, (innerHeight - 250) / (end - start))) : 1.2;
  const height = Math.max(160, (end - start) * ppm);
  const subjects = sem ? subjectsOf(sem.id) : [];
  const anything = shown.some((x) => x.list.length || x.exams.length);

  let axis = '';
  for (let h = start / 60; h <= end / 60; h++) axis += `<span style="top:${(h * 60 - start) * ppm}px">${String(h).padStart(2, '0')}</span>`;

  const cols = shown.map(({ d, i, list, exams }) => {
    const items = S.layoutColumns(list);
    let h = '';
    const box = (o, col, ncols, extraCls = '') => {
      const top = (o.startMin - start) * ppm, hh = Math.max(24, o.duration * ppm - 3);
      const w = 100 / ncols, small = hh < 64 || ncols > 1;
      const flag = o.cancelled ? '' : o.progress >= 100 ? '<span class="done"></span>' : o.mandatory ? '<span class="flag"></span>' : '';
      return `<button class="tt-item ${extraCls} ${o.progress >= 100 ? 'is-done' : ''}" data-c="${o.subject.color}" data-act="occ" data-key="${esc(o.key)}" style="top:${top}px;height:${hh}px;left:calc(${col * w}% + 3px);right:auto;width:calc(${w}% - 6px)" aria-label="${esc(o.subject.name)}, ${S.KINDS[o.series.kind]?.label || ''}, ${o.starts} bis ${o.ends}">
        ${!small ? `<span class="tm a">${o.starts}</span>` : ''}${flag}
        <b>${esc(o.subject.name)}</b>
        <span class="k">${S.KINDS[o.series.kind]?.short || ''}${o.series.lecturer && !small ? ' ' + esc(o.series.lecturer) : ''}</span>
        ${!small ? `<span class="k">${esc(o.room)}</span>` : ''}
      </button>`;
    };
    for (const it of items) h += box(it.o, it.col, it.cols);
    for (const o of list.filter((x) => x.cancelled)) h += box(o, 0, 1, 'cancelled');
    for (const e of exams) {
      const s0 = e.starts_at ? S.toMin(e.starts_at) : start;
      const e0 = e.ends_at ? S.toMin(e.ends_at) : s0 + 90;
      h += `<button class="tt-item exam" data-act="exam" data-id="${e.id}" style="top:${(s0 - start) * ppm}px;height:${Math.max(30, (e0 - s0) * ppm - 3)}px"><b>${esc(S.EXAM_KINDS[e.kind]?.label || 'Prüfung')}</b><span class="k">${esc(e.title)}</span></button>`;
    }
    if (d === t && nm > start && nm < end) h += `<div class="tt-now" style="top:${(nm - start) * ppm}px"></div>`;
    const hol = S.holidayOn(sem, d);
    if (hol) h += `<div class="tt-pause" style="top:24px"><span>${esc(hol.name)}</span></div>`;
    h += `<button class="tt-ghost" data-act="slot" hidden tabindex="-1" aria-hidden="true" style="height:${90 * ppm - 3}px"><span></span></button>`;
    return `<div class="tt-col ${d === t ? 'today' : ''}"><button class="tt-dayh ${d === t ? 'today' : ''}" data-act="day" data-d="${d}" aria-label="${fmtLong(d)} öffnen"><span class="wd">${WD[i]}</span><span class="dn">${Number(d.slice(8))}</span></button>
      <div class="tt-body" data-wd="${i + 1}" data-ppm="${ppm}" data-start="${start}" data-end="${end}" style="height:${height}px">${h}</div></div>`;
  }).join('');

  const all = S.occurrencesBetween(I, mon, sun).filter((o) => !o.cancelled);
  const open = all.filter((o) => S.isDue(o, t, nm, F()) && S.isOpen(o));
  const total = all.reduce((a, o) => a + o.duration, 0);
  const openMin = open.reduce((a, o) => a + (o.duration * (100 - o.progress)) / 100, 0);
  const isCur = mon === S.mondayOf(t);
  const title = fmtRange(mon, sun);
  const allOpen = isCur || mon < t ? openItems().open.length : 0;

  el.innerHTML = `
    ${navBar({ title, right: settingsBtn() })}
    ${largeTitle(title, `<button class="lt-link" data-act="semMap" aria-label="Alle Wochen des Semesters" title="Alle Wochen des Semesters">${esc(weekText(mon))}${total ? ' · ' + fmtHours(total) : ''}${icon('down', 'chev')}</button>`, `
      <div class="tt-tools">${!isCur ? `<button class="pill-btn" data-act="wk" data-d="0" title="Zurück zu dieser Woche (T)">Heute</button>` : ''}
      <button class="circle-btn" data-act="wk" data-d="-7" aria-label="Vorherige Woche" title="Vorherige Woche (←)">${icon('left')}</button>
      <button class="circle-btn" data-act="wk" data-d="7" aria-label="Nächste Woche" title="Nächste Woche (→)">${icon('right')}</button></div>`)}
    ${deadlines.map(({ e, d }) => `<button class="note-banner" data-act="exam" data-id="${e.id}" style="min-height:32px">${icon('hourglass')}<span><b style="color:var(--label)">${esc(e.title)}</b> – ${e.until_date && e.until_date !== e.on_date ? 'endet' : 'am'} ${fmtDate(d)}</span></button>`).join('')}
    <div data-swipe="wk" class="slide">
    ${subjects.length ? (anything ? `<div class="tt-grid" style="--days:${shown.length};--hl:${60 * ppm}px"><div class="tt-axis" aria-hidden="true"><div class="tt-dayh"><span class="wd">&nbsp;</span><span class="dn">&nbsp;</span></div><div class="tt-axis-body" style="height:${height}px">${axis}</div></div>${cols}</div>` : `<div class="empty">${icon('cal')}<h3>${sem && S.weekInfo(sem, mon)?.kind !== 'lecture' && S.weekInfo(sem, mon) ? S.WEEK_KINDS[S.weekInfo(sem, mon).kind] : 'Keine Termine'}</h3><p>In dieser Woche stehen keine regulären Termine an.</p></div>`)
      : `<div class="empty">${icon('grid')}<h3>Noch kein Stundenplan</h3><p>Trag deine Vorlesungen, Übungen und Praktika einmal ein – jede Woche ergibt sich dann von selbst.</p><button class="btn small primary" data-act="editTT">Stundenplan anlegen</button></div>`}
    </div>
    <div class="wrap">
      ${open.length ? `<div class="gh">Offen in dieser Woche<span class="num">${fmtHours(openMin)}</span></div><div class="group">${open.map((o) => occRow(o, { showDate: true })).join('')}</div>` : ''}
      ${allOpen > open.length ? `<div class="group" style="margin-top:${open.length ? 12 : 26}px"><button class="cell" data-act="backlog"><span class="main"><span class="t">Alles Offene im Semester</span></span><span class="v">${allOpen}</span>${icon('right', 'chev')}</button></div>` : ''}
      ${subjects.length ? `<div class="group" style="margin-top:12px"><button class="cell accent" data-act="editTT"><span class="main"><span class="t">Stundenplan bearbeiten</span></span></button></div>` : ''}
    </div>`;
}

// ======================= FÄCHER =======================
export function renderSubjects(el) {
  const sem = currentSemester();
  const t = today(), nm = nowMin(), I = idx();
  const subs = sem ? subjectsOf(sem.id) : [];
  const sems = store.data.semesters;
  const stats = subs.map((s) => ({ s, st: S.subjectStats(I, s.id, t, nm, F()), ex: nextExamFor(s.id) }));
  stats.sort((a, b) => (a.ex && b.ex ? (a.ex.on_date < b.ex.on_date ? -1 : 1) : a.ex ? -1 : b.ex ? 1 : 0) || a.s.sort - b.s.sort);
  const rated = stats.flatMap((x) => x.st.due.filter((o) => o.stars != null));
  const avg = rated.length ? rated.reduce((a, o) => a + o.stars, 0) / rated.length : null;
  const dueAll = stats.flatMap((x) => x.st.due);
  const prog = dueAll.length ? Math.round(dueAll.reduce((a, o) => a + o.progress, 0) / dueAll.length) : null;
  const openCount = stats.reduce((a, x) => a + x.st.open.length, 0);
  const weakCount = stats.reduce((a, x) => a + x.st.weak.length, 0);
  const semSel = sems.length > 1 ? `<select data-act="sem" aria-label="Semester" style="height:30px;line-height:30px;width:auto;background-color:var(--fill);font-size:.882rem;padding:0 30px 0 12px;background-position:right 10px center">${[...sems].sort((a, b) => (a.starts_on > b.starts_on ? -1 : 1)).map((s) => `<option value="${s.id}" ${s.id === sem?.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>` : esc(sem?.name || '');

  const selId = subs.some((x) => x.id === ui.subjectSel) ? ui.subjectSel : stats[0]?.s.id;
  const row = ({ s, st, ex }) => {
    const parts = [];
    if (st.open.length) parts.push(`${st.open.length} offen`);
    if (st.weak.length) parts.push(`${st.weak.length} wiederholen`);
    if (st.avgStars != null) parts.push(`★ ${fmtStars(st.avgStars)}`);
    if (ex) parts.push(`${S.EXAM_KINDS[ex.kind]?.label || 'Prüfung'} ${relDays(S.diffDays(t, ex.on_date))}`);
    if (!parts.length) parts.push(st.due.length ? 'Alles erledigt' : 'Noch nichts fällig');
    return `<button class="cell ic ${s.id === selId ? 'selected' : ''}" data-act="subject" data-id="${s.id}" data-c="${s.color}">
      <span class="sq lg">${esc((s.code || s.name).slice(0, 3))}</span>
      <span class="main"><span class="t">${esc(s.name)}</span><span class="s">${parts.join(' · ')}</span>
        ${st.progress != null ? `<span class="pbar" role="progressbar" aria-valuenow="${Math.round(st.progress)}" aria-valuemin="0" aria-valuemax="100" aria-label="Bearbeitet"><i style="width:${Math.round(st.progress)}%"></i></span>` : ''}</span>
      <span class="v">${st.progress != null ? Math.round(st.progress) + ' %' : ''}</span>${icon('right', 'chev')}</button>`;
  };

  el.innerHTML = `
    ${navBar({ title: 'Fächer', right: settingsBtn() })}
    ${largeTitle('Fächer', semSel)}
    <div class="wrap">
    ${subs.length ? `<div class="md"><div class="master">
      <div class="stats" style="margin-top:8px">
        <button class="stat" data-act="backlog"><div class="k">Offen</div><div class="val">${openCount}</div></button>
        <div class="stat"><div class="k">Sicherheit</div><div class="val">${fmtStars(avg)}${avg != null ? '<small>/ 5</small>' : ''}</div></div>
        <div class="stat"><div class="k">Bearbeitet</div><div class="val">${prog == null ? '–' : prog + '<small>%</small>'}</div></div>
      </div>
      <div class="gh">${subs.length} Fächer</div>
      <div class="group">${stats.map(row).join('')}</div>
      <div class="group" style="margin-top:12px">
        ${openCount || weakCount ? `<button class="cell" data-act="backlog"><span class="main"><span class="t">Nachholen & Wiederholen</span></span><span class="v">${openCount + weakCount}</span>${icon('right', 'chev')}</button>` : ''}
        <button class="cell accent" data-act="editTT"><span class="main"><span class="t">Fächer & Stundenplan bearbeiten</span></span></button>
      </div>
      </div><div class="detail">${subjectDetailInline(selId)}</div></div>`
    : `<div class="empty">${icon('book')}<h3>Noch keine Fächer</h3><p>Leg deinen Stundenplan an – deine Fächer erscheinen dann hier mit Fortschritt und Statistik.</p><button class="btn small primary" data-act="editTT">Stundenplan anlegen</button></div>`}
    </div>`;
}

function subjectParts(subjectId) {
  const I = idx();
  const sub = I.subById.get(subjectId);
  if (!sub) return null;
  const t = today();
  const st = S.subjectStats(I, sub.id, t, nowMin(), F());
  const exams = store.data.exams.filter((e) => e.subject_id === sub.id && (e.until_date || e.on_date) >= t).sort((a, b) => (a.on_date < b.on_date ? -1 : 1));
  const notes = store.data.occurrences.filter((o) => o.note && store.data.series.some((s) => s.id === o.series_id && s.subject_id === sub.id))
    .map((o) => S.makeOcc(I, store.data.series.find((s) => s.id === o.series_id), o.on_date)).sort((a, b) => (a.date > b.date ? -1 : 1));
  const series = store.data.series.filter((x) => x.subject_id === sub.id).sort((a, b) => ((a.once_on ? 10 : a.weekday) * 1e4 + S.toMin(a.starts_at)) - ((b.once_on ? 10 : b.weekday) * 1e4 + S.toMin(b.starts_at)));
  const ne = exams.find((e) => e.kind !== 'registration');
  const subline = [sub.code, ne ? `${S.EXAM_KINDS[ne.kind]?.label} ${relDays(S.diffDays(t, ne.on_date))}` : ''].filter(Boolean).map(esc).join(' · ');
  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.startMin - b.startMin);

  const body = `
      <div class="stats" style="margin-top:8px">
        <div class="stat"><div class="k">Bearbeitet</div><div class="val">${st.progress == null ? '–' : Math.round(st.progress) + '<small>%</small>'}</div></div>
        <div class="stat"><div class="k">Sicherheit</div><div class="val">${fmtStars(st.avgStars)}${st.avgStars != null ? '<small>/ 5</small>' : ''}</div></div>
        <div class="stat"><div class="k">Termine</div><div class="val">${st.due.length}<small>/ ${st.total}</small></div></div>
      </div>
      ${exams.length ? `<div class="gh">Prüfungen</div><div class="group">${exams.map((e) => examRow(e)).join('')}</div>` : ''}
      ${st.open.length ? `<div class="gh">Nachholen · ${st.open.length}<span class="num">${fmtHours(st.openMinutes)}</span></div><div class="group">${[...st.open].sort(byDate).map((o) => occRow(o, { showDate: true, kindTitle: true })).join('')}</div>` : ''}
      ${st.weak.length ? `<div class="gh">Wiederholen · ${st.weak.length}</div><div class="group">${S.sortForReview(st.weak).map((o) => occRow(o, { showDate: true, kindTitle: true })).join('')}</div><div class="gf">Erledigt, aber mit 1–2 Sternen bewertet.</div>` : ''}
      ${!st.open.length && !st.weak.length ? `<div class="gh"></div><div class="group"><div class="cell ic"><span class="sq ${st.due.length ? 'green' : 'gray'}">${icon(st.due.length ? 'check' : 'clock')}</span><span class="main"><span class="t">${st.due.length ? 'Alles erledigt' : 'Noch nichts fällig'}</span><span class="s">${st.due.length ? 'Nichts offen und nichts schwach bewertet.' : 'Sobald Termine dieses Fachs stattgefunden haben, siehst du hier, was offen ist.'}</span></span></div></div>` : ''}
      ${notes.length ? `<div class="gh">Notizen · ${notes.length}</div><div class="group">${notes.map((o) => `<button class="cell" data-act="occ" data-key="${esc(o.key)}"><span class="main"><span class="t">${esc(o.note)}</span><span class="s">${KIND(o.series.kind)} · ${fmtDate(o.date)}</span></span>${icon('right', 'chev')}</button>`).join('')}</div>` : ''}
      <div class="gh">Termine im Stundenplan</div>
      <div class="group">${series.map((x) => `<button class="cell" data-act="editSeries" data-id="${x.id}"><span class="main"><span class="t">${x.once_on ? fmtDate(x.once_on) : WD_LONG[x.weekday - 1]} · ${S.hhmm(x.starts_at)}–${S.hhmm(x.ends_at)}</span><span class="s">${[KIND(x.kind), x.room, x.group_label, x.mandatory ? 'Pflicht' : ''].filter(Boolean).map(esc).join(' · ')}</span></span>${icon('right', 'chev')}</button>`).join('')}
        <button class="cell accent" data-act="newSeries" data-subject="${sub.id}"><span class="main"><span class="t">Termin hinzufügen</span></span></button></div>
      <div class="group" style="margin-top:12px"><button class="cell accent" data-act="newExam" data-subject="${sub.id}"><span class="main"><span class="t">Prüfung hinzufügen</span></span></button></div>
`;
  return { sub, subline, body };
}

export function renderSubjectPage(el, subjectId) {
  const p = subjectParts(subjectId);
  if (!p) { el.innerHTML = `${navBar({ left: backBtn('Fächer') })}<div class="empty"><h3>Fach nicht gefunden</h3></div>`; return; }
  el.innerHTML = `
    ${navBar({ title: p.sub.name, left: backBtn('Fächer'), right: `<button class="nav-btn" data-act="editSubject" data-id="${p.sub.id}">Bearbeiten</button>` })}
    <div data-c="${p.sub.color}">${largeTitle(p.sub.name, p.subline)}</div>
    <div class="wrap">${p.body}</div>`;
}

/** Fach-Details direkt neben der Liste (iPad / breite Bildschirme). */
function subjectDetailInline(subjectId) {
  const p = subjectParts(subjectId);
  if (!p) return `<div class="detail-empty muted">Wähle links ein Fach.</div>`;
  return `<div class="lt-row" style="padding-top:10px"><h2 style="margin:0;font-size:1.6rem;font-weight:700;flex:1;min-width:0" data-c="${p.sub.color}">${esc(p.sub.name)}</h2><button class="nav-btn" data-act="editSubject" data-id="${p.sub.id}">Bearbeiten</button></div>
    ${p.subline ? `<p class="lt-sub" style="margin:0 0 4px">${p.subline}</p>` : ''}${p.body}`;
}

// ======================= NACHHOLEN =======================
export function renderBacklog(el) {
  const { open, weak } = openItems();
  const groups = new Map();
  for (const o of open) { const k = o.subject.id; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(o); }
  const mins = open.reduce((a, o) => a + (o.duration * (100 - o.progress)) / 100, 0);
  el.innerHTML = `
    ${navBar({ title: 'Nachholen', left: backBtn() })}
    ${largeTitle('Nachholen', open.length ? `${open.length} offen · etwa ${fmtHours(mins)}` : '')}
    <div class="wrap">
      ${open.length ? [...groups.values()].map((list) => `<div class="gh">${esc(list[0].subject.name)}<span class="num">${list.length}</span></div><div class="group">${list.map((o) => occRow(o, { showDate: true, kindTitle: true })).join('')}</div>`).join('')
        : `<div class="empty">${icon('checkCircle')}<h3>Alles nachgeholt</h3><p>Kein Termin ist mehr offen. Stark!</p></div>`}
      ${weak.length ? `<div class="gh">Wiederholen</div><div class="group">${S.sortForReview(weak).map((o) => occRow(o, { showDate: true })).join('')}</div><div class="gf">Erledigt, aber mit 1–2 Sternen bewertet – vor der Prüfung nochmal anschauen.</div>` : ''}
    </div>`;
}

// ======================= PRÜFUNGEN =======================
export function renderExams(el) {
  const t = today(), I = idx();
  const all = [...store.data.exams].sort((a, b) => (a.on_date < b.on_date ? -1 : a.on_date > b.on_date ? 1 : S.toMin(a.starts_at) - S.toMin(b.starts_at)));
  const upcoming = all.filter((e) => (e.until_date || e.on_date) >= t);
  const past = all.filter((e) => (e.until_date || e.on_date) < t).reverse();
  const ne = nextExam();
  const running = upcoming.filter((e) => (e.kind === 'registration' || e.kind === 'submission') && e.on_date <= t);
  const rest = upcoming.filter((e) => e !== ne && !running.includes(e) && e.kind !== 'period');
  const periods = upcoming.filter((e) => e.kind === 'period');
  let hero = '';
  if (ne) {
    const d = S.diffDays(t, ne.on_date);
    const sub = I.subById.get(ne.subject_id);
    const st = sub ? S.subjectStats(I, sub.id, t, nowMin(), F()) : null;
    hero = `<div class="group exam-hero" ${sub ? `data-c="${sub.color}"` : ''} style="margin-top:8px"><button class="cell" data-act="exam" data-id="${ne.id}" ${sub ? `data-c="${sub.color}"` : ''} style="padding:16px;align-items:center">
      <span class="main"><span class="s" style="margin:0 0 2px">Nächste Prüfung</span><span class="t" style="font-size:1.3rem;font-weight:700;line-height:1.2">${esc(ne.title)}</span>
      <span class="s">${S.EXAM_KINDS[ne.kind]?.label} · ${fmtDate(ne.on_date)}${ne.starts_at ? ' · ' + S.hhmm(ne.starts_at) : ''}${ne.room ? ' · ' + esc(ne.room) : ''}</span>
      ${st ? `<span class="s" style="margin-top:6px">${st.open.length ? `<span class="chip amber">${st.open.length} offen</span>` : '<span class="chip green">nichts offen</span>'} ${st.avgStars != null ? `<span class="chip">★ ${fmtStars(st.avgStars)}</span>` : ''}</span>` : ''}</span>
      <span class="cd"><span class="cd-num">${d === 0 ? '!' : d}</span><span class="s">${d === 0 ? 'heute' : d === 1 ? 'Tag' : 'Tage'}</span></span>
    </button></div>`;
  }
  // Pflichttermine aus dem Stundenplan (Anwesenheitspflicht) – die nächsten direkt hier, alle auf der eigenen Seite
  const pflicht = pflichtItems().filter((x) => x.type === 'occ');
  const pflichtNext = pflicht.slice(0, 4);
  el.innerHTML = `
    ${navBar({ title: 'Prüfungen', right: settingsBtn() })}
    ${largeTitle('Prüfungen')}
    <div class="wrap">
      ${hero}
      ${!ne ? `<div class="empty" style="padding-bottom:12px">${icon('cap')}<h3>Noch keine Klausur eingetragen</h3><p>Trag deine Prüfungstermine ein – dann siehst du den Countdown und wirst erinnert.</p><button class="btn small primary" data-act="newExam">Prüfung hinzufügen</button></div>` : ''}
      <div class="split"><div class="primary">
      ${running.length ? `<div class="gh">Läuft gerade</div><div class="group">${running.map((e) => examRow(e)).join('')}</div>` : ''}
      ${rest.length ? `<div class="gh">Anstehend</div><div class="group">${rest.map((e) => examRow(e)).join('')}</div>` : ''}
      ${pflichtNext.length ? `<div class="gh">Pflichttermine${pflicht.length > pflichtNext.length ? `<button class="link" data-act="pflicht">Alle ${pflicht.length}</button>` : ''}</div><div class="group">${pflichtNext.map(pflichtRow).join('')}</div>` : ''}
      ${ne ? `<div class="group" style="margin-top:16px"><button class="cell accent" data-act="newExam"><span class="main"><span class="t">Prüfung oder Frist hinzufügen</span></span></button></div>` : ''}
      </div><aside class="side">
      ${periods.length ? `<div class="gh">Zeiträume</div><div class="group">${periods.map((e) => examRow(e)).join('')}</div>` : ''}
      ${past.length ? `<div class="gh">Vorbei<button class="link" data-act="togglePast">${ui.showPast ? 'Ausblenden' : 'Anzeigen'}</button></div>${ui.showPast ? `<div class="group">${past.map((e) => examRow(e)).join('')}</div>` : ''}` : ''}
      </aside></div>
    </div>`;
}
