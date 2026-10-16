// Mitteilungszentrale: alle Erinnerungen, die verschickt wurden – gelesen/ungelesen, auf allen Geräten gleich.
import * as S from './schedule.js';
import { notifications, unreadCount, markRead, removeNotifications } from './store.js';
import { icon } from './icons.js';
import { esc, fmtDate, navBar, largeTitle, backBtn } from './ui.js';
import { today } from './ctx.js';

/** Glocke für die Navigationsleiste – mit roter Zahl, solange etwas ungelesen ist. */
export function bellBtn() {
  const n = unreadCount();
  return `<button class="nav-btn bell" data-act="inbox" aria-label="Mitteilungen${n ? `, ${n} ungelesen` : ''}">${icon('bell')}${n ? `<span class="nb">${n > 99 ? '99+' : n}</span>` : ''}</button>`;
}

const kindOf = (key = '') => (key.startsWith('o|') ? ['indigo', 'cal'] : key.startsWith('e|') ? ['orange', 'cap'] : ['red', 'bell']);
const pad = (n) => String(n).padStart(2, '0');
function localParts(iso) {
  const d = new Date(iso);
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}
function dayLabel(date) {
  const diff = S.diffDays(date, today());
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Gestern';
  if (diff < 7) return fmtDate(date).replace(/^(\w+),.*$/, (m, wd) => ({ Mo: 'Montag', Di: 'Dienstag', Mi: 'Mittwoch', Do: 'Donnerstag', Fr: 'Freitag', Sa: 'Samstag', So: 'Sonntag' }[wd] || m));
  return fmtDate(date, { year: date.slice(0, 4) !== today().slice(0, 4) });
}

/** Mitteilungen ausblenden, die noch in der Mitteilungszentrale von iOS liegen. */
export async function clearSystemNotifications() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const list = (await reg?.getNotifications?.()) || [];
    list.forEach((n) => n.close());
  } catch { /* egal */ }
}

/**
 * Seite „Mitteilungen“. Beim Öffnen werden alle als gelesen markiert (die Zahl am App-Symbol verschwindet),
 * die neuen bleiben auf dieser Seite aber noch mit blauem Punkt markiert.
 */
export function inboxPage() {
  const fresh = new Set(notifications().filter((n) => !n.read_at).map((n) => n.id));
  let marked = false;
  return (el) => {
    const list = notifications();
    const groups = new Map();
    for (const n of list) {
      const p = localParts(n.created_at);
      if (!groups.has(p.date)) groups.set(p.date, []);
      groups.get(p.date).push({ n, time: p.time });
    }
    const rows = (items) => items.map(({ n, time }) => {
      const [c, ic] = kindOf(n.key);
      const isNew = fresh.has(n.id);
      return `<div class="nrow-wrap" data-nid="${n.id}">
        <button class="nrow-del" data-act="delNotif" data-id="${n.id}" tabindex="-1">${icon('trash')}<span>Löschen</span></button>
        <button class="cell ic nrow${isNew ? ' new' : ''}" data-act="openNotif" data-id="${n.id}">
          <span class="udot" aria-hidden="true"></span><span class="sq ${c}">${icon(ic)}</span>
          <span class="main"><span class="t">${esc(n.title)}</span>${n.body ? `<span class="s">${esc(n.body)}</span>` : ''}</span>
          <span class="ntime">${time}</span>
        </button></div>`;
    }).join('');

    el.innerHTML = `
      ${navBar({ title: 'Mitteilungen', left: backBtn() })}
      ${largeTitle('Mitteilungen', list.length ? (fresh.size ? `${fresh.size} neu` : 'Alles gelesen') : '')}
      <div class="wrap inbox">
      ${list.length ? [...groups].map(([d, items]) => `<div class="gh">${dayLabel(d)}</div><div class="group">${rows(items)}</div>`).join('')
        + `<div class="gf">Zum Löschen nach links wischen. Mitteilungen werden nach 60 Tagen automatisch entfernt.</div>
           <div class="group" style="margin-top:22px"><button class="cell danger" data-act="clearNotifs"><span class="main"><span class="t">Alle löschen</span></span></button></div>`
        : `<div class="empty" style="padding-top:60px">${icon('bell')}<h3>Keine Mitteilungen</h3><p>Erinnerungen an Pflichttermine, Fristen und Prüfungen findest du hier – auch wenn du sie auf dem Sperrbildschirm verpasst hast.</p></div>`}
      </div>`;
    bindSwipe(el);
    if (!marked) {
      marked = true;
      markRead(list);
      clearSystemNotifications();
    }
  };
}

// Nach links wischen → „Löschen“ (wie in Mail); ganz durchwischen löscht direkt.
function bindSwipe(el) {
  const W = 88;
  let cur = null;
  const close = (w) => { if (!w) return; w.classList.remove('open'); w.querySelector('.nrow').style.transform = ''; };
  el.querySelectorAll('.nrow-wrap').forEach((w) => {
    const row = w.querySelector('.nrow');
    let x0 = null, y0 = 0, dx = 0, base = 0, horiz = null;
    row.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      if (cur && cur !== w) { close(cur); cur = null; }
      x0 = e.clientX; y0 = e.clientY; dx = 0; horiz = null; base = w.classList.contains('open') ? -W : 0;
    });
    row.addEventListener('pointermove', (e) => {
      if (x0 == null) return;
      const mx = e.clientX - x0, my = e.clientY - y0;
      if (horiz == null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) horiz = Math.abs(mx) > Math.abs(my);
      if (!horiz) return;
      dx = Math.min(0, base + mx);
      row.style.transition = 'none';
      row.style.transform = `translateX(${dx}px)`;
      w.classList.toggle('full', dx < -w.offsetWidth * 0.55);
    });
    const end = () => {
      if (x0 == null) return;
      x0 = null;
      row.style.transition = '';
      if (!horiz) return;
      w.dataset.swiped = '1';
      setTimeout(() => { delete w.dataset.swiped; }, 50);
      if (dx < -w.offsetWidth * 0.55) { w.querySelector('.nrow-del').click(); return; }
      if (dx < -W / 2) { w.classList.add('open'); row.style.transform = `translateX(${-W}px)`; cur = w; } else close(w);
      w.classList.remove('full');
    };
    row.addEventListener('pointerup', end);
    row.addEventListener('pointercancel', end);
  });
}

export function deleteNotif(id) {
  const n = notifications().find((x) => x.id === id);
  if (n) removeNotifications([n]);
}
