// Apple-Integration: Haptik, Zahl am App-Symbol, Kalender-Export (.ics), Glas-Tab-Leiste.
import * as S from './schedule.js';

// ---------------- Haptik ----------------
// iOS Safari gibt beim Umschalten eines <input type="checkbox" switch> ein kurzes haptisches Feedback.
// Wir lösen das nur aus echten Tipps heraus aus. Android/Chrome: Vibration.
let hapticLabel = null;
export function haptic() {
  try {
    if ('vibrate' in navigator && !/iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)) { navigator.vibrate(8); return; }
    if (!hapticLabel) {
      hapticLabel = document.createElement('label');
      hapticLabel.setAttribute('aria-hidden', 'true');
      hapticLabel.style.cssText = 'position:fixed;left:-200px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden';
      const inp = document.createElement('input');
      inp.type = 'checkbox';
      inp.setAttribute('switch', '');
      inp.tabIndex = -1;
      hapticLabel.appendChild(inp);
      document.body.appendChild(hapticLabel);
    }
    hapticLabel.click();
  } catch { /* ohne Haptik weiter */ }
}

// ---------------- Zahl am App-Symbol ----------------
let lastBadge = -1;
export function setBadge(n) {
  try {
    if (!('setAppBadge' in navigator) || n === lastBadge) return;
    if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') return;
    lastBadge = n;
    if (n > 0) navigator.setAppBadge(n).catch(() => {}); else navigator.clearAppBadge?.().catch(() => {});
  } catch { /* egal */ }
}

// ---------------- Kalender-Export (.ics) ----------------
const icsEsc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => '\\' + m);
const dt = (d, t) => `${d.replace(/-/g, '')}T${(t || '00:00').slice(0, 5).replace(':', '')}00`;
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');

function fold(line) {
  const out = [];
  while (line.length > 74) { out.push(line.slice(0, 74)); line = ' ' + line.slice(74); }
  out.push(line);
  return out.join('\r\n');
}

/** events: [{ uid, title, date, start?, end?, endDate?, location?, notes?, alarmMin? }] */
export function buildIcs(events, name = 'Studyloop') {
  const L = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Studyloop//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icsEsc(name)}`, 'X-WR-TIMEZONE:Europe/Berlin',
    'BEGIN:VTIMEZONE', 'TZID:Europe/Berlin',
    'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:MESZ', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
    'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:MEZ', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
    'END:VTIMEZONE',
  ];
  for (const e of events) {
    L.push('BEGIN:VEVENT', `UID:${e.uid}@studyloop`, `DTSTAMP:${stamp()}`);
    if (e.start) {
      L.push(`DTSTART;TZID=Europe/Berlin:${dt(e.date, e.start)}`, `DTEND;TZID=Europe/Berlin:${dt(e.date, e.end || e.start)}`);
    } else {
      L.push(`DTSTART;VALUE=DATE:${e.date.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${S.addDays(e.endDate || e.date, 1).replace(/-/g, '')}`);
    }
    L.push(`SUMMARY:${icsEsc(e.title)}`);
    if (e.location) L.push(`LOCATION:${icsEsc(e.location)}`);
    if (e.notes) L.push(`DESCRIPTION:${icsEsc(e.notes)}`);
    if (e.alarmMin) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(e.title)}`, `TRIGGER:-PT${e.alarmMin}M`, 'END:VALARM');
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

/** Öffnet die .ics-Datei: Teilen-Menü (iPhone/iPad) oder Download. */
export async function shareIcs(filename, text) {
  const file = new File([text], filename, { type: 'text/calendar' });
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: filename }); return 'shared'; }
  } catch (e) { if (e?.name === 'AbortError') return 'aborted'; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  return 'downloaded';
}

// ---------------- Glas-Tab-Leiste mit ziehbarer Linse ----------------
/**
 * bar: <nav class="tabbar"> mit .lens und Buttons [data-tab]
 * onSelect(tab, { fromTab: true }) wird beim Tippen oder Loslassen aufgerufen.
 */
export function bindGlassTabbar(bar, onSelect) {
  const lens = bar.querySelector('.lens');
  const tabs = () => [...bar.querySelectorAll('[data-tab]')];
  let start = null, dragging = false, hoverIdx = -1, suppressClick = false;

  const geom = () => {
    const r = bar.getBoundingClientRect();
    const cs = getComputedStyle(bar);
    const pad = parseFloat(cs.paddingLeft) || 0;
    const inner = r.width - pad - (parseFloat(cs.paddingRight) || 0);
    return { r, pad, w: inner / tabs().length };
  };
  const idxAt = (x) => { const g = geom(); return Math.max(0, Math.min(tabs().length - 1, Math.floor((x - g.r.left - g.pad) / g.w))); };

  bar.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    dragging = false;
    hoverIdx = idxAt(e.clientX);
    bar.classList.add('pressing');
  });
  bar.addEventListener('pointermove', (e) => {
    if (!start || e.pointerId !== start.id) return;
    if (!dragging && Math.abs(e.clientX - start.x) > 8) {
      dragging = true;
      bar.classList.add('dragging');
      try { bar.setPointerCapture(e.pointerId); } catch { /* egal */ }
    }
    if (!dragging) return;
    const g = geom();
    const x = Math.max(0, Math.min(g.r.width - g.pad * 2 - g.w, e.clientX - g.r.left - g.pad - g.w / 2));
    lens.style.transform = `translateX(${x}px)`;
    const i = idxAt(e.clientX);
    if (i !== hoverIdx) {
      hoverIdx = i;
      haptic();
      tabs().forEach((b, k) => b.classList.toggle('hover', k === i));
    }
  });
  const end = (e) => {
    if (!start) return;
    bar.classList.remove('pressing');
    if (dragging) {
      suppressClick = true;
      bar.classList.remove('dragging');
      lens.style.transform = '';
      tabs().forEach((b) => b.classList.remove('hover'));
      const tab = tabs()[idxAt(e.clientX)]?.dataset.tab;
      if (tab) onSelect(tab, { fromTab: false });
      setTimeout(() => { suppressClick = false; }, 50);
    }
    start = null; dragging = false;
  };
  bar.addEventListener('pointerup', end);
  bar.addEventListener('pointercancel', end);
  bar.addEventListener('click', (e) => {
    if (suppressClick) return;
    const b = e.target.closest('[data-tab]');
    if (b) { haptic(); onSelect(b.dataset.tab, { fromTab: true }); }
  });
}

/** Linse auf den aktiven Tab setzen. */
export function placeLens(bar, index) {
  bar.style.setProperty('--i', index);
}
