// Einstellungen-Seite.
import * as S from './schedule.js';
import { store, sb, putSettings, exportData, importData, clearLocal, pendingCount } from './store.js';
import { icon } from './icons.js';
import { esc, sheet, toast, confirmDialog, seg, bindSegs, sw, download } from './ui.js';
import { currentSemester } from './ctx.js';
import { pushState, enablePush, disablePush, testPush, pushLog, deviceSubscribed } from './push.js';
import { APP_VERSION } from './config.js';

const OFFSETS = [10080, 1440, 180, 60, 30];

export function getTheme() { try { return localStorage.getItem('sl.theme') || 'auto'; } catch { return 'auto'; } }
export function setTheme(v) {
  try { localStorage.setItem('sl.theme', v); } catch { /* egal */ }
  const root = document.documentElement;
  if (v === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', v);
  const dark = v === 'dark' || (v === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0a0f1a' : '#f2f3f8');
}

let subscribedCache = null;

export function renderSettings(el, rerender) {
  const st = store.settings;
  const ps = pushState();
  const sem = currentSemester();
  if (subscribedCache === null) deviceSubscribed().then((v) => { subscribedCache = v; rerender(); });
  const active = ps.permission === 'granted' && subscribedCache;

  let pushBlock;
  if (!ps.supported && ps.ios && !ps.standalone) {
    pushBlock = `<div class="banner accent" style="align-items:flex-start">${icon('share')}<span><b>Erst zum Home-Bildschirm hinzufügen</b><br>Mitteilungen gehen auf dem iPhone nur, wenn Studyloop vom Home-Bildschirm geöffnet wird: In Safari auf <b>Teilen</b> tippen → <b>„Zum Home-Bildschirm“</b>. Dann von dort öffnen und hier erlauben.</span></div>`;
  } else if (!ps.supported) {
    pushBlock = `<div class="banner amber">${icon('alert')}<span>Dieser Browser unterstützt keine Mitteilungen.</span></div>`;
  } else if (ps.permission === 'denied') {
    pushBlock = `<div class="banner red" style="align-items:flex-start">${icon('bellOff')}<span><b>Mitteilungen sind blockiert.</b><br>Erlaube sie in den iPhone-Einstellungen → <b>Mitteilungen</b> → <b>Studyloop</b>. Danach die App neu öffnen.</span></div>`;
  } else if (!active) {
    pushBlock = `<button class="btn primary" data-act="pushOn">${icon('bell', 'sm')}Mitteilungen erlauben</button>`;
  } else {
    pushBlock = `<div class="btn-row"><button class="btn" data-act="pushTest">${icon('send', 'sm')}Test senden</button><button class="btn" data-act="pushOff">Ausschalten</button></div>`;
  }

  el.innerHTML = `<div class="wrap">
    <div class="topbar"><button class="back" data-act="back">${icon('left')}Zurück</button></div>
    <h1 class="title-xl">Einstellungen</h1>

    <div class="section-h"><h2>Mitteilungen</h2></div>
    <div class="list">
      <div class="row"><span class="ibox ${active ? 'green' : ''}">${icon(active ? 'bell' : 'bellOff')}</span><span class="main"><span class="t" style="display:block">Auf diesem Gerät</span>
        <span class="s" style="display:block">${active ? 'Aktiv – auch wenn die App geschlossen ist' : ps.permission === 'denied' ? 'Blockiert' : 'Aus'}</span></span></div>
    </div>
    <div style="margin-top:var(--s2)">${pushBlock}</div>
    <div class="card pad" style="margin-top:var(--s3)">
      <div class="label" style="margin-bottom:8px">Erinnern vor Pflichtterminen & Prüfungen</div>
      <div class="chips">${OFFSETS.map((o) => `<button class="pill-toggle" data-act="offset" data-v="${o}" aria-pressed="${st.offsets.includes(o)}">${S.offsetLabel(o)}</button>`).join('')}</div>
      <p class="hint" style="margin:8px 0 0">${st.offsets.length ? 'Du bekommst eine Mitteilung ' + st.offsets.map(S.offsetLabel).join(' und ') + ' vor Beginn.' : 'Keine Erinnerungen vor Pflichtterminen.'}</p>
    </div>
    <div class="list" style="margin-top:var(--s3)">
      <label class="row"><span class="main"><span class="t" style="display:block">Prüfungen zusätzlich 1 Woche vorher</span></span>${sw('examWeek', st.examWeek)}</label>
      <label class="row"><span class="main"><span class="t" style="display:block">Ruhezeit</span><span class="s" style="display:block">Nachts nichts – Erinnerungen kommen dann vorher oder danach</span></span>${sw('quiet', st.quiet.on)}</label>
      <div class="row" ${st.quiet.on ? '' : 'hidden'}><div class="grid2" style="flex:1"><label class="field"><span>Von</span><input type="time" data-q="from" value="${st.quiet.from}"></label><label class="field"><span>Bis</span><input type="time" data-q="to" value="${st.quiet.to}"></label></div></div>
      <button class="row" data-act="pushLog"><span class="main"><span class="t">Protokoll</span></span>${icon('right', 'sm chev')}</button>
    </div>

    <div class="section-h"><h2>Studium</h2></div>
    <div class="list">
      <button class="row" data-act="editTT"><span class="ibox">${icon('grid')}</span><span class="main"><span class="t">Stundenplan bearbeiten</span></span>${icon('right', 'sm chev')}</button>
      ${sem ? `<button class="row" data-act="editSemester" data-id="${sem.id}"><span class="ibox">${icon('cal')}</span><span class="main"><span class="t" style="display:block">${esc(sem.name)}</span><span class="s" style="display:block">Wochen, Ferien, Zeitraum</span></span>${icon('right', 'sm chev')}</button>` : ''}
      <label class="row"><span class="ibox">${icon('repeat')}</span><span class="main"><span class="t" style="display:block">Offen zählen ab</span><span class="s" style="display:block">${st.trackFrom ? 'Frühere Termine nur, wenn eingetragen' : 'Seit Semesterbeginn'}</span></span><input type="date" data-trackfrom value="${st.trackFrom || ''}" style="width:150px;flex:none" aria-label="Offen zählen ab"></label>
      <button class="row" data-act="newSemester"><span class="ibox">${icon('plus')}</span><span class="main"><span class="t">Neues Semester anlegen</span></span>${icon('right', 'sm chev')}</button>
    </div>

    <div class="section-h"><h2>Darstellung</h2></div>
    ${seg('theme', [['auto', 'Automatisch'], ['light', 'Hell'], ['dark', 'Dunkel']], getTheme())}

    <div class="section-h"><h2>Daten</h2></div>
    <div class="list">
      <button class="row" data-act="export"><span class="ibox">${icon('download')}</span><span class="main"><span class="t" style="display:block">Sicherung exportieren</span><span class="s" style="display:block">Alle Daten als Datei</span></span></button>
      <label class="row" style="cursor:pointer"><span class="ibox">${icon('upload')}</span><span class="main"><span class="t" style="display:block">Sicherung einspielen</span><span class="s" style="display:block">Ergänzt/überschreibt mit der Datei</span></span><input type="file" accept="application/json,.json" data-import hidden></label>
    </div>

    <div class="section-h"><h2>Konto</h2></div>
    <div class="list">
      <div class="row"><span class="ibox">${icon('user')}</span><span class="main"><span class="t" style="display:block">${esc(store.user?.email || '')}</span><span class="s" style="display:block">Deine Daten sind auf jedem Gerät verfügbar</span></span></div>
      <button class="row" data-act="password"><span class="ibox">${icon('lock')}</span><span class="main"><span class="t">Passwort ändern</span></span>${icon('right', 'sm chev')}</button>
      <button class="row" data-act="logout"><span class="ibox">${icon('logout')}</span><span class="main"><span class="t">Abmelden</span></span></button>
      <button class="row danger" data-act="deleteAccount"><span class="ibox red">${icon('trash')}</span><span class="main"><span class="t">Konto löschen</span></span></button>
    </div>
    <p class="foot-note">Studyloop ${APP_VERSION}</p>
  </div>`;

  bindSegs(el, (name, v) => { if (name === 'theme') setTheme(v); });
  el.querySelector('[data-trackfrom]').addEventListener('change', (e) => putSettings({ trackFrom: e.target.value || null }));
  el.querySelector('[data-sw="examWeek"]').addEventListener('change', (e) => putSettings({ examWeek: e.target.checked }));
  el.querySelector('[data-sw="quiet"]').addEventListener('change', (e) => putSettings({ quiet: { ...store.settings.quiet, on: e.target.checked } }));
  el.querySelectorAll('[data-q]').forEach((i) => i.addEventListener('change', () => { if (/^\d\d:\d\d$/.test(i.value)) putSettings({ quiet: { ...store.settings.quiet, [i.dataset.q]: i.value } }); }));
  el.querySelector('[data-import]').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let json;
    try { json = JSON.parse(await file.text()); } catch { toast('Die Datei ist keine gültige Sicherung.', { error: true }); return; }
    if (json?.app !== 'studyloop') { toast('Das ist keine Studyloop-Sicherung.', { error: true }); return; }
    if (!(await confirmDialog({ title: 'Sicherung einspielen?', text: `Stand: ${esc(String(json.exported_at || '').slice(0, 10))}. Einträge mit gleicher ID werden mit der Sicherung überschrieben, alles andere bleibt.`, confirm: 'Einspielen' }))) return;
    try { const n = importData(json); toast(`${n} Einträge übernommen`); } catch (err) { toast(err.message, { error: true }); }
  });
}

export async function settingsAction(act, btn, rerender) {
  if (act === 'pushOn') {
    btn.classList.add('busy');
    try {
      const r = await enablePush();
      subscribedCache = r.ok;
      if (r.ok) toast('Mitteilungen sind an');
      else if (r.permission === 'denied') toast('Mitteilungen wurden abgelehnt.', { error: true });
    } catch (e) { toast('Konnte Mitteilungen nicht einschalten: ' + e.message, { error: true }); }
    rerender();
  } else if (act === 'pushOff') {
    await disablePush(); subscribedCache = false; toast('Mitteilungen auf diesem Gerät aus'); rerender();
  } else if (act === 'pushTest') {
    btn.classList.add('busy');
    const r = await testPush().catch((e) => ({ delivered: 0, error: e.message }));
    btn.classList.remove('busy');
    if (r?.delivered) toast(`Test an ${r.delivered} ${r.delivered === 1 ? 'Gerät' : 'Geräte'} geschickt`);
    else toast('Test fehlgeschlagen: ' + (r?.error || 'unbekannt'), { error: true, ms: 5000 });
  } else if (act === 'offset') {
    const v = Number(btn.dataset.v);
    const cur = store.settings.offsets;
    putSettings({ offsets: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] });
  } else if (act === 'pushLog') {
    sheet({
      title: 'Protokoll',
      render: async (b) => {
        b.innerHTML = '<div class="skel" style="height:120px"></div>';
        try {
          const log = await pushLog();
          b.innerHTML = log.length ? `<div class="list">${log.map((l) => `<div class="logline ${l.level}"><time>${new Date(l.at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</time>${esc(l.message)}</div>`).join('')}</div>`
            : '<div class="empty"><p>Noch keine Einträge. Hier erscheinen Tests und Probleme beim Zustellen.</p></div>';
        } catch (e) { b.innerHTML = `<div class="err">Konnte nicht geladen werden: ${esc(e.message)}</div>`; }
      },
    });
  } else if (act === 'export') {
    download(`studyloop-sicherung-${S.localDate()}.json`, JSON.stringify(exportData(), null, 1));
    toast('Sicherung gespeichert');
  } else if (act === 'password') {
    sheet({
      title: 'Passwort ändern',
      render(b, api) {
        b.innerHTML = `<div class="form"><label class="field"><span>Neues Passwort</span><div class="pw"><input type="password" data-p autocomplete="new-password" minlength="6"><button type="button" data-eye aria-label="Passwort zeigen">${icon('eye')}</button></div></label>
          <div data-err></div><button class="btn primary" data-save>Speichern</button></div>`;
        const inp = b.querySelector('[data-p]');
        b.querySelector('[data-eye]').onclick = () => { inp.type = inp.type === 'password' ? 'text' : 'password'; };
        b.querySelector('[data-save]').onclick = async (e) => {
          if (inp.value.length < 6) { b.querySelector('[data-err]').innerHTML = '<div class="err">Mindestens 6 Zeichen.</div>'; return; }
          e.target.classList.add('busy');
          const { error } = await sb.auth.updateUser({ password: inp.value });
          e.target.classList.remove('busy');
          if (error) { b.querySelector('[data-err]').innerHTML = `<div class="err">${esc(authError(error))}</div>`; return; }
          toast('Passwort geändert'); api.close();
        };
      },
    });
  } else if (act === 'logout') {
    const n = pendingCount();
    if (!(await confirmDialog({ title: 'Abmelden?', text: n ? `<b>${n} Änderung(en) sind noch nicht gespeichert</b> (keine Verbindung). Wenn du dich jetzt abmeldest, gehen sie verloren.` : 'Deine Daten bleiben im Konto gespeichert. Mitteilungen kommen auf diesem Gerät dann nicht mehr.', confirm: 'Abmelden', danger: !!n }))) return;
    await disablePush();
    subscribedCache = null;
    clearLocal();
    await sb.auth.signOut({ scope: 'local' }).catch(() => {});
    try { localStorage.removeItem('sl.auth'); } catch { /* egal */ }
    location.reload();
  } else if (act === 'deleteAccount') {
    if (!(await confirmDialog({ title: 'Konto endgültig löschen?', text: 'Alle Semester, Fächer, Termine, Einträge und Prüfungen werden gelöscht. Das lässt sich nicht rückgängig machen. Tipp: vorher eine Sicherung exportieren.', confirm: 'Konto löschen', danger: true, typeWord: 'LÖSCHEN' }))) return;
    const { data, error } = await sb.functions.invoke('reminders', { body: { action: 'delete_account' } });
    if (error || !data?.deleted) { toast('Löschen fehlgeschlagen. Bitte später erneut versuchen.', { error: true }); return; }
    await disablePush();
    clearLocal();
    await sb.auth.signOut({ scope: 'local' }).catch(() => {});
    try { localStorage.removeItem('sl.auth'); } catch { /* egal */ }
    location.reload();
  } else return false;
  return true;
}

export function authError(e) {
  const m = String(e?.message || e || '');
  if (/invalid login credentials/i.test(m)) return 'E-Mail oder Passwort stimmt nicht.';
  if (/email not confirmed/i.test(m)) return 'Bitte bestätige zuerst deine E-Mail-Adresse (Link im Postfach).';
  if (/already registered|already been registered/i.test(m)) return 'Für diese E-Mail gibt es schon ein Konto. Melde dich an.';
  if (/at least 6|password should be/i.test(m)) return 'Das Passwort muss mindestens 6 Zeichen haben.';
  if (/different from the old/i.test(m)) return 'Das neue Passwort muss sich vom alten unterscheiden.';
  if (/rate limit|too many|security purposes/i.test(m)) return 'Zu viele Versuche. Bitte warte kurz und versuche es dann erneut.';
  if (/invalid format|valid email|email address .* invalid/i.test(m)) return 'Bitte gib eine gültige E-Mail-Adresse ein.';
  if (/signups not allowed|signup.*disabled/i.test(m)) return 'Registrieren ist gerade nicht möglich.';
  if (/fetch|network|load failed/i.test(m)) return 'Keine Verbindung. Prüfe dein Internet.';
  if (/weak|pwned/i.test(m)) return 'Dieses Passwort ist zu unsicher. Bitte wähle ein anderes.';
  return 'Das hat nicht geklappt: ' + m;
}
