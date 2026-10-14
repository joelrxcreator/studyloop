// Studyloop – Start, Navigation, Gesten.
import * as S from './schedule.js';
import { store, sb, onChange, onStatus, onError, setUser, load, pendingCount } from './store.js';
import { icon } from './icons.js';
import { toast, sheet, openSheets, closeAllSheets } from './ui.js';
import { ui, nav, today } from './ctx.js';
import { renderDay, renderWeek, renderSubjects, renderSubjectPage, renderExams, renderTimetable } from './views.js';
import { openOcc, openSeries, openSubject, openExam, renderTTEditor, renderSemesterEditor, addHoliday, delHoliday, delSemester, newSemester } from './editors.js';
import { renderSettings, settingsAction, setTheme, getTheme } from './settings.js';
import { renderAuth, renderOnboarding, askNewPassword } from './auth.js';
import { syncPush } from './push.js';

const app = document.getElementById('app');
let mode = null; // auth | loading | onboarding | main
let main, tabbar, fab, ttEl = null, ptr;
const pages = []; // { el, render }

setTheme(getTheme());
onError((m) => toast(m, { error: true, ms: 4000 }));

// ---------------- Rendering ----------------
let raf = 0;
function scheduleRender() {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; render(); });
}

function render() {
  const want = !store.user ? 'auth' : !store.loaded ? 'loading' : !store.data.semesters.length ? 'onboarding' : 'main';
  if (want !== mode) {
    mode = want;
    pages.splice(0).forEach((p) => p.el.remove());
    closeTimetable(true);
    app.innerHTML = '';
    if (want === 'auth') { renderAuth(app); return; }
    if (want === 'loading') { app.innerHTML = `<div class="screen no-tabs"><div class="wrap"><div class="skel" style="height:40px;width:50%;margin-top:20px"></div><div class="skel" style="height:62px;margin-top:20px"></div><div class="skel" style="height:96px;margin-top:20px"></div><div class="skel" style="height:96px;margin-top:12px"></div><div class="skel" style="height:96px;margin-top:12px"></div></div></div>`; return; }
    if (want === 'onboarding') { renderOnboarding(app); return; }
    buildShell();
  }
  if (mode !== 'main') return;
  renderMain();
  for (const p of pages) p.render();
  if (ttEl) renderTimetable(ttEl);
}

function buildShell() {
  app.innerHTML = `
    <div class="screen" id="main"></div>
    <nav class="tabbar" aria-label="Bereiche">
      ${[['day', 'today', 'Heute'], ['week', 'week', 'Woche'], ['subjects', 'book', 'Fächer'], ['exams', 'cap', 'Prüfungen']].map(([k, ic, l]) => `<button data-tab="${k}">${icon(ic)}<span>${l}</span></button>`).join('')}
    </nav>
    <button class="fab" data-fab aria-label="Stundenplan öffnen">${icon('grid')}<span>Stundenplan</span></button>
    <div class="ptr">${icon('refresh')}</div>`;
  main = app.querySelector('#main');
  tabbar = app.querySelector('.tabbar');
  fab = app.querySelector('[data-fab]');
  ptr = app.querySelector('.ptr');
  tabbar.addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) go(b.dataset.tab, { fromTab: true }); });
  fab.addEventListener('click', () => (ttEl ? closeTimetable() : openTimetable()));
  main.addEventListener('click', onAction);
  main.addEventListener('change', onChangeAction);
  bindSwipes(main);
  bindPullToRefresh(main);
}

function renderMain() {
  ({ day: renderDay, week: renderWeek, subjects: renderSubjects, exams: renderExams }[ui.tab])(main);
  tabbar.querySelectorAll('[data-tab]').forEach((b) => { if (b.dataset.tab === ui.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
}

function go(tab, { fromTab = false } = {}) {
  closeTimetable(true);
  pages.splice(0).forEach((p) => p.el.remove());
  if (fromTab && tab === ui.tab) {
    // erneutes Tippen: nach oben bzw. zurück zu heute
    if (main.scrollTop > 0) main.scrollTo({ top: 0, behavior: 'smooth' });
    else if (tab === 'day') ui.day = today();
    else if (tab === 'week') ui.weekMon = S.mondayOf(today());
  }
  if (tab !== ui.tab) main.scrollTop = 0;
  ui.tab = tab;
  renderMain();
}

// ---------------- Seiten (Detail) ----------------
function pushPage(renderFn) {
  const el = document.createElement('div');
  el.className = 'screen page no-tabs';
  document.body.appendChild(el);
  const p = { el, render: () => renderFn(el, p.render) };
  pages.push(p);
  p.render();
  el.addEventListener('click', onAction);
  el.addEventListener('change', onChangeAction);
  bindEdgeSwipe(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
}
function popPage() {
  const p = pages.pop();
  if (!p) return;
  p.el.classList.remove('in');
  setTimeout(() => p.el.remove(), 320);
}

// ---------------- Stundenplan (Vollbild) ----------------
function openTimetable() {
  if (ttEl) return;
  ui.ttMon = S.mondayOf(ui.tab === 'day' ? ui.day : ui.tab === 'week' ? ui.weekMon : today());
  ttEl = document.createElement('div');
  ttEl.className = 'tt-wrap';
  document.body.appendChild(ttEl);
  renderTimetable(ttEl);
  ttEl.addEventListener('click', onAction);
  bindSwipes(ttEl);
  fab.innerHTML = `${icon('x')}<span>Schließen</span>`;
  fab.setAttribute('aria-label', 'Stundenplan schließen');
  fab.style.zIndex = 55;
  requestAnimationFrame(() => requestAnimationFrame(() => ttEl?.classList.add('open')));
}
function closeTimetable(instant = false) {
  if (!ttEl) return;
  const el = ttEl;
  ttEl = null;
  el.classList.remove('open');
  setTimeout(() => el.remove(), instant ? 0 : 250);
  if (fab) { fab.innerHTML = `${icon('grid')}<span>Stundenplan</span>`; fab.setAttribute('aria-label', 'Stundenplan öffnen'); fab.style.zIndex = ''; }
}

Object.assign(nav, {
  go, render: scheduleRender, pushPage, popPage, openTimetable, closeTimetable,
  openSettings: () => pushPage((el, rr) => renderSettings(el, rr)),
});

// ---------------- Aktionen ----------------
async function onAction(e) {
  const b = e.target.closest('[data-act]');
  if (!b || b.tagName === 'SELECT') return;
  const act = b.dataset.act;
  switch (act) {
    case 'occ': openOcc(b.dataset.key); break;
    case 'day': ui.day = b.dataset.d; if (ui.tab !== 'day') go('day'); else renderMain(); break;
    case 'tab': go(b.dataset.tab); break;
    case 'wk': ui.weekMon = b.dataset.d === '0' ? S.mondayOf(today()) : S.addDays(ui.weekMon, Number(b.dataset.d)); renderMain(); break;
    case 'tt': ui.ttMon = b.dataset.d === '0' ? S.mondayOf(today()) : S.addDays(ui.ttMon, Number(b.dataset.d)); renderTimetable(ttEl); break;
    case 'toggleDone': ui.showDone = !ui.showDone; renderMain(); break;
    case 'toggleBefore': ui.showBefore = !ui.showBefore; renderMain(); break;
    case 'settings': nav.openSettings(); break;
    case 'back': popPage(); break;
    case 'subject': pushPage((el) => renderSubjectPage(el, b.dataset.id)); break;
    case 'editSubject': openSubject(store.data.subjects.find((s) => s.id === b.dataset.id)); break;
    case 'newSubject': openSubject(null); break;
    case 'editSeries': openSeries(store.data.series.find((s) => s.id === b.dataset.id)); break;
    case 'newSeries': openSeries(null, { subject_id: b.dataset.subject }); break;
    case 'exam': openExam(store.data.exams.find((x) => x.id === b.dataset.id)); break;
    case 'newExam': openExam(null, { subject_id: b.dataset.subject }); break;
    case 'editTT': closeTimetable(true); pushPage((el) => renderTTEditor(el)); break;
    case 'editSemester': pushPage((el) => renderSemesterEditor(el, b.dataset.id)); break;
    case 'newSemester': newSemester(); break;
    case 'addHoliday': addHoliday(b.dataset.id); break;
    case 'delHoliday': delHoliday(b.dataset.id, Number(b.dataset.i)); break;
    case 'delSemester': delSemester(b.dataset.id); break;
    default: {
      const top = pages[pages.length - 1];
      await settingsAction(act, b, () => top?.render());
    }
  }
}

function onChangeAction(e) {
  const t = e.target;
  if (t.dataset.act === 'sem') { ui.semId = t.value; renderMain(); }
}

// ---------------- Gesten ----------------
function bindSwipes(el) {
  let x0 = null, y0 = 0, zone = null, t0 = 0;
  el.addEventListener('touchstart', (e) => {
    const z = e.target.closest('[data-swipe]');
    if (!z || e.target.closest('input, textarea, select, .range')) { x0 = null; return; }
    zone = z.dataset.swipe; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now();
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.6 || Date.now() - t0 > 700) return;
    const dir = dx < 0 ? 1 : -1;
    if (zone === 'day') { ui.day = S.addDays(ui.day, dir); renderMain(); }
    else if (zone === 'week') { ui.day = S.addDays(ui.day, dir * 7); renderMain(); }
    else if (zone === 'wk') { ui.weekMon = S.addDays(ui.weekMon, dir * 7); renderMain(); }
    else if (zone === 'tt' && ttEl) { ui.ttMon = S.addDays(ui.ttMon, dir * 7); renderTimetable(ttEl); }
  }, { passive: true });
}

function bindEdgeSwipe(el) {
  // vom linken Rand nach rechts wischen = zurück (wie iOS)
  let x0 = null, y0 = 0;
  el.addEventListener('touchstart', (e) => { const x = e.touches[0].clientX; x0 = x < 28 ? x : null; y0 = e.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = Math.abs(e.changedTouches[0].clientY - y0);
    x0 = null;
    if (dx > 80 && dy < 60) popPage();
  }, { passive: true });
}

function bindPullToRefresh(el) {
  let y0 = null, dy = 0;
  el.addEventListener('touchstart', (e) => { y0 = el.scrollTop <= 0 && !openSheets() ? e.touches[0].clientY : null; dy = 0; }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    dy = e.touches[0].clientY - y0;
    if (dy <= 0) { ptr.style.opacity = 0; return; }
    const d = Math.min(70, dy / 2);
    ptr.style.transition = 'none';
    ptr.style.opacity = Math.min(1, dy / 120);
    ptr.style.transform = `translateY(${d}px) rotate(${dy * 2}deg)`;
  }, { passive: true });
  el.addEventListener('touchend', async () => {
    if (y0 == null) return;
    y0 = null;
    ptr.style.transition = 'transform .25s, opacity .25s';
    if (dy > 120) {
      ptr.style.transform = 'translateY(50px)';
      ptr.classList.add('spin');
      const ok = await load();
      ptr.classList.remove('spin');
      if (!ok) toast('Keine Verbindung – du siehst den zuletzt geladenen Stand.', { error: true });
    }
    ptr.style.opacity = 0;
    ptr.style.transform = 'translateY(-40px)';
  });
}

// ---------------- Sync-Anzeige ----------------
let pill;
onStatus((s) => {
  if (!pill) { pill = document.createElement('div'); pill.className = 'syncpill'; document.body.appendChild(pill); }
  pill.hidden = s === 'ok';
  pill.className = 'syncpill' + (s === 'offline' ? ' warn' : '');
  pill.innerHTML = s === 'offline' ? `${icon('wifiOff', 'sm')}Offline – ${pendingCount()} Änderung(en) werden später gespeichert` : `${icon('refresh', 'sm')}Speichert …`;
});

// ---------------- Lebenszyklus ----------------
let hiddenAt = 0;
let lastDay = today();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
  if (!store.user) return;
  // länger weg → zurück zum aktuellen Tag
  if (hiddenAt && Date.now() - hiddenAt > 20 * 60000 && !openSheets()) {
    ui.day = today(); ui.weekMon = S.mondayOf(today());
  }
  if (Date.now() - store.lastLoad > 30000) load({ quiet: true });
  scheduleRender();
});
setInterval(() => {
  if (document.visibilityState !== 'visible' || !store.user) return;
  const t = today();
  if (t !== lastDay) { if (ui.day === lastDay) ui.day = t; if (ui.weekMon === S.mondayOf(lastDay)) ui.weekMon = S.mondayOf(t); lastDay = t; }
  if (Date.now() - store.lastLoad > 60000 && !openSheets()) load({ quiet: true });
  else if (!openSheets()) scheduleRender(); // "fällig" verschiebt sich mit der Uhrzeit
}, 60000);

onChange(scheduleRender);

// Mitteilung angetippt → richtige Stelle öffnen
function route(hash) {
  const m = /^#?day\/(\d{4}-\d{2}-\d{2})/.exec(hash || '');
  if (m && S.isValidDate(m[1])) { ui.day = m[1]; ui.tab = 'day'; }
  else if (/exams/.test(hash || '')) ui.tab = 'exams';
  if (mode === 'main') { closeAllSheets(); go(ui.tab); }
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'open') route(new URL(e.data.url, location.href).hash); });
}

// ---------------- Start ----------------
async function start() {
  route(location.hash);
  if (location.hash && !/access_token|type=recovery|error/.test(location.hash)) history.replaceState(null, '', location.pathname);
  const { data } = await sb.auth.getSession();
  setUser(data.session?.user || null);
  render();
  if (store.user) { load(); syncPush(); }
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') setTimeout(askNewPassword, 400);
    const u = session?.user || null;
    if ((u?.id || null) !== (store.user?.id || null)) {
      setUser(u);
      if (u) { load(); syncPush(); }
      scheduleRender();
    }
    if (/access_token|type=recovery/.test(location.hash)) history.replaceState(null, '', location.pathname);
  });
}
start();

// Service Worker: immer frisch laden, nach Update automatisch neu starten
if ('serviceWorker' in navigator) {
  const had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && reg.update().catch(() => {}));
  }).catch((e) => console.warn('SW', e));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (had && !openSheets() && !pendingCount()) location.reload();
  });
}

// Kein Zoom (Pinch/Doppeltipp), kein Kontextmenü außerhalb von Eingabefeldern
['gesturestart', 'gesturechange', 'gestureend'].forEach((ev) => document.addEventListener(ev, (e) => e.preventDefault(), { passive: false }));
document.addEventListener('contextmenu', (e) => { if (!e.target.closest('input, textarea, [contenteditable]')) e.preventDefault(); });
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => { const n = Date.now(); if (n - lastTouchEnd < 300 && !e.target.closest('input, textarea, select, button, [data-act]')) e.preventDefault(); lastTouchEnd = n; }, { passive: false });

window.__studyloop = { store, ui, sheet };
