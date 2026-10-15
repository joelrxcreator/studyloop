// Willkommen, Anmeldung, Passwort vergessen, erstes Einrichten.
import { sb, putSettings } from './store.js';
import { icon } from './icons.js';
import { esc, sheet, toast, fmtDate } from './ui.js';
import { authError } from './settings.js';
import { SEMESTER_PRESETS } from './presets.js';
import { applyPreset, newSemester } from './editors.js';
import { today } from './ctx.js';
import { pushState, enablePush } from './push.js';

const redirect = () => location.origin + location.pathname;
const validEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);

export function renderAuth(el) {
  const ps = pushState();
  el.innerHTML = `<main class="auth">
    <div class="grow"></div>
    <div class="brand"><img src="icons/icon-192.png" alt=""><h1>Willkommen bei<br>Studyloop</h1></div>
    <div class="features">
      <div class="feature">${icon('grid')}<div><b>Dein Stundenplan</b><p>Vorlesungen, Übungen und Praktika – jede Woche automatisch, auch mit Projekt- und Ferienwochen.</p></div></div>
      <div class="feature">${icon('checkCircle')}<div><b>Nichts mehr vergessen</b><p>Trag pro Termin ein, wie weit du bist und wie sicher du dich fühlst. Studyloop merkt sich, was du nachholen musst.</p></div></div>
      <div class="feature">${icon('cap')}<div><b>Gut vorbereitet in die Prüfung</b><p>Countdown, schwache Themen auf einen Blick und Erinnerungen an Pflichttermine.</p></div></div>
    </div>
    <div class="grow"></div>
    <div class="auth-actions">
      <button class="btn primary" data-auth="up">Konto erstellen</button>
      <button class="btn ghost" data-auth="in">Ich habe schon ein Konto</button>
    </div>
    ${ps.ios && !ps.standalone ? `<p class="install-hint">Tipp: Tippe in Safari auf ${icon('share')} und dann auf „Zum Home-Bildschirm“ – dann öffnet sich Studyloop wie eine App und kann dich erinnern.</p>` : ''}
  </main>`;
  el.querySelectorAll('[data-auth]').forEach((b) => b.addEventListener('click', () => authSheet(b.dataset.auth)));
}

function authSheet(mode) {
  sheet({
    title: mode === 'up' ? 'Konto erstellen' : 'Anmelden',
    done: 'Abbrechen',
    render(b) {
      b.innerHTML = `<form class="form" novalidate style="gap:0">
        <div class="group" style="margin-top:8px">
          <div class="cell" style="padding:0 16px"><input class="inset-input" type="email" name="email" placeholder="E-Mail" autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false" aria-label="E-Mail"></div>
          <div class="cell pw" style="padding:0 16px"><input class="inset-input" type="password" name="password" placeholder="Passwort${mode === 'up' ? ' (mind. 6 Zeichen)' : ''}" autocomplete="${mode === 'up' ? 'new-password' : 'current-password'}" aria-label="Passwort"><button type="button" data-eye aria-label="Passwort zeigen">${icon('eye')}</button></div>
        </div>
        <div class="gf" data-msg>${mode === 'up' ? 'Mit deinem Konto sind deine Daten auf jedem Gerät da – iPhone, iPad und Computer.' : ''}</div>
        <button class="btn primary" type="submit" data-submit style="margin-top:22px">${mode === 'up' ? 'Konto erstellen' : 'Anmelden'}</button>
        ${mode === 'in' ? '<button class="btn ghost" type="button" data-forgot style="margin-top:6px">Passwort vergessen?</button>' : ''}
      </form>`;
      const form = b.querySelector('form');
      const pw = form.password;
      setTimeout(() => form.email.focus(), 450);
      const msg = (text, ok = false) => { const m = b.querySelector('[data-msg]'); m.textContent = text; m.style.color = ok ? '' : 'var(--red)'; };
      b.querySelector('[data-eye]').onclick = () => { pw.type = pw.type === 'password' ? 'text' : 'password'; b.querySelector('[data-eye]').innerHTML = icon(pw.type === 'password' ? 'eye' : 'eyeOff'); };
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = form.email.value.trim(), password = pw.value;
        if (!validEmail(email)) return msg('Bitte gib eine gültige E-Mail-Adresse ein.');
        if (password.length < 6) return msg('Das Passwort muss mindestens 6 Zeichen haben.');
        const btn = form.querySelector('[data-submit]');
        btn.classList.add('busy');
        try {
          if (mode === 'in') {
            const { error } = await sb.auth.signInWithPassword({ email, password });
            if (error) msg(authError(error));
          } else {
            const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirect() } });
            if (error) msg(authError(error));
            else if (!data.session) {
              const r = await sb.auth.signInWithPassword({ email, password });
              if (r.error) msg('Fast geschafft! Bestätige deine E-Mail über den Link im Postfach und melde dich dann an.', true);
            }
          }
        } catch (err) { msg(authError(err)); }
        btn.classList.remove('busy');
      });
      b.querySelector('[data-forgot]')?.addEventListener('click', async () => {
        const email = form.email.value.trim();
        if (!validEmail(email)) { msg('Gib oben deine E-Mail ein – dann schicken wir dir einen Link.'); form.email.focus(); return; }
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirect() });
        if (error) msg(authError(error)); else msg('Falls es ein Konto mit dieser E-Mail gibt, ist ein Link zum Zurücksetzen unterwegs.', true);
      });
    },
  });
}

export function askNewPassword() {
  sheet({
    title: 'Neues Passwort', primary: 'Sichern',
    render(b, api) {
      b.innerHTML = `<div class="form"><div class="group" style="margin-top:8px"><div class="cell" style="padding:0 16px"><input class="inset-input" type="password" data-p autocomplete="new-password" placeholder="Neues Passwort (mind. 6 Zeichen)"></div></div><div class="gf" data-err></div><button class="btn primary" data-save>Sichern</button></div>`;
      b.querySelector('[data-save]').onclick = async () => {
        const v = b.querySelector('[data-p]').value;
        const err = (t) => { const e = b.querySelector('[data-err]'); e.textContent = t; e.style.color = 'var(--red)'; };
        if (v.length < 6) return err('Mindestens 6 Zeichen.');
        const { error } = await sb.auth.updateUser({ password: v });
        if (error) return err(authError(error));
        toast('Passwort gespeichert');
        api.close();
      };
    },
  });
}

// ---------------- Erstes Einrichten ----------------
export function renderOnboarding(el) {
  const t = today();
  const presets = SEMESTER_PRESETS.filter((p) => p.semester.ends_on >= t);
  const ps = pushState();
  const askPush = ps.supported && ps.permission === 'default';
  let step = 'semester', chosen = null, ttChoice = null, countAll = false;
  const steps = () => ['semester', 'timetable', ...(chosen && ttChoice && chosen.semester.starts_on < t ? ['count'] : []), ...(askPush ? ['push'] : [])];
  const dots = () => `<div class="steps">${steps().map((s) => `<i class="${steps().indexOf(s) <= steps().indexOf(step) ? 'on' : ''}"></i>`).join('')}</div>`;
  const finish = () => {
    applyPreset(chosen, ttChoice);
    putSettings({ trackFrom: countAll ? null : (chosen.semester.starts_on < t ? t : null) });
    toast(ttChoice ? 'Alles eingerichtet' : 'Semester angelegt – trag jetzt deine Termine ein.');
  };
  const next = () => { const s = steps(); const i = s.indexOf(step); if (i + 1 < s.length) { step = s[i + 1]; draw(); } else finish(); };
  const back = () => { const s = steps(); step = s[Math.max(0, s.indexOf(step) - 1)]; draw(); };
  const screen = (title, text, body, showBack = true) => `<main class="auth" style="padding-top:calc(var(--safe-t) + 36px)">
    ${dots()}<div class="brand" style="margin-bottom:24px"><h1 style="font-size:1.65rem">${title}</h1><p>${text}</p></div>
    <div class="form" style="gap:10px">${body}</div><div class="grow"></div>
    ${showBack ? `<button class="btn ghost" data-back style="margin-top:20px">Zurück</button>` : ''}</main>`;
  const choice = (attr, ic, color, title, sub) => `<button class="choice" ${attr}><span class="sq ${color}">${icon(ic)}</span><span style="min-width:0;flex:1"><span class="t">${title}</span><span class="s">${sub}</span></span>${icon('right', 'chev')}</button>`;

  const draw = () => {
    if (step === 'semester') {
      el.innerHTML = screen('Dein Semester', 'Wähle deine Hochschule. Wochenrhythmus, Ferien und Fristen sind dann schon eingetragen.',
        presets.map((p) => choice(`data-preset="${p.id}"`, 'cap', 'indigo', esc(p.school), esc(p.label))).join('')
        + choice('data-custom', 'plus', 'gray', 'Andere Hochschule', 'Semester selbst anlegen'), false);
      el.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => { chosen = SEMESTER_PRESETS.find((p) => p.id === b.dataset.preset); next(); }));
      el.querySelector('[data-custom]').addEventListener('click', () => newSemester({ onDone: (row) => { if (row && row.starts_on < t) putSettings({ trackFrom: t }); } }));
    } else if (step === 'timetable') {
      el.innerHTML = screen('Dein Stundenplan', 'Ist deiner dabei? Dann sind alle Termine sofort da – du kannst alles später anpassen.',
        chosen.timetables.map((tt) => choice(`data-tt="${tt.id}"`, 'grid', 'indigo', esc(tt.label), `${tt.subjects.length} Fächer · ${tt.series.length} Termine pro Woche`)).join('')
        + choice('data-tt=""', 'pencil', 'gray', 'Selbst eintragen', 'Mit leerem Stundenplan starten'));
      el.querySelectorAll('[data-tt]').forEach((b) => b.addEventListener('click', () => { ttChoice = b.dataset.tt || null; next(); }));
    } else if (step === 'count') {
      el.innerHTML = screen('Das Semester läuft schon', `Seit ${fmtDate(chosen.semester.starts_on, { weekday: false })} gab es schon Termine. Wie soll Studyloop damit umgehen?`,
        choice('data-count="fresh"', 'check', 'green', 'Ab heute zählen', 'Frühere Termine gelten nicht als offen. Eintragen kannst du sie trotzdem. (Empfohlen)')
        + choice('data-count="all"', 'repeat', 'orange', 'Alles seit Semesterbeginn', 'Jeder bisherige Termin zählt als offen, bis du ihn einträgst.'));
      el.querySelectorAll('[data-count]').forEach((b) => b.addEventListener('click', () => { countAll = b.dataset.count === 'all'; next(); }));
    } else if (step === 'push') {
      el.innerHTML = screen('Erinnerungen', 'Studyloop kann dich vor Pflichtterminen, Fristen und Prüfungen erinnern – auch wenn die App geschlossen ist.',
        `<div class="group"><div class="cell ic"><span class="sq red">${icon('bell')}</span><span class="main"><span class="t">Prüfungsanmeldung endet morgen</span><span class="s">So sieht eine Erinnerung aus.</span></span></div></div>
         <button class="btn primary" data-push style="margin-top:14px">Mitteilungen erlauben</button>
         <button class="btn ghost" data-skip>Später</button>`);
      el.querySelector('[data-push]').addEventListener('click', async (e) => {
        e.target.classList.add('busy');
        try { await enablePush(); } catch { /* später in den Einstellungen */ }
        next();
      });
      el.querySelector('[data-skip]').addEventListener('click', next);
    }
    el.querySelector('[data-back]')?.addEventListener('click', back);
  };
  draw();
}
