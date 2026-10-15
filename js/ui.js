// Bausteine: Formatierung, Sheets, Toast, Bestätigung, Segment-Schalter.
import { icon } from './icons.js';
import * as S from './schedule.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

export const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
export const WD_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const MON = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'];
const MON_LONG = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

const dm = (s) => [Number(s.slice(8, 10)), Number(s.slice(5, 7)) - 1, Number(s.slice(0, 4))];
export function fmtDate(s, { weekday = true, year = false } = {}) {
  const [d, m, y] = dm(s);
  return `${weekday ? WD[S.weekday(s) - 1] + ', ' : ''}${d}. ${MON[m]}${year ? ' ' + y : ''}`;
}
export function fmtDayTitle(s) {
  const [d, m] = dm(s);
  return `${WD_LONG[S.weekday(s) - 1]}, ${d}. ${MON[m]}`;
}
export function fmtLong(s, { weekday = true } = {}) {
  const [d, m] = dm(s);
  return `${weekday ? WD_LONG[S.weekday(s) - 1] + ', ' : ''}${d}. ${MON_LONG[m]}`;
}
export function fmtRange(a, b) {
  const [d1, m1, y1] = dm(a), [d2, m2, y2] = dm(b);
  if (a === b) return `${d1}. ${MON[m1]}`;
  if (m1 === m2 && y1 === y2) return `${d1}.–${d2}. ${MON[m2]}`;
  return `${d1}. ${MON[m1]} – ${d2}. ${MON[m2]}${y1 !== y2 ? ' ' + y2 : ''}`;
}
export const fmtMonth = (s) => { const [, m, y] = dm(s); return `${MON_LONG[m]} ${y}`; };
export function fmtHours(min) {
  const h = Math.round(min / 6) / 10;
  if (min > 0 && h === 0) return '< 0,1 Std.';
  return `${String(h).replace('.', ',')} Std.`;
}
export function relDays(n) {
  if (n === 0) return 'heute';
  if (n === 1) return 'morgen';
  if (n === -1) return 'gestern';
  if (n > 0) return `in ${n} Tagen`;
  return `vor ${-n} Tagen`;
}
export const fmtStars = (v) => (v == null ? '–' : (Math.round(v * 10) / 10).toString().replace('.', ','));
export function miniStars(n) {
  if (n == null) return '';
  let h = '<span class="mini-stars" aria-label="' + n + ' von 5 Sternen">';
  for (let i = 1; i <= 5; i++) h += `<svg viewBox="0 0 24 24" class="${i <= n ? '' : 'off'}"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
  return h + '</span>';
}
export const ring = (p, c) => `<span class="ring ${p >= 100 ? 'done' : ''}" ${c ? `data-c="${c}"` : ''} style="--p:${p}" data-v="${p}"></span>`;

export const COLORS = ['blue', 'orange', 'green', 'purple', 'yellow', 'pink', 'teal', 'slate'];
export const COLOR_NAMES = { blue: 'Blau', orange: 'Orange', green: 'Grün', purple: 'Lila', yellow: 'Gelb', pink: 'Rosa', teal: 'Türkis', slate: 'Grau' };

export function haptic() { try { navigator.vibrate?.(8); } catch { /* egal */ } }

// ---------------- Toast ----------------
let toastEl, toastTimer;
export function toast(msg, { action, error = false, ms = 2600 } = {}) {
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
  toastEl.className = 'toast' + (error ? ' err' : '');
  toastEl.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  if (action) toastEl.querySelector('button').onclick = () => { hide(); action.fn(); };
  requestAnimationFrame(() => toastEl.classList.add('show'));
  clearTimeout(toastTimer);
  const hide = () => toastEl.classList.remove('show');
  toastTimer = setTimeout(hide, action ? Math.max(ms, 4500) : ms);
}

// ---------------- Sheets ----------------
const sheets = [];
export const openSheets = () => sheets.length;

/**
 * Öffnet ein Sheet von unten.
 * render(body, api) füllt den Inhalt. api.close() schließt.
 */
export function sheet({ title = '', render, full = false, onClose, primary = null, bare = false, done = 'Fertig' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.style.zIndex = 60 + sheets.length * 2;
  const left = primary ? '<button class="nav-btn" data-close>Abbrechen</button>' : '';
  const right = bare ? '' : primary ? `<button class="nav-btn bold" data-primary>${esc(primary)}</button>` : `<button class="nav-btn bold" data-close>${esc(done)}</button>`;
  wrap.innerHTML = `
    <div class="sheet-backdrop"></div>
    <section class="sheet ${full ? 'full' : ''} ${primary ? 'has-primary' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="grab"></div>
      <header class="sheet-h"><div class="l">${left}</div><h2>${esc(bare ? '' : title)}</h2><div class="r">${right}</div></header>
      <div class="sheet-b"></div>
    </section>`;
  document.body.appendChild(wrap);
  const el = wrap.querySelector('.sheet');
  const body = wrap.querySelector('.sheet-b');
  let closed = false;
  const api = {
    el, body, wrap,
    setTitle(t) { wrap.querySelector('.sheet-h h2').textContent = t; },
    close(result) {
      if (closed) return;
      closed = true;
      document.activeElement?.blur?.();
      wrap.classList.remove('open');
      sheets.splice(sheets.indexOf(api), 1);
      setTimeout(() => wrap.remove(), 420);
      onClose?.(result);
    },
  };
  sheets.push(api);
  wrap.querySelector('.sheet-backdrop').addEventListener('click', () => api.close());
  wrap.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => api.close()));
  wrap.querySelector('[data-primary]')?.addEventListener('click', () => body.querySelector('[data-save]')?.click());
  render(body, api);
  // Nach unten wischen schließt
  let y0 = null, dy = 0, fromBody = false;
  const start = (e) => {
    const t = e.target;
    fromBody = !t.closest('.sheet-h');
    if (t.closest('button') && !fromBody) { /* Kopf-Buttons: Wischen trotzdem erlaubt */ }
    if (fromBody && (body.scrollTop > 0 || t.closest('input, textarea, select, .range, .stars, .seg, .swatches, .chips'))) { y0 = null; return; }
    y0 = e.touches[0].clientY; dy = 0;
  };
  const move = (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    if (dy > 4) { el.style.transition = 'none'; el.style.transform = `translateY(${dy}px)`; if (e.cancelable) e.preventDefault(); }
  };
  const end = () => {
    if (y0 == null) return;
    el.style.transition = ''; y0 = null;
    if (dy > 110) api.close(); else el.style.transform = '';
  };
  el.addEventListener('touchstart', start, { passive: true });
  el.addEventListener('touchmove', move, { passive: false });
  el.addEventListener('touchend', end);
  requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('open')));
  fitViewport();
  return api;
}

export function closeAllSheets() { [...sheets].reverse().forEach((s) => s.close()); }
export function topSheet() { return sheets[sheets.length - 1]; }

// Tastatur auf dem iPhone: Sheet an sichtbaren Bereich anpassen, aktives Feld sichtbar halten
function fitViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const h = vv.height, top = vv.offsetTop;
  for (const s of sheets) { s.wrap.style.height = h + 'px'; s.wrap.style.top = top + 'px'; s.wrap.style.bottom = 'auto'; }
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', fitViewport);
  window.visualViewport.addEventListener('scroll', fitViewport);
}
document.addEventListener('focusin', (e) => {
  if (e.target.matches('input, textarea, select') && e.target.closest('.sheet')) setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheets.length) sheets[sheets.length - 1].close(); });

// ---------------- Bestätigen ----------------
export function confirmDialog({ title, text, confirm = 'OK', cancel = 'Abbrechen', danger = false, typeWord = null }) {
  return new Promise((resolve) => {
    let done = false;
    sheet({
      title, bare: true,
      onClose: () => { if (!done) resolve(false); },
      render(b, api) {
        b.innerHTML = `
          <div class="form" style="gap:10px">
            <div class="alert-text"><h3>${esc(title)}</h3>${text ? `<p>${text}</p>` : ''}</div>
            ${typeWord ? `<label class="field" style="margin-bottom:6px"><span>Zum Bestätigen „${esc(typeWord)}“ eingeben</span><input autocomplete="off" autocapitalize="characters" spellcheck="false" data-word></label>` : ''}
            <button class="btn ${danger ? 'danger' : 'primary'}" data-yes ${typeWord ? 'disabled' : ''} style="${danger ? 'font-weight:600' : ''}">${esc(confirm)}</button>
            <button class="btn" data-no style="background:var(--bg2)">${esc(cancel)}</button>
          </div>`;
        const yes = b.querySelector('[data-yes]');
        if (typeWord) b.querySelector('[data-word]').addEventListener('input', (e) => { yes.disabled = e.target.value.trim().toUpperCase() !== typeWord; });
        b.querySelector('[data-no]').onclick = () => api.close();
        yes.onclick = () => { done = true; resolve(true); api.close(); };
      },
    });
  });
}

// ---------------- Segment-Schalter ----------------
export function seg(name, options, value) {
  return `<div class="seg" role="group" data-seg="${name}">${options.map(([v, l]) => `<button type="button" data-v="${esc(v)}" aria-pressed="${String(v) === String(value)}">${esc(l)}</button>`).join('')}</div>`;
}
/** Verdrahtet alle Segment-Schalter in el; onChange(name, value). */
export function bindSegs(el, onChange) {
  el.querySelectorAll('[data-seg]').forEach((g) => {
    g.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      g.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      onChange(g.dataset.seg, b.dataset.v);
    });
  });
}
export const segValue = (el, name) => el.querySelector(`[data-seg="${name}"] [aria-pressed="true"]`)?.dataset.v;

export const sw = (name, checked, label = '') => `<label class="switch"><input type="checkbox" data-sw="${name}" ${checked ? 'checked' : ''} aria-label="${esc(label)}"><span></span></label>`;

export function download(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ---------------- Navigationsleiste & großer Titel ----------------
export function navBar({ title = '', left = '', right = '' } = {}) {
  return `<header class="nav"><div class="nav-l">${left}</div><div class="nav-title">${esc(title)}</div><div class="nav-r">${right}</div></header>`;
}
export function largeTitle(title, sub = '', extra = '') {
  return `<div class="lt"><div class="lt-row"><h1>${esc(title)}</h1>${extra}</div>${sub ? `<p class="lt-sub">${sub}</p>` : ''}</div>`;
}
export const backBtn = (label = 'Zurück') => `<button class="nav-btn back" data-act="back">${icon('left')}${esc(label)}</button>`;

// ---------------- Einmalige Tipps ----------------
export function tipSeen(id) { try { return localStorage.getItem('sl.tip.' + id) === '1'; } catch { return true; } }
export function tipDismiss(id) { try { localStorage.setItem('sl.tip.' + id, '1'); } catch { /* egal */ } }
export function tip(id, ic, title, text) {
  if (tipSeen(id)) return '';
  return `<div class="tip"><span class="sq indigo">${icon(ic)}</span><div><b>${esc(title)}</b><p>${text}</p></div><button class="x" data-act="tip" data-id="${id}" aria-label="Tipp schließen">${icon('x')}</button></div>`;
}
