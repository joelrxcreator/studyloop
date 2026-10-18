// Überblicke: „Demnächst Pflicht“ (alles, was man nicht verpassen darf) und die Semesterübersicht (alle Wochen auf einen Blick).
import * as S from './schedule.js';
import { store, idx } from './store.js';
import { icon } from './icons.js';
import { esc, fmtDate, fmtRange, relDays, WD, navBar, largeTitle, backBtn, seg, bindSegs, sheet, haptic } from './ui.js';
import { ui, today, nowMin, currentSemester } from './ctx.js';

// ======================= DEMNÄCHST PFLICHT =======================
const DEADLINE = (e) => e.kind === 'registration' || e.kind === 'submission' || !!(e.until_date && e.until_date !== e.on_date);

/** Alles Anstehende, was Pflicht ist: Pflichttermine aus dem Stundenplan + Prüfungen & Fristen. */
export function pflichtItems() {
  const t = today(), nm = nowMin(), I = idx();
  const sem = currentSemester();
  let end = S.addDays(t, 90);
  if (sem && sem.ends_on > end) end = sem.ends_on;
  if (S.diffDays(t, end) > 240) end = S.addDays(t, 240);
  const out = [];
  for (let d = t; d <= end; d = S.addDays(d, 1)) {
    for (const o of S.occurrencesOn(I, d)) {
      if (!o.mandatory || o.cancelled) continue;
      if (d === t && o.endMin <= nm) continue;
      out.push({ type: 'occ', date: d, min: o.startMin, o });
    }
  }
  for (const e of store.data.exams) {
    if (e.kind === 'period') continue;
    const dl = DEADLINE(e);
    const date = dl ? e.until_date || e.on_date : e.on_date;
    if (date < t) continue;
    const endMin = e.ends_at ? S.toMin(e.ends_at) : dl ? 24 * 60 : (e.starts_at ? S.toMin(e.starts_at) + 120 : 24 * 60);
    if (date === t && endMin <= nm) continue;
    out.push({ type: 'exam', date, min: e.starts_at && !dl ? S.toMin(e.starts_at) : dl ? endMin - 1 : 0, e, deadline: dl });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.min - b.min));
}

const relShort = (n) => (n <= 1 ? relDays(n) : n < 7 ? `in ${n} T.` : n < 14 ? 'in 1 Wo.' : `in ${Math.round(n / 7)} Wo.`);

export function pflichtRow(it) {
  const t = today();
  const n = S.diffDays(t, it.date);
  const wd = WD[S.weekday(it.date) - 1];
  const date = `<span class="pf-date${n === 0 ? ' today' : ''}"><span class="wd">${wd}</span><span class="dn">${Number(it.date.slice(8))}</span></span>`;
  if (it.type === 'occ') {
    const o = it.o;
    const kind = S.KINDS[o.series.kind]?.label || 'Termin';
    return `<button class="cell pf-row" data-act="occ" data-key="${esc(o.key)}" data-c="${o.subject.color}">${date}
      <span class="main"><span class="t">${esc(o.subject.name)}</span><span class="s"><span class="pf-tag">${esc(kind)}</span> ${o.starts}–${o.ends}${o.room ? ' · ' + esc(o.room) : ''}</span></span>
      <span class="v pf-rel${n <= 1 ? ' soon' : ''}">${relShort(n)}</span></button>`;
  }
  const e = it.e;
  const sub = idx().subById.get(e.subject_id);
  const label = it.deadline ? (e.kind === 'registration' ? 'Anmeldefrist' : e.kind === 'submission' ? 'Abgabe' : 'Frist') : S.EXAM_KINDS[e.kind]?.label || 'Prüfung';
  const timeTxt = it.deadline ? (e.ends_at ? `bis ${S.hhmm(e.ends_at)}` : 'letzter Tag') : e.starts_at ? S.hhmm(e.starts_at) + (e.ends_at ? '–' + S.hhmm(e.ends_at) : '') : '';
  return `<button class="cell pf-row" data-act="exam" data-id="${e.id}" ${sub ? `data-c="${sub.color}"` : ''}>${date}
    <span class="main"><span class="t">${esc(e.title || sub?.name || label)}</span><span class="s"><span class="pf-tag ${it.deadline ? 'dl' : 'ex'}">${esc(label)}</span>${timeTxt ? ' ' + timeTxt : ''}${e.room ? ' · ' + esc(e.room) : ''}</span></span>
    <span class="v pf-rel${n <= 1 ? ' soon' : ''}">${relShort(n)}</span></button>`;
}

function weekHead(mon) {
  const tm = S.mondayOf(today());
  if (mon === tm) return 'Diese Woche';
  if (mon === S.addDays(tm, 7)) return 'Nächste Woche';
  return `KW ${S.isoWeek(mon)} · ${fmtRange(mon, S.addDays(mon, 6))}`;
}

/** Karte für „Heute“: die nächsten Pflicht-Sachen. */
export function pflichtCard() {
  const all = pflichtItems();
  if (!all.length) return '';
  const t = today();
  let next = all.filter((x) => S.diffDays(t, x.date) <= 14).slice(0, 3);
  if (!next.length) next = all.slice(0, 1);
  return `<div class="gh">Demnächst Pflicht<button class="link" data-act="pflicht">Alle ${all.length}</button></div>
    <div class="group">${next.map(pflichtRow).join('')}</div>`;
}

export function renderPflicht(el) {
  const all = pflichtItems();
  const filter = ui.pfFilter || 'all';
  const list = all.filter((x) => filter === 'all' || (filter === 'occ' ? x.type === 'occ' : x.type === 'exam'));
  const groups = new Map();
  for (const it of list) {
    const mon = S.mondayOf(it.date);
    if (!groups.has(mon)) groups.set(mon, []);
    groups.get(mon).push(it);
  }
  const nOcc = all.filter((x) => x.type === 'occ').length, nEx = all.length - nOcc;
  el.innerHTML = `
    ${navBar({ title: 'Demnächst Pflicht', left: backBtn() })}
    ${largeTitle('Demnächst Pflicht', all.length ? `${nOcc} ${nOcc === 1 ? 'Pflichttermin' : 'Pflichttermine'} · ${nEx} ${nEx === 1 ? 'Prüfung/Frist' : 'Prüfungen & Fristen'}` : '')}
    <div class="wrap">
      ${all.length ? `<div style="margin:6px 0 4px">${seg('pf', [['all', 'Alles'], ['occ', 'Pflichttermine'], ['exam', 'Prüfungen']], filter).replace('class="seg"', 'class="seg" style="width:100%"')}</div>` : ''}
      ${list.length ? [...groups].map(([mon, items]) => `<div class="gh">${weekHead(mon)}<span class="num">${items.length}</span></div><div class="group">${items.map(pflichtRow).join('')}</div>`).join('')
        : `<div class="empty" style="padding-top:48px">${icon('alert')}<h3>${all.length ? 'Nichts in dieser Auswahl' : 'Nichts Pflicht in Sicht'}</h3><p>Pflichttermine markierst du im Termin („Pflichttermin“) oder für eine ganze Reihe im Stundenplan. Prüfungen und Fristen trägst du unter „Prüfungen“ ein.</p></div>`}
      ${list.length ? '<div class="gf">Pflichttermine aus deinem Stundenplan und alle anstehenden Prüfungen, Abgaben und Fristen – bis Semesterende.</div>' : ''}
    </div>`;
  bindSegs(el, (name, v) => { if (name === 'pf') { ui.pfFilter = v; renderPflicht(el); } });
}

// ======================= SEMESTERÜBERSICHT =======================
const KIND_INFO = {
  lecture: { label: 'Vorlesungen', c: 'lecture' },
  project: { label: 'Projektwoche', c: 'project' },
  free: { label: 'Vorlesungsfrei', c: 'free' },
  exams: { label: 'Prüfungszeit', c: 'exams' },
};

/** Alle Wochen eines Semesters mit Art, Prüfungen, Pflicht und Offenem. */
export function semesterWeeks(sem) {
  const I = idx(), t = today(), nm = nowMin();
  const from = store.settings.trackFrom;
  const weeks = [];
  let lectureNo = 0;
  for (let mon = S.mondayOf(sem.starts_on); mon <= sem.ends_on; mon = S.addDays(mon, 7)) {
    const sun = S.addDays(mon, 6);
    const ref = mon < sem.starts_on ? sem.starts_on : mon;
    const wi = S.weekInfo(sem, ref);
    const kind = wi?.kind || 'lecture';
    if (kind === 'lecture') lectureNo++;
    const occ = S.occurrencesBetween(I, mon, sun).filter((o) => !o.cancelled);
    const exams = store.data.exams.filter((e) => e.kind !== 'period' && (DEADLINE(e) ? (e.until_date || e.on_date) : e.on_date) >= mon && (DEADLINE(e) ? (e.until_date || e.on_date) : e.on_date) <= sun);
    const holidays = (sem.holidays || []).filter((h) => h.from <= sun && (h.to || h.from) >= mon);
    const due = occ.filter((o) => S.isDue(o, t, nm, from));
    weeks.push({
      mon, sun, kind, parity: wi?.parity || null, lectureNo: kind === 'lecture' ? lectureNo : null,
      count: occ.length, mandatory: occ.filter((o) => o.mandatory).length,
      exams: exams.filter((e) => !DEADLINE(e)).length, deadlines: exams.filter(DEADLINE).length,
      holidays, open: due.filter(S.isOpen).length, dueCount: due.length,
      cur: mon === S.mondayOf(t), past: sun < t,
    });
  }
  return weeks;
}

function tile(w, sem, showParity) {
  const k = KIND_INFO[w.kind];
  const sub = w.kind === 'lecture'
    ? `${w.lectureNo}. Vorlesungs&shy;woche${showParity && w.parity ? ' · ' + esc(S.parityLabel(sem, w.parity)) : ''}`
    : k.label;
  const marks = [
    w.exams ? `<span class="mk ex" title="Prüfungen">${icon('cap')}${w.exams}</span>` : '',
    w.deadlines ? `<span class="mk dl" title="Fristen">${icon('hourglass')}${w.deadlines}</span>` : '',
    w.mandatory ? `<span class="mk pf" title="Pflichttermine">!${w.mandatory > 1 ? w.mandatory : ''}</span>` : '',
  ].join('');
  const prog = w.past || w.cur ? (w.dueCount ? Math.round(((w.dueCount - w.open) / w.dueCount) * 100) : null) : null;
  const label = `KW ${S.isoWeek(w.mon)}, ${fmtRange(w.mon, w.sun)}, ${sub.replace("&shy;", "")}${w.exams ? `, ${w.exams} Prüfung` : ''}${w.mandatory ? `, ${w.mandatory} Pflicht` : ''}${w.open ? `, ${w.open} offen` : ''}`;
  return `<button class="sm-tile k-${k.c}${w.cur ? ' cur' : ''}${w.past ? ' past' : ''}${w.mon === ui.weekMon ? ' sel' : ''}" data-wk="${w.mon}" aria-label="${esc(label)}">
    <span class="sm-top"><span class="kw">KW ${S.isoWeek(w.mon)}</span>${w.cur ? '<span class="now">Jetzt</span>' : ''}</span>
    <span class="dr">${fmtRange(w.mon, w.sun)}</span>
    ${marks ? `<span class="marks">${marks}</span>` : ''}
    <span class="kind">${sub}</span>
    ${w.holidays.length ? `<span class="hol">${esc(w.holidays.map((h) => h.name).join(', '))}</span>` : ''}
    ${prog != null ? `<span class="bar" title="${prog} % erledigt"><i style="width:${prog}%"></i></span>` : ''}
  </button>`;
}

/** Semesterübersicht als Fenster; Antippen einer Woche springt dorthin. */
export function openSemesterMap(onPick) {
  const sem = S.semesterFor(store.data.semesters, ui.weekMon) || S.semesterFor(store.data.semesters, S.addDays(ui.weekMon, 4)) || currentSemester();
  sheet({
    title: sem ? sem.name : 'Semester',
    full: true,
    render(body, api) {
      if (!sem) {
        body.innerHTML = `<div class="empty">${icon('cal')}<h3>Kein Semester</h3><p>Lege zuerst ein Semester an.</p></div>`;
        return;
      }
      const weeks = semesterWeeks(sem);
      // Helle/Dunkle Woche nur zeigen, wenn im Stundenplan etwas davon abhängt
      const subIds = new Set(store.data.subjects.filter((x) => x.semester_id === sem.id).map((x) => x.id));
      const showParity = store.data.series.some((sr) => subIds.has(sr.subject_id) && (sr.weeks_rule === 'A' || sr.weeks_rule === 'B'));
      const t = today();
      const total = Math.max(1, S.diffDays(sem.starts_on, sem.ends_on) + 1);
      const done = Math.min(total, Math.max(0, S.diffDays(sem.starts_on, t) + 1));
      const pct = Math.round((done / total) * 100);
      const curIdx = weeks.findIndex((w) => w.cur);
      const lectures = weeks.filter((w) => w.kind === 'lecture').length;
      const counts = Object.keys(KIND_INFO).map((k) => [k, weeks.filter((w) => w.kind === k).length]).filter(([, n]) => n);
      const examsTotal = weeks.reduce((a, w) => a + w.exams, 0);
      const curLecture = weeks.slice(0, curIdx + 1).filter((w) => w.kind === 'lecture').length;
      body.innerHTML = `
        <div class="sm-head">
          <div class="sm-prog">
            <div class="sm-prog-t"><b>${t < sem.starts_on ? 'Startet ' + fmtDate(sem.starts_on) : t > sem.ends_on ? 'Semester vorbei' : curIdx >= 0 ? `Woche ${curIdx + 1} von ${weeks.length}` : ''}</b><span>${t >= sem.starts_on && t <= sem.ends_on ? `${pct} %` : ''}</span></div>
            <div class="bar big"><i style="width:${t < sem.starts_on ? 0 : pct}%"></i></div>
            <div class="sm-prog-s">${fmtDate(sem.starts_on, { weekday: false })} – ${fmtDate(sem.ends_on, { weekday: false, year: true })}${curIdx >= 0 && weeks[curIdx].kind === 'lecture' ? ` · ${curLecture}. von ${lectures} Vorlesungswochen` : ''}</div>
          </div>
          <div class="sm-legend">${counts.map(([k, n]) => `<span class="k-${KIND_INFO[k].c}"><i></i>${n} × ${KIND_INFO[k].label}</span>`).join('')}${examsTotal ? `<span class="lg-ex">${icon('cap')}${examsTotal} ${examsTotal === 1 ? 'Prüfung' : 'Prüfungen'}</span>` : ''}</div>
        </div>
        <div class="sm-grid">${weeks.map((w) => tile(w, sem, showParity)).join('')}</div>
        <p class="gf" style="margin:14px 4px 6px">Tippe auf eine Woche, um sie im Stundenplan zu öffnen. Wochenarten und Feiertage änderst du unter Einstellungen → Semester.</p>`;
      body.querySelectorAll('[data-wk]').forEach((b) => b.addEventListener('click', () => { haptic(); api.close(); onPick(b.dataset.wk); }));
      const cur = body.querySelector('.sm-tile.sel') || body.querySelector('.sm-tile.cur');
      requestAnimationFrame(() => cur?.scrollIntoView({ block: 'center' }));
    },
  });
}
