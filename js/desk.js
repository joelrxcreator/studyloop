// Desktop-Komfort (MacBook & Co.): Suche (⌘K), Tastenkürzel-Übersicht, Zwei-Finger-Wischen auf dem Trackpad.
import * as S from './schedule.js';
import { store, idx } from './store.js';
import { icon } from './icons.js';
import { esc, fmtDate, sheet } from './ui.js';
import { today, currentSemester } from './ctx.js';

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '') || /Mac OS X/.test(navigator.userAgent);
export const MOD = isMac ? '⌘' : 'Strg+';
export const finePointer = () => matchMedia('(hover: hover) and (pointer: fine)').matches;

// ---------------- Zwei-Finger-Wischen (Trackpad) ----------------
/**
 * Waagerechtes Wischen mit zwei Fingern löst onSwipe(+1 | -1) aus – einmal pro Geste.
 * +1 = Finger nach links (weiter), -1 = Finger nach rechts (zurück).
 * allowed(e): ob an dieser Stelle gewischt werden darf (sonst bleibt alles beim Browser).
 */
export function bindWheelSwipe(el, onSwipe, allowed = () => true) {
  let acc = 0, locked = false, lastT = 0, prevAbs = 0;
  el.addEventListener('wheel', (e) => {
    if (e.ctrlKey) return; // Zoom-Geste
    const k = e.deltaMode === 1 ? 16 : 1;
    const dx = e.deltaX * k, dy = e.deltaY * k;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    const now = performance.now();
    if (now - lastT > 160) { acc = 0; locked = false; prevAbs = 0; }
    lastT = now;
    if (ax < 1 || ax <= ay * 1.3) { if (!locked) acc = 0; prevAbs = ax; return; } // senkrecht: normal scrollen
    if (!allowed(e)) return;
    e.preventDefault(); // kein „Seite zurück“ des Browsers, kein seitliches Ruckeln
    // Nach dem Auslösen läuft der Schwung des Trackpads noch aus; erst ein neuer, stärkerer Impuls zählt wieder
    if (locked && ax > prevAbs + 8 && ax > 24) { locked = false; acc = 0; }
    prevAbs = ax;
    if (locked) return;
    acc += dx;
    if (Math.abs(acc) > 60) { locked = true; const dir = acc > 0 ? 1 : -1; acc = 0; onSwipe(dir, e); }
  }, { passive: false });
}

// ---------------- Suche / Befehle (⌘K) ----------------
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');
let palette = null;
export const searchOpen = () => !!palette;
export function closeSearch() { palette?.close(); }

function parseDate(q) {
  const t = today();
  const n = norm(q).trim();
  if (n === 'heute') return t;
  if (n === 'morgen') return S.addDays(t, 1);
  if (n === 'gestern') return S.addDays(t, -1);
  const m = /^(\d{1,2})\.(\d{1,2})\.?(\d{2,4})?$/.exec(n);
  if (!m) return null;
  let y = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : Number(t.slice(0, 4));
  const mk = (yy) => `${yy}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  let d = mk(y);
  if (!S.isValidDate(d)) return null;
  // ohne Jahr: innerhalb des Semesters bleiben (Januar im Wintersemester = nächstes Jahr)
  if (!m[3]) { const sem = currentSemester(); if (sem && d < sem.starts_on && S.isValidDate(mk(y + 1)) && mk(y + 1) <= sem.ends_on) d = mk(y + 1); }
  return d;
}

/**
 * Öffnet die Suche. api: { go(tab), day(date), subject(id), exam(id), occ(key), act(name) }.
 */
export function openSearch(api) {
  if (palette) { palette.close(); return; }
  const I = idx();
  const base = [
    { icon: 'today', title: 'Heute', kind: 'Bereich', hint: '1', run: () => api.go('day') },
    { icon: 'grid', title: 'Woche', kind: 'Bereich', hint: '2', run: () => api.go('week') },
    { icon: 'book', title: 'Fächer', kind: 'Bereich', hint: '3', run: () => api.go('subjects') },
    { icon: 'cap', title: 'Prüfungen', kind: 'Bereich', hint: '4', run: () => api.go('exams') },
    { icon: 'plus', title: 'Neuer Termin', kind: 'Aktion', kw: 'anlegen hinzufügen vorlesung übung stundenplan', run: () => api.act('newSeries') },
    { icon: 'plus', title: 'Neues Fach', kind: 'Aktion', kw: 'anlegen hinzufügen', run: () => api.act('newSubject') },
    { icon: 'plus', title: 'Neue Prüfung oder Frist', kind: 'Aktion', kw: 'klausur abgabe anmeldung anlegen hinzufügen', run: () => api.act('newExam') },
    { icon: 'checkCircle', title: 'Nachholen', sub: 'Alles Offene im Semester', kind: 'Aktion', kw: 'offen backlog wiederholen', run: () => api.act('backlog') },
    { icon: 'pencil', title: 'Stundenplan bearbeiten', kind: 'Aktion', kw: 'termine fächer ändern', run: () => api.act('editTT') },
    { icon: 'layers', title: 'Alle Wochen des Semesters', kind: 'Aktion', kw: 'semesterübersicht kw kalenderwoche', run: () => api.act('semMap') },
    { icon: 'bell', title: 'Erinnerungen', kind: 'Einstellung', kw: 'mitteilungen push nachtruhe', run: () => api.act('reminders') },
    { icon: 'gear', title: 'Einstellungen', kind: 'Einstellung', kw: 'konto sicherung darstellung', run: () => api.act('settings') },
    { icon: 'moon', title: 'Darstellung: Dunkel', kind: 'Einstellung', kw: 'dark mode theme', run: () => api.act('themeDark') },
    { icon: 'sun', title: 'Darstellung: Hell', kind: 'Einstellung', kw: 'light mode theme', run: () => api.act('themeLight') },
    { icon: 'keyboard', title: 'Tastenkürzel', kind: 'Hilfe', kw: 'shortcuts hilfe gesten', run: () => api.act('shortcuts') },
  ];
  const sem = currentSemester();
  const dyn = [];
  for (const s of store.data.subjects) {
    const semName = store.data.semesters.find((x) => x.id === s.semester_id)?.name || '';
    dyn.push({ icon: 'book', title: s.name, sub: [s.code, s.semester_id !== sem?.id ? semName : ''].filter(Boolean).join(' · '), kind: 'Fach', c: s.color, prio: s.semester_id === sem?.id ? 1 : 0, run: () => api.subject(s.id) });
  }
  for (const e of store.data.exams) {
    dyn.push({ icon: e.kind === 'period' ? 'cal' : e.kind === 'registration' || e.kind === 'submission' ? 'hourglass' : 'cap', title: e.title, sub: `${S.EXAM_KINDS[e.kind]?.label || 'Termin'} · ${fmtDate(e.on_date, { year: true })}`, kind: 'Prüfung', run: () => api.exam(e.id) });
  }
  for (const o of store.data.occurrences) {
    if (!o.note) continue;
    const sr = store.data.series.find((x) => x.id === o.series_id);
    const sub = sr && I.subById.get(sr.subject_id);
    if (!sub) continue;
    dyn.push({ icon: 'note', title: o.note.length > 70 ? o.note.slice(0, 70) + '…' : o.note, full: o.note, sub: `${sub.name} · ${fmtDate(o.on_date)}`, kind: 'Notiz', run: () => api.occ(`${o.series_id}|${o.on_date}`) });
  }

  const wrap = document.createElement('div');
  wrap.className = 'palette-wrap';
  wrap.innerHTML = `<div class="palette" role="dialog" aria-modal="true" aria-label="Suchen">
    <div class="palette-in">${icon('search')}<input type="text" placeholder="Suchen: Fach, Prüfung, Notiz, Datum (24.10.) …" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Suchen"><kbd>esc</kbd></div>
    <div class="palette-list" role="listbox"></div>
  </div>`;
  document.body.appendChild(wrap);
  const input = wrap.querySelector('input');
  const list = wrap.querySelector('.palette-list');
  let results = [], sel = 0;

  const search = (q) => {
    const tokens = norm(q).split(/\s+/).filter(Boolean);
    if (!tokens.length) return base.slice(0, 9);
    const out = [];
    const d = parseDate(q);
    if (d) out.push({ icon: 'cal', title: fmtDate(d, { year: true }), sub: 'Zu diesem Tag springen', kind: 'Datum', run: () => api.day(d), score: 100 });
    for (const it of [...dyn, ...base]) {
      const t = norm(it.title), hay = `${t} ${norm(it.full)} ${norm(it.sub)} ${norm(it.kw)} ${norm(it.kind)}`;
      if (!tokens.every((x) => hay.includes(x))) continue;
      const score = (t.startsWith(tokens[0]) ? 30 : t.includes(tokens[0]) ? 15 : 0) + (it.prio || 0) + (it.kind === 'Fach' ? 5 : it.kind === 'Prüfung' ? 4 : 0);
      out.push({ ...it, score });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 9);
  };
  const draw = () => {
    results = search(input.value);
    sel = Math.min(sel, Math.max(0, results.length - 1));
    list.innerHTML = results.length ? results.map((r, i) => `<button class="pal-item ${i === sel ? 'sel' : ''}" role="option" aria-selected="${i === sel}" data-i="${i}" ${r.c ? `data-c="${r.c}"` : ''}>
        <span class="sq">${icon(r.icon)}</span><span class="main"><span class="t">${esc(r.title)}</span>${r.sub ? `<span class="s">${esc(r.sub)}</span>` : ''}</span>
        <span class="kind">${esc(r.kind)}</span>${r.hint ? `<kbd>${esc(r.hint)}</kbd>` : ''}</button>`).join('')
      : `<div class="pal-empty">Nichts gefunden für „${esc(input.value)}“</div>`;
  };
  const move = (d) => {
    if (!results.length) return;
    sel = (sel + d + results.length) % results.length;
    list.querySelectorAll('.pal-item').forEach((b, i) => { b.classList.toggle('sel', i === sel); b.setAttribute('aria-selected', String(i === sel)); if (i === sel) b.scrollIntoView({ block: 'nearest' }); });
  };
  const run = (i) => { const r = results[i]; if (!r) return; palette.close(); r.run(); };
  palette = {
    close() {
      if (!palette) return;
      palette = null;
      wrap.classList.remove('open');
      wrap.style.pointerEvents = 'none';
      input.blur();
      setTimeout(() => wrap.remove(), 180);
    },
  };
  input.addEventListener('input', () => { sel = 0; draw(); });
  wrap.addEventListener('keydown', (e) => {
    if (!palette) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); run(sel); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); palette?.close(); }
  });
  wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) palette?.close(); });
  list.addEventListener('click', (e) => { const b = e.target.closest('.pal-item'); if (b) run(Number(b.dataset.i)); });
  list.addEventListener('mousemove', (e) => { const b = e.target.closest('.pal-item'); if (b && Number(b.dataset.i) !== sel) { sel = Number(b.dataset.i); list.querySelectorAll('.pal-item').forEach((x, i) => x.classList.toggle('sel', i === sel)); } });
  draw();
  input.focus(); // sofort – wer nach ⌘K gleich lostippt, verliert sonst die ersten Buchstaben
  requestAnimationFrame(() => wrap.classList.add('open'));
}

// ---------------- Tastenkürzel & Gesten ----------------
export function openShortcuts() {
  const row = (keys, text) => `<div class="cell kbd-row"><span class="main"><span class="t">${text}</span></span><span class="keys">${keys.map((k) => `<kbd>${k}</kbd>`).join('')}</span></div>`;
  sheet({
    title: 'Tastenkürzel & Gesten',
    render(b) {
      b.innerHTML = `
        <div class="gh" style="margin-top:6px">Trackpad & Maus</div>
        <div class="group">
          ${row(['Zwei Finger ← →'], 'Tag bzw. Woche wechseln')}
          ${row(['Zwei Finger →'], 'Auf Unterseiten: zurück')}
          ${row(['Rechtsklick'], 'Schnellmenü für einen Termin')}
          ${row(['Klick'], 'In der Woche auf eine freie Stelle: neuer Termin')}
        </div>
        <div class="gh">Tastatur</div>
        <div class="group">
          ${row(['1', '2', '3', '4'], 'Heute, Woche, Fächer, Prüfungen')}
          ${row(['←', '→'], 'Tag bzw. Woche wechseln')}
          ${row(['T'], 'Zurück zu heute')}
          ${row(['N'], 'Neu: Termin, Fach, Prüfung')}
          ${row([MOD + 'K', '/'], 'Suchen und springen')}
          ${row(['R'], 'Aktualisieren')}
          ${row([','], 'Einstellungen')}
          ${row(['esc'], 'Schließen oder zurück')}
          ${row(['?'], 'Diese Übersicht')}
        </div>`;
    },
  });
}
