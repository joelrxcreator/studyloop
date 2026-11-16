// Apple-Integration: Haptik, Zahl am App-Symbol, Kalender-Export (.ics).
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
