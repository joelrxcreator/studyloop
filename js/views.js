// Hauptansichten: Heute, Woche, Fächer (Cockpit), Fach-Detail, Prüfungen, Stundenplan (Vollbild).
import * as S from './schedule.js';
import { store, idx } from './store.js';
import { icon } from './icons.js';
import { esc, fmtDate, fmtDayTitle, fmtRange, fmtHours, relDays, fmtStars, miniStars, ring, WD } from './ui.js';
import { ui, today, nowMin, currentSemester, subjectsOf } from './ctx.js';

const KIND = (k) => S.KINDS[k]?.label || 'Termin';
const F = () => store.settings.trackFrom;
/** Prüfungen/Fristen, die an diesem Tag als Termin zählen (Zeiträume nur am letzten Tag). */
const markedExams = (d) => S.examsOn(store.data, d).filter((e) => (e.kind === 'exam' || e.kind === 'oral' || e.kind === 'submission' || e.kind === 'other') ? e.on_date === d : e.kind !== 'period' && (e.until_date || e.on_date) === d);

function weekLabel(date) {
  const sem = S.semesterFor(store.data.semesters, date);
  const wi = S.weekInfo(sem, date);
  const kw = `KW ${S.isoWeek(date)}`;
  if (!wi) return kw;
  if (wi.kind === 'lecture') return wi.parity ? `${kw} · ${S.parityLabel(sem, wi.parity)}` : kw;
  return `${kw} · ${S.WEEK_KINDS[wi.kind]}`;
}

function pauseText(min) {
  if (min < 60) return `Pause ${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return `Pause ${h} Std.${m ? ' ' + m + ' min' : ''}`;
}

export function occCard(o) {
  const c = o.subject?.color || 'slate';
  const metaKind = [KIND(o.series.kind), o.series.lecturer].filter(Boolean).join(' · ');
  const flags = [
    o.mandatory && !o.cancelled ? `<span class="flag red" title="Pflicht">${icon('bell')}</span>` : '',
    o.overlaps && !o.cancelled ? `<span class="flag" title="Überschneidung">${icon('layers')}</span>` : '',
  ].join('');
  return `
  <button class="occ ${o.progress >= 100 ? 'done' : ''} ${o.cancelled ? 'cancelled' : ''}" data-c="${c}" data-act="occ" data-key="${esc(o.key)}">
    <div class="times"><span>${o.starts}</span><span>${o.ends}</span></div>
    <div class="vr"></div>
    <div class="body">
      <div class="h"><div class="name">${esc(o.subject?.name)}</div>${flags ? `<div class="flags">${flags}</div>` : ''}</div>
      <div class="meta"><span>${esc(metaKind)}</span>${o.room ? `<span>${icon('pin', 'sm')}${esc(o.room)}</span>` : ''}${o.series.group_label ? `<span>${esc(o.series.group_label)}</span>` : ''}${o.moved ? '<span>verlegt</span>' : ''}</div>
      ${o.cancelled ? '<div class="meta"><span>Fällt aus</span></div>' : ''}
      ${o.note ? `<div class="note-line">${icon('note', 'sm')}<span>${esc(o.note)}</span></div>` : ''}
      ${o.cancelled ? '' : `<div class="foot"><div class="bar"><i style="--p:${o.progress}%"></i></div><span class="pct">${o.progress} %</span>${miniStars(o.stars)}</div>`}
    </div>
  </button>`;
}

function examCard(e, date, extra = '') {
  const sub = idx().subById.get(e.subject_id);
  const label = S.EXAM_KINDS[e.kind]?.label || 'Termin';
  const cls = e.kind === 'period' ? 'info' : (e.kind === 'registration' || e.kind === 'submission' || e.kind === 'other') ? 'soft' : '';
  let sub2 = [e.starts_at ? `${S.hhmm(e.starts_at)}${e.ends_at ? '–' + S.hhmm(e.ends_at) : ''}` : '', e.room, sub && e.title !== sub.name ? sub.name : ''].filter(Boolean).join(' · ');
  if (e.until_date && e.until_date !== e.on_date) {
    const left = S.diffDays(date, e.until_date);
    sub2 = `${fmtRange(e.on_date, e.until_date)} · ${left === 0 ? 'letzter Tag' : `noch ${left + 1} Tage`}`;
  }
  const ic = e.kind === 'period' ? 'cal' : (e.kind === 'registration' || e.kind === 'submission') ? 'hourglass' : 'cap';
  return `<button class="exam-card ${cls}" data-act="exam" data-id="${e.id}">
    <span class="ibox ${cls === 'info' ? '' : cls === 'soft' ? 'amber' : 'red'}">${icon(ic)}</span>
    <span class="main" style="min-width:0;flex:1"><span class="t" style="display:block">${esc(label)}: ${esc(e.title)}</span><span class="s" style="display:block">${esc(sub2)}</span></span>${extra}
  </button>`;
}

export function dayList(list) {
  let h = '';
  let prevEnd = null;
  for (const o of list) {
    if (prevEnd != null && !o.cancelled) {
      const gap = o.startMin - prevEnd;
      if (gap > 0) h += `<div class="pause"><span>${pauseText(gap)}</span></div>`;
      else if (gap < 0) h += `<div class="pause"><span style="color:var(--warn)">Überschneidung</span></div>`;
      else h += '<div class="gap-s"></div>';
    } else if (prevEnd != null) h += '<div class="gap-s"></div>';
    h += occCard(o);
    if (!o.cancelled) prevEnd = Math.max(prevEnd ?? 0, o.endMin);
  }
  return `<div class="day-list">${h}</div>`;
}

function nextClass(from) {
  for (let i = 1; i <= 60; i++) {
    const d = S.addDays(from, i);
    const l = S.occurrencesOn(idx(), d).filter((o) => !o.cancelled);
    if (l.length) return l[0];
  }
  return null;
}

function nextExam(from = today()) {
  return store.data.exams
    .filter((e) => (e.kind === 'exam' || e.kind === 'oral' || e.kind === 'submission') && e.on_date >= from)
    .sort((a, b) => (a.on_date < b.on_date ? -1 : a.on_date > b.on_date ? 1 : S.toMin(a.starts_at) - S.toMin(b.starts_at)))[0] || null;
}

// ======================= HEUTE / TAG =======================
export function renderDay(el) {
  const date = ui.day, t = today();
  const I = idx();
  const sem = S.semesterFor(store.data.semesters, date);
  const wi = S.weekInfo(sem, date);
  const list = S.occurrencesOn(I, date);
  const exams = S.examsOn(store.data, date);
  const mon = S.mondayOf(date);

  // Wochenleiste
  let strip = '';
  for (let i = 0; i < 7; i++) {
    const d = S.addDays(mon, i);
    const l = S.occurrencesOn(I, d).filter((o) => !o.cancelled);
    const ex = markedExams(d);
    const dots = l.slice(0, 4).map((o) => `<i class="${o.mandatory ? 'red' : ''}"></i>`).join('') + (ex.length ? '<i class="red"></i>' : '');
    strip += `<button data-act="day" data-d="${d}" class="${d === t ? 'today' : ''} ${d === date ? 'sel' : ''}" aria-label="${fmtDayTitle(d)}">
      <span class="wd">${WD[i]}</span><span class="dn">${Number(d.slice(8))}</span><span class="dots">${dots}</span></button>`;
  }

  // Kennzahlen
  const curSem = currentSemester();
  const bl = curSem ? S.backlog(I, curSem.id, t, nowMin(), F()) : { count: 0, minutes: 0 };
  const st = S.streak(I, store.activity, t);
  const ne = nextExam();
  const tiles = `
    <div class="tiles" style="--n:3;margin-top:var(--s4)">
      <button class="tile" data-act="tab" data-tab="week"><div class="k">${icon('flame', 'sm')}Serie</div><div class="v">${st}<small> ${st === 1 ? 'Tag' : 'Tage'}</small></div></button>
      <button class="tile" data-act="tab" data-tab="subjects"><div class="k">${icon('repeat', 'sm')}Offen</div><div class="v">${bl.count}<small> · ${Math.round(bl.minutes / 60)} Std.</small></div></button>
      <button class="tile" data-act="tab" data-tab="exams"><div class="k">${icon('cap', 'sm')}Prüfung</div><div class="v">${ne ? S.diffDays(t, ne.on_date) + '<small> T.</small>' : '–'}</div></button>
    </div>`;

  // Hinweise zum Tag
  let banner = '';
  const hol = S.holidayOn(sem, date);
  if (hol) banner = `<div class="banner accent">${icon('info')}<span><b>${esc(hol.name)}</b> – keine Veranstaltungen.</span></div>`;
  else if (!sem) banner = `<div class="banner">${icon('info')}<span>Dieser Tag liegt außerhalb deines Semesters.</span></div>`;
  else if (wi && wi.kind !== 'lecture') {
    const txt = { project: 'Projektwoche – keine regulären Vorlesungen.', free: 'Vorlesungsfreie Zeit.', exams: 'Prüfungszeit – viel Erfolg!' }[wi.kind];
    banner = `<div class="banner ${wi.kind === 'exams' ? 'red' : 'accent'}">${icon(wi.kind === 'exams' ? 'cap' : 'info')}<span>${txt}</span></div>`;
  }

  let content = '';
  if (list.length) content = dayList(list);
  else {
    const nc = nextClass(date);
    content = `<div class="empty"><div class="art">${icon('today', 'lg')}</div><h3>${date === t ? 'Heute' : 'An diesem Tag'} keine Termine</h3>
      <p>${nc ? `Nächster Termin: ${fmtDate(nc.date)} um ${nc.starts} – ${esc(nc.subject.name)}` : 'Lege deinen Stundenplan an, dann erscheinen hier deine Termine.'}</p>
      ${nc ? `<button class="btn small" data-act="day" data-d="${nc.date}">Zum nächsten Termin</button>` : '<button class="btn small primary" data-act="editTT">Stundenplan anlegen</button>'}</div>`;
  }

  el.innerHTML = `<div class="wrap">
    <div class="topbar">
      <div style="flex:1;min-width:0"><div class="eyebrow">${weekLabel(date)}</div><h1 class="title-xl">${date === t ? 'Heute' : fmtDayTitle(date).split(',')[0]}</h1>
      <div class="sub">${date === t ? fmtDayTitle(date) : fmtDate(date, { weekday: false, year: date.slice(0, 4) !== t.slice(0, 4) }) + ' · ' + relDays(S.diffDays(t, date))}</div></div>
      ${date !== t ? `<button class="btn small" data-act="day" data-d="${t}">Heute</button>` : ''}
      <button class="icon-btn" data-act="settings" aria-label="Einstellungen">${icon('gear')}</button>
    </div>
    <div class="strip" data-swipe="week">${strip}</div>
    ${date === t ? tiles : ''}
    <div style="display:grid;gap:var(--s2);margin-top:var(--s4)">${banner}${exams.map((e) => examCard(e, date)).join('')}</div>
    <div style="margin-top:var(--s3)" data-swipe="day">${content}</div>
  </div>`;
}

// ======================= WOCHE =======================
export function renderWeek(el) {
  const mon = ui.weekMon, sun = S.addDays(mon, 6), t = today(), nm = nowMin();
  const I = idx();
  const load = S.weekLoad(I, mon, t, nm, F());
  const showWeekend = load[5].minutes + load[6].minutes > 0;
  const days = showWeekend ? load : load.slice(0, 5);
  const max = Math.max(360, ...days.map((d) => d.minutes));
  const total = days.reduce((a, d) => a + d.minutes, 0);
  const openMin = days.reduce((a, d) => a + d.open, 0);
  const bars = days.map((d, i) => {
    const h = (d.minutes / max) * 100;
    const doneH = d.minutes ? (d.done / d.minutes) * 100 : 0;
    const openH = d.minutes ? (d.open / d.minutes) * 100 : 0;
    return `<div class="col ${d.date === t ? 'today' : ''}" title="${fmtHours(d.minutes)}">
      ${d.exams ? '<span class="ex"></span>' : ''}
      <div class="stack" style="height:${Math.max(4, h)}%"><i style="height:${doneH}%"></i><b style="bottom:${doneH}%;height:${openH}%"></b></div>
      <span class="lbl">${WD[i]}</span></div>`;
  }).join('');

  const all = S.occurrencesBetween(I, mon, sun).filter((o) => !o.cancelled);
  const due = all.filter((o) => S.isDue(o, t, nm, F()));
  const open = due.filter(S.isOpen);
  const weak = due.filter((o) => !S.isOpen(o) && S.isWeak(o));
  const done = due.filter((o) => !S.isOpen(o) && !S.isWeak(o));
  const upcoming = all.filter((o) => !S.isDue(o, t, nm, F()) && (o.date > t || (o.date === t && o.startMin > nm)));
  const before = all.filter((o) => !S.isDue(o, t, nm, F()) && !upcoming.includes(o));
  const exams = store.data.exams.filter((e) => e.kind !== 'period' && ((e.on_date >= mon && e.on_date <= sun) || (e.until_date && e.on_date <= sun && e.until_date >= mon)));

  const curSem = currentSemester();
  const bl = curSem ? S.backlog(I, curSem.id, t, nm, F()) : null;
  let blBanner = '';
  if (bl && mon <= t) {
    const h = bl.minutes / 60;
    const [cls, txt] = h < 3 ? ['', 'Alles im Rahmen'] : h < 8 ? ['amber', 'Es staut sich etwas'] : ['red', 'Viel offen – plane Zeit zum Nachholen ein'];
    blBanner = `<button class="banner ${cls}" data-act="tab" data-tab="subjects" style="width:100%;text-align:left;margin-top:var(--s3)">${icon(cls ? 'alert' : 'check')}<span style="flex:1"><b>${txt}</b><br><span class="sub">Rückstand im Semester: ${bl.count} ${bl.count === 1 ? 'Termin' : 'Termine'} · ${fmtHours(bl.minutes)}</span></span>${icon('right', 'sm')}</button>`;
  }

  const row = (o) => `<button class="row" data-act="occ" data-key="${esc(o.key)}">
      <span class="cbar" data-c="${o.subject.color}"></span>
      <span class="main"><span class="t" style="display:block">${esc(o.subject.name)} · ${KIND(o.series.kind)}</span>
      <span class="s" style="display:block">${fmtDate(o.date)} · ${o.starts}–${o.ends}${o.mandatory ? ' · Pflicht' : ''}</span></span>
      <span class="end">${o.stars != null ? miniStars(o.stars) : ''}${ring(o.progress, o.subject.color)}</span></button>`;
  const section = (title, list, extra = '') => list.length ? `<div class="section-h"><h2>${title}</h2>${extra}</div><div class="list">${list.map(row).join('')}</div>` : '';

  el.innerHTML = `<div class="wrap">
    <div class="topbar">
      <div style="flex:1;min-width:0"><div class="eyebrow">${weekLabel(mon)}</div><h1 class="title-xl">${fmtRange(mon, sun)}</h1></div>
      <button class="icon-btn" data-act="wk" data-d="-7" aria-label="Vorherige Woche">${icon('left')}</button>
      <button class="icon-btn" data-act="wk" data-d="7" aria-label="Nächste Woche">${icon('right')}</button>
    </div>
    ${mon !== S.mondayOf(t) ? `<div style="margin-top:var(--s2)"><button class="btn small" data-act="wk" data-d="0">Zur aktuellen Woche</button></div>` : ''}
    <div class="card pad" style="margin-top:var(--s4)" data-swipe="wk">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><b>Auslastung</b><span class="sub num">${fmtHours(total)} Termine${openMin > 0 ? ' · ' + fmtHours(openMin) + ' offen' : ''}</span></div>
      <div class="load" style="--n:${days.length}">${bars}</div>
      <div class="legend"><span><i style="background:var(--accent)"></i>bearbeitet</span><span><i style="background:color-mix(in srgb, var(--warn) 75%, transparent)"></i>offen</span><span><i style="background:var(--surface-3)"></i>kommt noch</span></div>
    </div>
    ${blBanner}
    ${exams.length ? `<div class="section-h"><h2>Prüfungen & Fristen</h2></div><div style="display:grid;gap:var(--s2)">${exams.map((e) => examCard(e, e.on_date > t ? e.on_date : t)).join('')}</div>` : ''}
    ${section('Nachholen', S.sortForReview(open).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.startMin - b.startMin)))}
    ${section('Wiederholen', weak)}
    ${section('Kommt noch', upcoming)}
    ${before.length ? `<div class="section-h"><h2>Vor deinem Start · ${before.length}</h2><button class="link" data-act="toggleBefore">${ui.showBefore ? 'Ausblenden' : 'Anzeigen'}</button></div>${ui.showBefore ? `<div class="list">${before.map(row).join('')}</div>` : ''}` : ''}
    ${done.length ? `<div class="section-h"><h2>Erledigt · ${done.length}</h2><button class="link" data-act="toggleDone">${ui.showDone ? 'Ausblenden' : 'Anzeigen'}</button></div>${ui.showDone ? `<div class="list">${done.map(row).join('')}</div>` : ''}` : ''}
    ${!all.length ? `<div class="empty"><div class="art">${icon('week', 'lg')}</div><h3>Keine Termine in dieser Woche</h3><p>${esc(weekLabel(mon).split('·')[1]?.trim() || 'Freie Woche')}</p></div>` : ''}
    ${all.length && !open.length && !weak.length && due.length ? `<div class="banner" style="margin-top:var(--s4)">${icon('check')}<span>Alles, was bisher dran war, ist erledigt.</span></div>` : ''}
  </div>`;
}

// ======================= FÄCHER (COCKPIT) =======================
export function renderSubjects(el) {
  const sem = currentSemester();
  const t = today(), nm = nowMin();
  const I = idx();
  const subs = sem ? subjectsOf(sem.id) : [];
  const sems = store.data.semesters;
  const stats = subs.map((s) => ({ s, st: S.subjectStats(I, s.id, t, nm, F()), ex: nextExamFor(s.id) }));
  stats.sort((a, b) => (a.ex && b.ex ? (a.ex.on_date < b.ex.on_date ? -1 : 1) : a.ex ? -1 : b.ex ? 1 : 0) || b.st.open.length - a.st.open.length || a.s.sort - b.s.sort);
  const rated = stats.flatMap((x) => x.st.due.filter((o) => o.stars != null));
  const avg = rated.length ? rated.reduce((a, o) => a + o.stars, 0) / rated.length : null;
  const dueAll = stats.flatMap((x) => x.st.due);
  const prog = dueAll.length ? Math.round(dueAll.reduce((a, o) => a + o.progress, 0) / dueAll.length) : null;
  const openCount = stats.reduce((a, x) => a + x.st.open.length, 0);
  const openMin = stats.reduce((a, x) => a + x.st.openMinutes, 0);
  const weakCount = stats.reduce((a, x) => a + x.st.weak.length, 0);

  const semSelect = sems.length > 1 ? `<select data-act="sem" aria-label="Semester" style="width:auto;max-width:46%;height:44px;line-height:44px">${[...sems].sort((a, b) => (a.starts_on > b.starts_on ? -1 : 1)).map((s) => `<option value="${s.id}" ${s.id === sem?.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>` : '';

  el.innerHTML = `<div class="wrap">
    <div class="topbar"><div style="flex:1;min-width:0"><div class="eyebrow">Lern-Cockpit${sem ? ' · ' + esc(sem.name) : ''}</div><h1 class="title-xl">Fächer</h1></div>${semSelect}</div>
    ${subs.length ? `
    <div class="card hero" style="margin-top:var(--s4)">
      <div class="eyebrow">Zum Nachholen</div>
      <div class="big">${openCount}<small>${openCount === 1 ? 'Termin' : 'Termine'} · ${fmtHours(openMin)}</small></div>
      <div class="tiles" style="--n:3;margin-top:var(--s4)">
        <div class="tile"><div class="k">Ø Fitness</div><div class="v">${fmtStars(avg)}${avg != null ? '<small> / 5</small>' : ''}</div></div>
        <div class="tile"><div class="k">Fortschritt</div><div class="v">${prog == null ? '–' : prog + '<small> %</small>'}</div></div>
        <div class="tile"><div class="k">Schwach</div><div class="v">${weakCount}</div></div>
      </div>
    </div>
    <div class="section-h"><h2>Deine Fächer</h2></div>
    <div class="list">${stats.map(({ s, st, ex }) => `
      <button class="row" data-act="subject" data-id="${s.id}">
        <span class="ibox" data-c="${s.color}" style="font-weight:800;font-size:.78rem">${esc((s.code || s.name).slice(0, 3))}</span>
        <span class="main"><span class="t" style="display:block">${esc(s.name)}</span>
          <span class="s" style="display:block">${st.avgStars != null ? '★ ' + fmtStars(st.avgStars) + ' · ' : ''}${st.open.length ? st.open.length + ' offen' : st.due.length ? 'alles erledigt' : 'noch nichts fällig'}${ex ? ' · ' + (S.EXAM_KINDS[ex.kind]?.label || 'Prüfung') + ' ' + relDays(S.diffDays(t, ex.on_date)) : ''}</span></span>
        <span class="end">${st.progress != null ? ring(Math.round(st.progress), s.color) : ''}${icon('right', 'sm chev')}</span>
      </button>`).join('')}
    </div>` : `<div class="empty" style="margin-top:var(--s5)"><div class="art">${icon('book', 'lg')}</div><h3>Noch keine Fächer</h3><p>Lege deinen Stundenplan an – die Fächer erscheinen dann hier mit Statistik.</p><button class="btn small primary" data-act="editTT">Stundenplan anlegen</button></div>`}
    ${subs.length ? `<div style="margin-top:var(--s4)"><button class="btn" data-act="editTT">${icon('pencil', 'sm')}Fächer & Stundenplan bearbeiten</button></div>` : ''}
  </div>`;
}

export function nextExamFor(subjectId, from = today()) {
  return store.data.exams.filter((e) => e.subject_id === subjectId && e.kind !== 'period' && (e.until_date || e.on_date) >= from)
    .sort((a, b) => (a.on_date < b.on_date ? -1 : 1))[0] || null;
}

export function renderSubjectPage(el, subjectId) {
  const I = idx();
  const sub = I.subById.get(subjectId);
  if (!sub) { el.innerHTML = '<div class="wrap"><button class="back" data-act="back">' + icon('left') + 'Fächer</button><div class="empty"><h3>Fach nicht gefunden</h3></div></div>'; return; }
  const t = today();
  const st = S.subjectStats(I, sub.id, t, nowMin(), F());
  const exams = store.data.exams.filter((e) => e.subject_id === sub.id).sort((a, b) => (a.on_date < b.on_date ? -1 : 1));
  const upcomingEx = exams.filter((e) => (e.until_date || e.on_date) >= t);
  const review = S.sortForReview(st.open);
  // Notizen aller Termine des Fachs (auch zukünftige)
  const notes = store.data.occurrences.filter((o) => o.note && store.data.series.some((s) => s.id === o.series_id && s.subject_id === sub.id))
    .map((o) => S.makeOcc(I, store.data.series.find((s) => s.id === o.series_id), o.on_date))
    .sort((a, b) => (a.date > b.date ? -1 : 1));

  const row = (o, showNote = false) => `<button class="row" data-act="occ" data-key="${esc(o.key)}">
      <span class="main"><span class="t" style="display:block">${KIND(o.series.kind)} · ${fmtDate(o.date)}</span>
      <span class="s" style="display:block">${showNote ? esc(o.note) : `${o.starts}–${o.ends}${o.note ? ' · ' + esc(o.note) : ''}`}</span></span>
      <span class="end">${o.stars != null ? miniStars(o.stars) : ''}${showNote ? icon('right', 'sm chev') : ring(o.progress, sub.color)}</span></button>`;

  el.innerHTML = `<div class="wrap" data-c="${sub.color}">
    <div class="topbar"><button class="back" data-act="back">${icon('left')}Fächer</button><span class="spacer"></span>
      <button class="icon-btn" data-act="editSubject" data-id="${sub.id}" aria-label="Fach bearbeiten">${icon('pencil')}</button></div>
    <div class="eyebrow" style="color:var(--c)">${esc(sub.code || 'Fach')}</div>
    <h1 class="title-xl">${esc(sub.name)}</h1>
    <div class="card hero" style="margin-top:var(--s4)">
      <div class="eyebrow">Wie fit du dich fühlst</div>
      ${st.rated ? `<div class="big" style="color:var(--star)">${fmtStars(st.avgStars)}<small>Ø aus ${st.rated} ${st.rated === 1 ? 'Bewertung' : 'Bewertungen'}</small></div>`
        : '<p class="sub" style="margin:8px 0 0">Noch keine Bewertung. Vergib nach einem Termin 1–5 Sterne – hier siehst du dann deinen Schnitt.</p>'}
      <div class="tiles" style="--n:3;margin-top:var(--s4)">
        <div class="tile"><div class="k">Fortschritt</div><div class="v">${st.progress == null ? '–' : Math.round(st.progress) + '<small> %</small>'}</div></div>
        <div class="tile"><div class="k">Offen</div><div class="v">${st.open.length}<small> · ${fmtHours(st.openMinutes)}</small></div></div>
        <div class="tile"><div class="k">Termine</div><div class="v">${st.due.length}<small> / ${st.total}</small></div></div>
      </div>
    </div>
    ${upcomingEx.map((e) => `<div style="margin-top:var(--s2)">${examCard(e, e.on_date > t ? e.on_date : t, e.until_date ? '' : `<span class="chip red num">${relDays(S.diffDays(t, e.on_date))}</span>`)}</div>`).join('')}
    ${review.length ? `<div class="section-h"><h2>Nachholen · ${review.length}</h2></div><div class="list">${review.map((o) => row(o)).join('')}</div>` : ''}
    ${st.weak.length ? `<div class="section-h"><h2>Wiederholen · ${st.weak.length}</h2></div><div class="list">${S.sortForReview(st.weak).map((o) => row(o)).join('')}</div>` : ''}
    ${!review.length && !st.weak.length ? `<div class="banner" style="margin-top:var(--s4)">${icon('check')}<span>${st.due.length ? 'Nichts offen und nichts schwach – stark!' : 'Noch kein Termin dieses Fachs war dran.'}</span></div>` : ''}
    ${notes.length ? `<div class="section-h"><h2>Notizen · ${notes.length}</h2></div><div class="list">${notes.map((o) => row(o, true)).join('')}</div>` : ''}
    <div style="margin-top:var(--s5)"><button class="btn" data-act="newExam" data-subject="${sub.id}">${icon('plus', 'sm')}Prüfung für dieses Fach</button></div>
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

  let hero;
  if (ne) {
    const d = S.diffDays(t, ne.on_date);
    const sub = I.subById.get(ne.subject_id);
    const st = sub ? S.subjectStats(I, sub.id, t, nowMin(), F()) : null;
    hero = `<button class="card hero" data-act="exam" data-id="${ne.id}" style="width:100%;text-align:left;margin-top:var(--s4)">
      <div class="eyebrow">Nächste Prüfung</div>
      <div class="big">${d === 0 ? 'Heute' : d}<small>${d === 0 ? '' : d === 1 ? 'Tag' : 'Tage'}</small></div>
      <div style="margin-top:var(--s2);font-weight:700;font-size:1.1rem">${esc(ne.title)}</div>
      <div class="sub">${fmtDate(ne.on_date, { year: true })}${ne.starts_at ? ' · ' + S.hhmm(ne.starts_at) : ''}${ne.room ? ' · ' + esc(ne.room) : ''}</div>
      ${st ? `<div class="chips" style="margin-top:var(--s3)"><span class="chip">★ ${fmtStars(st.avgStars)}</span><span class="chip ${st.open.length ? 'amber' : 'green'}">${st.open.length} offen</span><span class="chip">${st.progress == null ? '–' : Math.round(st.progress)} % bearbeitet</span></div>` : ''}
    </button>`;
  } else {
    hero = `<div class="card hero" style="margin-top:var(--s4)"><div class="eyebrow">Nächste Prüfung</div><div class="big" style="font-size:2.4rem">–</div>
      <p class="sub" style="margin:var(--s2) 0 0">Trag deine Klausuren ein, sobald die Termine feststehen (z. B. im Fachbereichszeitplan). Dann siehst du hier den Countdown.</p></div>`;
  }

  const row = (e) => {
    const sub = I.subById.get(e.subject_id);
    const label = S.EXAM_KINDS[e.kind]?.label || 'Termin';
    const isRange = e.until_date && e.until_date !== e.on_date;
    const d = S.diffDays(t, e.on_date);
    let end;
    if (isRange && e.on_date <= t) { const left = S.diffDays(t, e.until_date); end = `<span class="chip amber">${left === 0 ? 'endet heute' : 'noch ' + (left + 1) + ' T.'}</span>`; }
    else end = `<span class="num">${d === 0 ? 'heute' : d === 1 ? 'morgen' : d > 0 ? 'in ' + d + ' T.' : ''}</span>`;
    const ic = e.kind === 'period' ? ['', 'cal'] : (e.kind === 'registration' || e.kind === 'submission') ? ['amber', 'hourglass'] : e.kind === 'other' ? ['', 'info'] : ['red', 'cap'];
    return `<button class="row" data-act="exam" data-id="${e.id}">
      <span class="ibox ${ic[0]}">${icon(ic[1])}</span>
      <span class="main"><span class="t" style="display:block">${esc(e.title)}</span>
      <span class="s" style="display:block">${label} · ${isRange ? fmtRange(e.on_date, e.until_date) : fmtDate(e.on_date)}${e.starts_at ? ' · ' + S.hhmm(e.starts_at) : ''}${sub && sub.name !== e.title ? ' · ' + esc(sub.name) : ''}</span></span>
      <span class="end">${end}</span></button>`;
  };

  el.innerHTML = `<div class="wrap">
    <div class="topbar"><div style="flex:1;min-width:0"><div class="eyebrow">Countdown</div><h1 class="title-xl">Prüfungen</h1></div>
      <button class="icon-btn accent" data-act="newExam" aria-label="Prüfung hinzufügen">${icon('plus')}</button></div>
    ${hero}
    ${running.map((e) => `<div class="banner amber" style="margin-top:var(--s3)">${icon('hourglass')}<span><b>${esc(e.title)}</b> läuft – ${S.diffDays(t, e.until_date) === 0 ? 'heute letzter Tag!' : `noch bis ${fmtDate(e.until_date)}`}</span></div>`).join('')}
    ${upcoming.length ? `<div class="section-h"><h2>Anstehend</h2></div><div class="list">${upcoming.map(row).join('')}</div>` : ''}
    ${past.length ? `<details style="margin-top:var(--s4)"><summary class="section-h" style="list-style:none;cursor:pointer"><h2>Vorbei · ${past.length}</h2><span class="link">Anzeigen</span></summary><div class="list">${past.map(row).join('')}</div></details>` : ''}
    <div style="margin-top:var(--s5)"><button class="btn primary" data-act="newExam">${icon('plus', 'sm')}Prüfung oder Frist hinzufügen</button></div>
  </div>`;
}

// ======================= STUNDENPLAN (VOLLBILD) =======================
export function renderTimetable(el) {
  const mon = ui.ttMon, t = today();
  const I = idx();
  const sem = S.semesterFor(store.data.semesters, mon) || S.semesterFor(store.data.semesters, S.addDays(mon, 4));
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = S.addDays(mon, i);
    days.push({ d, i, list: S.occurrencesOn(I, d), exams: markedExams(d) });
  }
  // Fristen ohne Uhrzeit stehen oben als Hinweis, nicht im Raster
  const deadlines = days.flatMap((x) => x.exams.filter((e) => !e.starts_at && e.kind !== 'exam' && e.kind !== 'oral').map((e) => ({ e, d: x.d })));
  for (const x of days) x.exams = x.exams.filter((e) => !deadlines.some((y) => y.e === e));
  const weekend = days.slice(5).some((x) => x.list.length || x.exams.length);
  const shown = weekend ? days : days.slice(0, 5);
  const times = shown.flatMap((x) => [...x.list.filter((o) => !o.cancelled).map((o) => [o.startMin, o.endMin]), ...x.exams.filter((e) => e.starts_at).map((e) => [S.toMin(e.starts_at), S.toMin(e.ends_at || e.starts_at) + (e.ends_at ? 0 : 90)])]);
  const start = times.length ? Math.floor(Math.min(...times.map((x) => x[0])) / 30) * 30 : 8 * 60;
  const end = times.length ? Math.ceil(Math.max(...times.map((x) => x[1])) / 30) * 30 : 18 * 60;
  const ppm = 1.22;
  const height = Math.max(200, (end - start) * ppm + 8);
  const subjects = sem ? subjectsOf(sem.id) : [];
  const anything = shown.some((x) => x.list.length || x.exams.length);

  const cols = shown.map(({ d, i, list, exams }) => {
    const items = S.layoutColumns(list);
    const cancelled = list.filter((o) => o.cancelled);
    let h = '';
    const box = (o, col, ncols, extraCls = '') => {
      const top = (o.startMin - start) * ppm, hh = Math.max(26, o.duration * ppm - 3);
      const w = 100 / ncols;
      const small = hh < 70;
      return `<button class="tt-item ${extraCls}" data-c="${o.subject.color}" data-act="occ" data-key="${esc(o.key)}" style="top:${top}px;height:${hh}px;left:calc(${col * w}% + 3px);right:auto;width:calc(${w}% - 6px)">
        ${!small && ncols === 1 ? `<span class="tm a">${o.starts}</span><span class="tm b">${o.ends}</span>` : ''}
        ${o.mandatory && !o.cancelled ? '<span class="pin"></span>' : o.progress >= 100 ? '<span class="done">✓</span>' : ''}
        <b>${esc(o.subject.code ? o.subject.code + ':' : '')}${esc(o.subject.name)}</b>
        <span class="k">${S.KINDS[o.series.kind]?.short || ''}${o.series.lecturer && !small ? ' ' + esc(o.series.lecturer) : ''}</span>
        ${!small ? `<span class="k">${esc(o.room)}</span>` : ''}
        ${!small && o.series.group_label ? `<span class="k">${esc(o.series.group_label)}</span>` : ''}
      </button>`;
    };
    for (const it of items) h += box(it.o, it.col, it.cols);
    for (const o of cancelled) h += box(o, 0, 1, 'cancelled');
    // Pausen
    const act = items.filter((x) => x.cols === 1).map((x) => x.o).sort((a, b) => a.startMin - b.startMin);
    for (let k = 1; k < act.length; k++) {
      const gap = act[k].startMin - act[k - 1].endMin;
      if (gap >= 10 && gap * ppm >= 18) {
        const y = (act[k - 1].endMin - start) * ppm + (gap * ppm) / 2 - 8;
        h += `<div class="tt-pause" style="top:${y}px"><span>${gap < 60 ? gap + ' min' : Math.floor(gap / 60) + ' Std.' + (gap % 60 ? ' ' + (gap % 60) : '')}</span></div>`;
      }
    }
    for (const e of exams) {
      const s0 = e.starts_at ? S.toMin(e.starts_at) : start;
      const e0 = e.ends_at ? S.toMin(e.ends_at) : s0 + 90;
      h += `<button class="tt-item exam" data-act="exam" data-id="${e.id}" style="top:${(s0 - start) * ppm}px;height:${Math.max(30, (e0 - s0) * ppm - 3)}px">
        <b>${esc(S.EXAM_KINDS[e.kind]?.label || 'Prüfung')}</b><span class="k">${esc(e.title)}</span>${e.starts_at ? `<span class="k">${S.hhmm(e.starts_at)}</span>` : ''}</button>`;
    }
    const hol = S.holidayOn(sem, d);
    return `<div class="tt-col"><div class="tt-dayh ${d === t ? 'today' : ''}"><b>${WD[i]}</b><span>${Number(d.slice(8))}.${Number(d.slice(5, 7))}.</span></div>
      <div class="tt-body" style="height:${height}px">${hol ? `<div class="tt-pause" style="top:40px"><span>${esc(hol.name)}</span></div>` : ''}${h}</div></div>`;
  }).join('');

  const wi = S.weekInfo(sem, mon);
  el.innerHTML = `
    <div class="tt-head">
      <div class="ttl"><b>Stundenplan</b><span class="sub">${weekLabel(mon)} · ${fmtRange(mon, S.addDays(mon, 6))}</span></div>
      <button class="icon-btn" data-act="tt" data-d="-7" aria-label="Vorherige Woche">${icon('left')}</button>
      <button class="icon-btn" data-act="tt" data-d="7" aria-label="Nächste Woche">${icon('right')}</button>
    </div>
    ${mon !== S.mondayOf(t) || (wi && wi.kind !== 'lecture') ? `<div style="display:flex;gap:8px;padding:0 var(--s4) var(--s2);flex-wrap:wrap">${wi && wi.kind !== 'lecture' ? `<span class="chip accent">${S.WEEK_KINDS[wi.kind]}</span>` : ''}${mon !== S.mondayOf(t) ? '<button class="chip" data-act="tt" data-d="0">Diese Woche</button>' : ''}</div>` : ''}
    ${deadlines.map(({ e, d }) => `<button class="banner amber" data-act="exam" data-id="${e.id}" style="margin:0 var(--s4) var(--s2);width:calc(100% - 2 * var(--s4));text-align:left">${icon('hourglass')}<span><b>${esc(e.title)}</b> – ${e.until_date && e.until_date !== e.on_date ? 'endet' : 'am'} ${fmtDate(d)}</span></button>`).join('')}
    <div class="tt-scroll" data-swipe="tt">
      ${subjects.length ? (anything ? `<div class="tt-grid" style="--days:${shown.length}">${cols}</div>` : `<div class="tt-empty">${icon('cal', 'lg')}<p>${wi && wi.kind !== 'lecture' ? S.WEEK_KINDS[wi.kind] + ' – keine regulären Termine.' : 'In dieser Woche stehen keine Termine an.'}</p></div>`)
        : `<div class="tt-empty"><p>Noch kein Stundenplan angelegt.</p><button class="btn primary small" data-act="editTT">Stundenplan anlegen</button></div>`}
      ${subjects.length ? `<div class="tt-legend">${subjects.map((s) => `<span data-c="${s.color}"><i></i>${esc(s.code ? s.code + ' ' : '')}${esc(s.name)}</span>`).join('')}</div>
      <div style="padding:var(--s4) var(--s3) 80px"><button class="btn" data-act="editTT">${icon('pencil', 'sm')}Stundenplan bearbeiten</button></div>` : ''}
    </div>`;
}
