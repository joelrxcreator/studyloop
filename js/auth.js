// Anmeldung, Passwort vergessen, erstes Einrichten.
import { sb, putSettings } from './store.js';
import { icon } from './icons.js';
import { esc, seg, bindSegs, sheet, toast, fmtDate } from './ui.js';
import { authError } from './settings.js';
import { SEMESTER_PRESETS } from './presets.js';
import { applyPreset, newSemester } from './editors.js';
import { today } from './ctx.js';

const redirect = () => location.origin + location.pathname;

export function renderAuth(el) {
  let mode = 'in';
  el.innerHTML = `<main class="auth">
    <div class="brand"><img src="icons/icon-192.png" alt=""><h1>Studyloop</h1><p>Behalte im Blick, was du nachholen musst – von der ersten Vorlesung bis zur Prüfung.</p></div>
    <form class="form" novalidate>
      ${seg('mode', [['in', 'Anmelden'], ['up', 'Konto erstellen']], mode)}
      <label class="field"><span>E-Mail</span><input type="email" name="email" autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false" required></label>
      <label class="field"><span>Passwort</span><div class="pw"><input type="password" name="password" autocomplete="current-password" required minlength="6"><button type="button" data-eye aria-label="Passwort zeigen">${icon('eye')}</button></div></label>
      <div data-msg></div>
      <button class="btn primary" type="submit" data-submit>Anmelden</button>
      <button class="btn ghost" type="button" data-forgot>Passwort vergessen?</button>
    </form>
  </main>`;
  const form = el.querySelector('form');
  const pw = form.password;
  const msg = (html, ok = false) => { el.querySelector('[data-msg]').innerHTML = html ? `<div class="${ok ? 'banner accent' : 'err'}">${html}</div>` : ''; };
  bindSegs(el, (_, v) => {
    mode = v;
    form.querySelector('[data-submit]').textContent = v === 'in' ? 'Anmelden' : 'Konto erstellen';
    form.querySelector('[data-forgot]').hidden = v !== 'in';
    pw.autocomplete = v === 'in' ? 'current-password' : 'new-password';
    msg('');
  });
  form.querySelector('[data-eye]').onclick = () => {
    pw.type = pw.type === 'password' ? 'text' : 'password';
    form.querySelector('[data-eye]').innerHTML = icon(pw.type === 'password' ? 'eye' : 'eyeOff');
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.email.value.trim(), password = pw.value;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return msg('Bitte gib eine gültige E-Mail-Adresse ein.');
    if (password.length < 6) return msg('Das Passwort muss mindestens 6 Zeichen haben.');
    const btn = form.querySelector('[data-submit]');
    btn.classList.add('busy');
    msg('');
    try {
      if (mode === 'in') {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) msg(esc(authError(error)));
      } else {
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirect() } });
        if (error) msg(esc(authError(error)));
        else if (!data.session) msg('Fast geschafft! Wir haben dir eine E-Mail geschickt. Tippe auf den Link darin und melde dich dann hier an.', true);
      }
    } catch (err) { msg(esc(authError(err))); }
    btn.classList.remove('busy');
  });
  form.querySelector('[data-forgot]').onclick = async () => {
    const email = form.email.value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg('Gib oben deine E-Mail ein, dann schicken wir dir einen Link zum Zurücksetzen.'); form.email.focus(); return; }
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirect() });
    if (error) msg(esc(authError(error)));
    else msg('Falls es ein Konto mit dieser E-Mail gibt, ist jetzt ein Link zum Zurücksetzen unterwegs.', true);
  };
}

export function askNewPassword() {
  sheet({
    title: 'Neues Passwort festlegen',
    render(b, api) {
      b.innerHTML = `<div class="form"><label class="field"><span>Neues Passwort</span><input type="password" data-p autocomplete="new-password" minlength="6"></label><div data-err></div><button class="btn primary" data-save>Speichern</button></div>`;
      b.querySelector('[data-save]').onclick = async () => {
        const v = b.querySelector('[data-p]').value;
        if (v.length < 6) { b.querySelector('[data-err]').innerHTML = '<div class="err">Mindestens 6 Zeichen.</div>'; return; }
        const { error } = await sb.auth.updateUser({ password: v });
        if (error) { b.querySelector('[data-err]').innerHTML = `<div class="err">${esc(authError(error))}</div>`; return; }
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
  let step = 1, chosen = null, ttChoice = null;
  const finish = (countAll) => {
    applyPreset(chosen, ttChoice);
    putSettings({ trackFrom: countAll ? null : t });
    toast(ttChoice ? 'Alles eingerichtet – los geht’s!' : 'Semester angelegt – trag jetzt deine Termine ein.');
  };
  const draw = () => {
    if (step === 1) {
      el.innerHTML = `<main class="auth">
        <div class="steps"><i class="on"></i><i></i><i></i></div>
        <div class="brand" style="margin-bottom:var(--s5)"><img src="icons/icon-192.png" alt=""><h1>Willkommen!</h1><p>Wähle dein Semester. Wochenrhythmus, Ferien und Fristen sind dann schon eingetragen.</p></div>
        <div class="form">
          ${presets.map((p) => `<button class="choice" data-preset="${p.id}"><span class="ibox">${icon('cap')}</span><span style="min-width:0"><span class="t" style="display:block">${esc(p.school)}</span><span class="s">${esc(p.label)}</span></span></button>`).join('')}
          <button class="choice" data-custom><span class="ibox">${icon('plus')}</span><span><span class="t" style="display:block">Eigenes Semester</span><span class="s">Andere Hochschule oder eigener Zeitraum</span></span></button>
        </div></main>`;
      el.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => { chosen = SEMESTER_PRESETS.find((p) => p.id === b.dataset.preset); step = 2; draw(); }));
      el.querySelector('[data-custom]').addEventListener('click', () => newSemester({ onDone: (row) => { if (row && row.starts_on < t) putSettings({ trackFrom: t }); } }));
    } else if (step === 2) {
      el.innerHTML = `<main class="auth">
        <div class="steps"><i class="on"></i><i class="on"></i><i></i></div>
        <div class="brand" style="margin-bottom:var(--s5)"><h1 style="font-size:1.6rem">Stundenplan übernehmen?</h1><p>Wenn deiner dabei ist, sind alle Termine sofort da. Du kannst alles später anpassen.</p></div>
        <div class="form">
          ${chosen.timetables.map((tt) => `<button class="choice" data-tt="${tt.id}"><span class="ibox">${icon('grid')}</span><span><span class="t" style="display:block">${esc(tt.label)}</span><span class="s">${tt.subjects.length} Fächer · ${tt.series.length} Termine pro Woche</span></span></button>`).join('')}
          <button class="choice" data-tt=""><span class="ibox">${icon('pencil')}</span><span><span class="t" style="display:block">Selbst eintragen</span><span class="s">Leerer Stundenplan</span></span></button>
          <button class="btn ghost" data-back>${icon('left', 'sm')}Zurück</button>
        </div></main>`;
      el.querySelectorAll('[data-tt]').forEach((b) => b.addEventListener('click', () => {
        ttChoice = b.dataset.tt || null;
        if (ttChoice && chosen.semester.starts_on < t) { step = 3; draw(); } else finish(false);
      }));
      el.querySelector('[data-back]').addEventListener('click', () => { step = 1; draw(); });
    } else {
      el.innerHTML = `<main class="auth">
        <div class="steps"><i class="on"></i><i class="on"></i><i class="on"></i></div>
        <div class="brand" style="margin-bottom:var(--s5)"><h1 style="font-size:1.6rem">Das Semester läuft schon</h1><p>Seit ${fmtDate(chosen.semester.starts_on, { weekday: false })} gab es schon Termine. Wie soll Studyloop damit umgehen?</p></div>
        <div class="form">
          <button class="choice" data-count="fresh"><span class="ibox green">${icon('check')}</span><span><span class="t" style="display:block">Ab heute zählen</span><span class="s">Frühere Termine gelten nicht als offen – du kannst sie trotzdem jederzeit eintragen. (Empfohlen)</span></span></button>
          <button class="choice" data-count="all"><span class="ibox amber">${icon('repeat')}</span><span><span class="t" style="display:block">Alles seit Semesterbeginn</span><span class="s">Jeder bisherige Termin zählt als offen, bis du ihn einträgst.</span></span></button>
          <button class="btn ghost" data-back>${icon('left', 'sm')}Zurück</button>
        </div></main>`;
      el.querySelectorAll('[data-count]').forEach((b) => b.addEventListener('click', () => finish(b.dataset.count === 'all')));
      el.querySelector('[data-back]').addEventListener('click', () => { step = 2; draw(); });
    }
  };
  draw();
}
