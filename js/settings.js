// Einstellungen-Seite.
import * as S from './schedule.js';
import { store, sb, putSettings, exportData, importData, clearLocal, pendingCount } from './store.js';
import { icon } from './icons.js';
import { esc, sheet, toast, confirmDialog, seg, bindSegs, sw, download, navBar, largeTitle, backBtn } from './ui.js';
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
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#000000' : '#f2f2f7');
}

let subscribedCache = null;

export function renderSettings(el, rerender) {
  const st = store.settings;
  const ps = pushState();
  const sem = currentSemester();
  if (subscribedCache === null) deviceSubscribed().then((v) => { subscribedCache = v; rerender(); });
  const active = ps.permission === 'granted' && subscribedCache;

  let pushRows, pushFoot;
  if (!ps.supported && ps.ios && !ps.standalone) {
    pushRows = `<div class="cell ic"><span class="sq gray">${icon('bellOff')}</span><span class="main"><span class="t">Mitteilungen</span></span><span class="v">Nicht verfügbar</span></div>`;
    pushFoot = `Auf dem iPhone gibt es Mitteilungen nur, wenn Studyloop vom Home-Bildschirm geöffnet wird: In Safari auf Teilen tippen → „Zum Home-Bildschirm“, dann von dort öffnen.`;
  } else if (!ps.supported) {
    pushRows = `<div class="cell ic"><span class="sq gray">${icon('bellOff')}</span><span class="main"><span class="t">Mitteilungen</span></span><span class="v">Nicht unterstützt</span></div>`;
    pushFoot = 'Dieser Browser unterstützt keine Mitteilungen.';
  } else if (ps.permission === 'denied') {
    pushRows = `<div class="cell ic"><span class="sq red">${icon('bellOff')}</span><span class="main"><span class="t">Mitteilungen</span></span><span class="v">Blockiert</span></div>`;
    pushFoot = 'Erlaube sie in den iPhone-Einstellungen → Mitteilungen → Studyloop und öffne die App danach neu.';
  } else if (!active) {
    pushRows = `<button class="cell ic" data-act="pushOn"><span class="sq red">${icon('bell')}</span><span class="main"><span class="t accent-t">Mitteilungen erlauben</span></span></button>`;
    pushFoot = 'Damit du vor Pflichtterminen, Fristen und Prüfungen erinnert wirst – auch wenn die App geschlossen ist.';
  } else {
    pushRows = `<div class="cell ic"><span class="sq red">${icon('bell')}</span><span class="main"><span class="t">Mitteilungen</span></span><span class="v">An</span></div>
      <button class="cell" data-act="pushTest"><span class="main"><span class="t accent-t">Test-Mitteilung senden</span></span></button>
      <button class="cell" data-act="pushOff"><span class="main"><span class="t accent-t">Auf diesem Gerät ausschalten</span></span></button>`;
    pushFoot = 'Kommt auch, wenn die App geschlossen ist.';
  }

  el.innerHTML = `
    ${navBar({ title: 'Einstellungen', left: backBtn() })}
    ${largeTitle('Einstellungen')}
    <div class="wrap">
    <div class="group" style="margin-top:8px">${pushRows}</div>
    <div class="gf">${pushFoot}</div>

    <div class="gh">Erinnern vor Pflichtterminen & Prüfungen</div>
    <div class="group"><div class="cell"><div class="chips" style="flex:1">${OFFSETS.map((o) => `<button class="pill-toggle" data-act="offset" data-v="${o}" aria-pressed="${st.offsets.includes(o)}">${S.offsetLabel(o)}</button>`).join('')}</div></div></div>
    <div class="gf">${st.offsets.length ? 'Erinnerung ' + st.offsets.map(S.offsetLabel).join(' und ') + ' vor Beginn.' : 'Keine Erinnerungen vor Pflichtterminen.'}</div>
    <div class="group" style="margin-top:16px">
      <label class="cell"><span class="main"><span class="t">Prüfungen 1 Woche vorher</span></span>${sw('examWeek', st.examWeek)}</label>
      <label class="cell"><span class="main"><span class="t">Nachtruhe</span></span>${sw('quiet', st.quiet.on)}</label>
      <div class="cell" ${st.quiet.on ? '' : 'hidden'}><div class="grid2" style="flex:1"><label class="field"><span>Von</span><input type="time" data-q="from" value="${st.quiet.from}" style="background:var(--fill)"></label><label class="field"><span>Bis</span><input type="time" data-q="to" value="${st.quiet.to}" style="background:var(--fill)"></label></div></div>
      <button class="cell" data-act="pushLog"><span class="main"><span class="t">Verlauf</span></span>${icon('right', 'chev')}</button>
    </div>
    <div class="gf">In der Nachtruhe kommt nichts – die Erinnerung kommt dann vorher oder am Morgen.</div>

    <div class="gh">Studium</div>
    <div class="group">
      <button class="cell ic" data-act="editTT"><span class="sq indigo">${icon('grid')}</span><span class="main"><span class="t">Stundenplan</span></span>${icon('right', 'chev')}</button>
      ${sem ? `<button class="cell ic" data-act="editSemester" data-id="${sem.id}"><span class="sq blue">${icon('cal')}</span><span class="main"><span class="t">Semester</span></span><span class="v">${esc(sem.name)}</span>${icon('right', 'chev')}</button>` : ''}
      <label class="cell ic"><span class="sq orange">${icon('repeat')}</span><span class="main"><span class="t">Offen zählen ab</span></span><input type="date" data-trackfrom value="${st.trackFrom || ''}" style="width:150px;flex:none;background:var(--fill);height:36px;line-height:36px" aria-label="Offen zählen ab"></label>
      <button class="cell ic" data-act="newSemester"><span class="sq green">${icon('plus')}</span><span class="main"><span class="t">Neues Semester</span></span>${icon('right', 'chev')}</button>
    </div>
    <div class="gf">${st.trackFrom ? 'Termine vor diesem Datum zählen nur als offen, wenn du sie eingetragen hast.' : 'Alle Termine seit Semesterbeginn zählen als offen, bis du sie einträgst.'}</div>

    <div class="gh">Darstellung</div>
    <div class="group"><div class="cell">${seg('theme', [['auto', 'Automatisch'], ['light', 'Hell'], ['dark', 'Dunkel']], getTheme()).replace('class="seg"', 'class="seg" style="flex:1"')}</div></div>

    <div class="gh">Daten</div>
    <div class="group">
      <button class="cell ic" data-act="export"><span class="sq gray">${icon('download')}</span><span class="main"><span class="t">Sicherung exportieren</span></span></button>
      <label class="cell ic" style="cursor:pointer"><span class="sq gray">${icon('upload')}</span><span class="main"><span class="t">Sicherung einspielen</span></span><input type="file" accept="application/json,.json" data-import hidden></label>
    </div>
    <div class="gf">Deine Daten liegen sicher in deinem Konto. Eine Sicherungsdatei ist ein zusätzlicher Schutz.</div>

    <div class="gh">Konto</div>
    <div class="group">
      <div class="cell ic"><span class="sq teal">${icon('user')}</span><span class="main"><span class="t">${esc(store.user?.email || '')}</span></span></div>
      <button class="cell" data-act="password"><span class="main"><span class="t accent-t">Passwort ändern</span></span></button>
      <button class="cell" data-act="logout"><span class="main"><span class="t accent-t">Abmelden</span></span></button>
    </div>
    <div class="group" style="margin-top:22px"><button class="cell danger" data-act="deleteAccount"><span class="main"><span class="t">Konto löschen</span></span></button></div>
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
      title: 'Verlauf',
      render: async (b) => {
        b.innerHTML = '<div class="skel" style="height:120px"></div>';
        try {
          const log = await pushLog();
          b.innerHTML = log.length ? `<div class="group">${log.map((l) => `<div class="logline ${l.level}"><time>${new Date(l.at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</time>${esc(l.message)}</div>`).join('')}</div>`
            : '<div class="empty"><p>Noch keine Einträge. Hier erscheinen Tests und Probleme beim Zustellen.</p></div>';
        } catch (e) { b.innerHTML = `<div class="err">Konnte nicht geladen werden: ${esc(e.message)}</div>`; }
      },
    });
  } else if (act === 'export') {
    download(`studyloop-sicherung-${S.localDate()}.json`, JSON.stringify(exportData(), null, 1));
    toast('Sicherung gespeichert');
  } else if (act === 'password') {
    sheet({
      title: 'Passwort ändern', primary: 'Sichern',
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
