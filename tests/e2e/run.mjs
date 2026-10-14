// Browser-Durchlauf (Schleifstein): echte App + echtes supabase-js gegen den Supabase-Nachbau.
// Start:  npx http-server -p 8080 -c-1 .   und dann:  PLAYWRIGHT=/pfad/zu/playwright node tests/e2e/run.mjs
// Fotos landen in $SHOTS (Standard: ./shots).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMock } from './mock-supabase.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8080/';
const SHOTS = process.env.SHOTS || 'shots';
const ONLY = process.env.ONLY || '';
fs.mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const results = [];

async function newApp({ width = 390, height = 844, theme = 'dark', time = '2026-10-14T10:30:00+02:00', mock = createMock(), fontScale = 1 } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    locale: 'de-DE', timezoneId: 'Europe/Berlin', colorScheme: theme,
  });
  await ctx.route('https://ibmhbjwkkgjuzyztakmg.supabase.co/**', mock.handle);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED|net::/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.clock.setFixedTime(new Date(time));
  if (fontScale !== 1) await page.addInitScript((s) => { document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = s * 100 + '%'; }); }, fontScale);
  await page.goto(BASE);
  return { ctx, page, errors, mock };
}

async function signUp(page, email = 'joel@example.org', pw = 'geheim123') {
  await page.getByRole('button', { name: 'Konto erstellen' }).first().click();
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', pw);
  await page.locator('[data-submit]').click();
}

async function setupHBRS(page) {
  await page.getByText('Hochschule Bonn-Rhein-Sieg').click();
  await page.getByText('ET1-EK3 · Gruppe B').click();
  await page.getByText('Ab heute zählen').click();
  await page.waitForSelector('.tabbar');
}

const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png` });

async function overflowCheck(page, label) {
  const bad = await page.evaluate(() => {
    const W = window.innerWidth;
    return [...document.querySelectorAll('body *')].filter((e) => {
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      const st = getComputedStyle(e);
      if (st.visibility === 'hidden' || st.display === 'none') return false;
      if (e.closest('.sheet-wrap:not(.open), .page:not(.in), .toast:not(.show), .ptr, .tt-scroll')) return false;
      return r.right > W + 1 || r.left < -1;
    }).slice(0, 5).map((e) => `${e.tagName}.${e.className} right=${Math.round(e.getBoundingClientRect().right)}`);
  });
  assert.deepEqual(bad, [], `${label}: Elemente ragen über den Rand`);
}

async function tapTargets(page, label) {
  const small = await page.evaluate(() => [...document.querySelectorAll('button, [role=button], input, select, textarea, a')].filter((e) => {
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    if (e.closest('.sheet-wrap:not(.open), .page:not(.in), .tt-item, .strip, .toast')) return false;
    if (e.type === 'file' || e.type === 'checkbox') return false;
    return r.height < 36 || r.width < 36;
  }).slice(0, 6).map((e) => `${e.tagName}.${e.className}[${e.textContent.trim().slice(0, 20)}] ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`));
  assert.deepEqual(small, [], `${label}: zu kleine Tipp-Flächen`);
}

async function test(name, fn) {
  if (ONLY && !name.includes(ONLY)) return;
  const t0 = Date.now();
  try { await fn(); results.push(['ok', name, Date.now() - t0]); console.log('ok  ', name); }
  catch (e) { results.push(['FAIL', name]); console.log('FAIL', name, '\n     ', e.message.split('\n').slice(0, 6).join('\n      ')); }
}

// ------------------------------------------------------------------
await test('Anmelden: Fehler verständlich, Registrieren, Vorlage übernehmen, landet auf heute', async () => {
  const { page, errors, ctx, mock } = await newApp();
  await page.waitForSelector('.auth');
  await shot(page, '01-login-dark');
  await page.fill('input[name=email]', 'falsch');
  await page.fill('input[name=password]', '123');
  await page.locator('[data-submit]').click();
  await page.waitForSelector('.err');
  assert.match(await page.locator('.err').innerText(), /gültige E-Mail/);
  mock.users.set('a@b.de', { id: 'x1', email: 'a@b.de', password: 'richtig1' });
  await page.fill('input[name=email]', 'a@b.de');
  await page.fill('input[name=password]', 'falsch12');
  await page.locator('[data-submit]').click();
  await page.waitForFunction(() => /stimmt nicht/.test(document.querySelector('.err')?.textContent || ''));
  await signUp(page);
  await page.waitForSelector('.choice');
  await shot(page, '02-onboarding-1');
  await page.getByText('Hochschule Bonn-Rhein-Sieg').click();
  await shot(page, '03-onboarding-2');
  await page.getByText('ET1-EK3 · Gruppe B').click();
  await shot(page, '03b-onboarding-3');
  await page.getByText('Ab heute zählen').click();
  await page.waitForSelector('.occ');
  await page.waitForTimeout(400);
  await shot(page, '04-heute-dark');
  const title = await page.locator('.title-xl').innerText();
  assert.equal(title, 'Heute');
  assert.match(await page.locator('.eyebrow').first().textContent(), /KW 42 · Dunkle Woche/);
  const names = await page.locator('.occ .name').allInnerTexts();
  assert.deepEqual(names, ['Werkstoffe', 'Informatik 1', 'Werkstoffe']);
  await page.waitForTimeout(800);
  assert.equal(mock.db.semesters.length, 1, 'Semester gespeichert');
  assert.equal(mock.db.series.length, 14, 'Termine gespeichert');
  assert.equal(mock.db.exams.length, 4);
  assert.equal(mock.db.settings[0]?.data.trackFrom, '2026-10-14');
  const tileTxt = (await page.locator('.tile').nth(1).innerText()).replace(/\s+/g, ' ');
  assert.match(tileTxt, /Offen 2 · 4 Std\./, 'heute 08:15 + 10:15 (begonnen) zählen: ' + tileTxt);
  await overflowCheck(page, 'Heute 390');
  await tapTargets(page, 'Heute');
  assert.deepEqual(errors, []);
  await ctx.close();
});

// gemeinsamer Zustand für die weiteren Tests
async function ready(opts = {}) {
  const a = await newApp(opts);
  await signUp(a.page);
  await setupHBRS(a.page);
  await a.page.waitForTimeout(500);
  return a;
}

await test('Termin bearbeiten: Regler, Sterne, Notiz, Pflicht – sofort gespeichert und nach Neuladen da', async () => {
  const { page, errors, ctx, mock } = await ready();
  await page.locator('.occ').first().click();
  await page.waitForSelector('.sheet-wrap.open');
  await page.waitForTimeout(350);
  await shot(page, '05-termin-sheet');
  await overflowCheck(page, 'Termin-Sheet');
  await tapTargets(page, 'Termin-Sheet');
  // Regler per Schnellwahl und per Ziehen
  await page.locator('[data-quick="75"]').click();
  assert.equal(await page.locator('[data-pct]').innerText(), '75 %');
  const r = await page.locator('[data-range]').boundingBox();
  await page.mouse.click(r.x + r.width * 0.4, r.y + r.height / 2);
  await page.waitForTimeout(100);
  const pct = Number((await page.locator('[data-pct]').innerText()).replace(/\D/g, ''));
  assert.ok(pct >= 30 && pct <= 50, 'Regler: ' + pct);
  await page.locator('[data-star="2"]').click();
  await page.locator('[data-star="4"]').click();
  await page.fill('[data-note]', 'Kapitel 5 nochmal anschauen');
  await page.locator('[data-sw="mandatory"]').check({ force: true });
  await page.waitForTimeout(900);
  await shot(page, '06-termin-sheet-ausgefuellt');
  await page.locator('.sheet-backdrop').click({ position: { x: 20, y: 20 } });
  await page.waitForTimeout(500);
  const occ = mock.db.occurrences[0];
  assert.equal(occ.progress, pct);
  assert.equal(occ.stars, 4);
  assert.equal(occ.note, 'Kapitel 5 nochmal anschauen');
  assert.equal(occ.mandatory, true);
  assert.equal(mock.db.activity.length, 1, 'Aktivität für Serie');
  await shot(page, '07-heute-nach-bearbeiten');
  // Cache weg, neu laden → kommt vom Server
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('sl.cache')) localStorage.removeItem(k); });
  await page.reload();
  await page.waitForSelector('.occ');
  const card = await page.locator('.occ').first().innerText();
  assert.match(card, /Kapitel 5/);
  assert.match(card, new RegExp(pct + ' %'));
  assert.equal(await page.locator('.occ').first().locator('.flag.red').count(), 1);
  assert.deepEqual(errors, []);
  await ctx.close();
});

await test('Schnell hintereinander tippen: keine Änderung geht verloren', async () => {
  const { page, errors, ctx, mock } = await ready();
  await page.locator('.occ').nth(1).click();
  await page.waitForSelector('.sheet-wrap.open');
  for (const v of [25, 50, 75, 100, 0, 50]) await page.locator(`[data-quick="${v}"]`).click();
  for (const s of [1, 2, 3, 5]) await page.locator(`[data-star="${s}"]`).click();
  await page.locator('[data-note]').pressSequentially('abc', { delay: 10 });
  await page.locator('[data-close]').click();
  await page.waitForTimeout(1200);
  const o = mock.db.occurrences.find((x) => x.on_date === '2026-10-14' && x.progress === 50);
  assert.ok(o, 'Fortschritt 50 gespeichert: ' + JSON.stringify(mock.db.occurrences));
  assert.equal(o.stars, 5);
  assert.equal(o.note, 'abc');
  assert.deepEqual(errors, []);
  await ctx.close();
});

await test('Offline: Änderungen bleiben und werden später gespeichert', async () => {
  const { page, errors, ctx, mock } = await ready();
  mock.state.offline = true;
  await page.locator('.occ').first().click();
  await page.waitForSelector('.sheet-wrap.open');
  await page.locator('[data-quick="100"]').click();
  await page.locator('[data-close]').click();
  await page.waitForTimeout(2500);
  await shot(page, '08-offline');
  assert.equal(mock.db.occurrences.length, 0);
  assert.match(await page.locator('.syncpill').innerText(), /Offline/);
  // App neu öffnen ohne Netz → Daten aus dem Gerät
  await page.reload();
  await page.waitForSelector('.occ');
  assert.match(await page.locator('.occ').first().innerText(), /100 %/);
  mock.state.offline = false;
  await page.waitForTimeout(4500);
  assert.equal(mock.db.occurrences[0]?.progress, 100, 'nach Wiederverbindung gespeichert');
  assert.deepEqual(errors, []);
  await ctx.close();
});

await test('Navigation: Tage/Wochen wischen, Zukunft & Vergangenheit, Projektwoche, zurück zu heute', async () => {
  const { page, errors, ctx } = await ready();
  // nächster Tag per Wochenleiste
  await page.locator('.strip button').nth(4).click();
  assert.match(await page.locator('.title-xl').innerText(), /Freitag/);
  assert.equal(await page.locator('.occ').count(), 3);
  // Wischen auf Inhalt: nächster Tag (Sa) → leer
  const box = await page.locator('[data-swipe="day"]').boundingBox();
  const swipe = async (sel, dx) => {
    await page.evaluate(({ sel, dx }) => {
      const el = document.querySelector(sel);
      const r = el.getBoundingClientRect();
      const mk = (x) => new Touch({ identifier: 1, target: el, clientX: x, clientY: r.top + 20 });
      el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [mk(200)], changedTouches: [mk(200)] }));
      el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [mk(200 + dx)] }));
    }, { sel, dx });
    await page.waitForTimeout(50);
  };
  await swipe('[data-swipe="day"]', -120);
  assert.match(await page.locator('.title-xl').innerText(), /Samstag/);
  await shot(page, '09-samstag-leer');
  // Woche vor (Projektwoche KW44): zweimal Wochenleiste wischen
  await swipe('[data-swipe="week"]', -120);
  await swipe('[data-swipe="week"]', -120);
  assert.match(await page.locator('.eyebrow').first().textContent(), /Projektwoche/);
  await shot(page, '10-projektwoche');
  // Vergangenheit
  for (let i = 0; i < 4; i++) await swipe('[data-swipe="week"]', 120);
  assert.match(await page.locator('.eyebrow').first().textContent(), /KW 40/);
  await page.getByRole('button', { name: 'Heute', exact: true }).first().click();
  assert.equal(await page.locator('.title-xl').innerText(), 'Heute');
  assert.deepEqual(errors, []);
  await ctx.close();
});

await test('Woche, Fächer-Cockpit, Fach-Detail, Prüfungen', async () => {
  const { page, errors, ctx, mock } = await ready({ time: '2026-10-21T19:00:00+02:00' });
  // ein paar Einträge: Mathe-Vorlesung 13.10. halb, schwach bewertet
  await page.getByRole('button', { name: 'Woche' }).click();
  await page.waitForTimeout(300);
  await shot(page, '11-woche');
  await overflowCheck(page, 'Woche');
  await tapTargets(page, 'Woche');
  await page.locator('[data-act="wk"][data-d="-7"]').click();
  await page.locator('[data-act="toggleBefore"]').click();
  await shot(page, '11b-woche-vor-start');
  const firstOpen = page.locator('.list .row').first();
  await firstOpen.click();
  await page.waitForSelector('.sheet-wrap.open');
  await page.locator('[data-quick="50"]').click();
  await page.locator('[data-star="1"]').click();
  await page.locator('[data-close]').click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Fächer' }).click();
  await page.waitForTimeout(300);
  await shot(page, '12-faecher');
  await overflowCheck(page, 'Fächer');
  await tapTargets(page, 'Fächer');
  const rows = await page.locator('.list .row').count();
  assert.equal(rows, 6);
  await page.locator('.list .row').first().click();
  await page.waitForSelector('.page.in');
  await page.waitForTimeout(350);
  await shot(page, '13-fach-detail');
  await overflowCheck(page, 'Fach-Detail');
  await page.locator('.page [data-act="back"]').click();
  await page.waitForTimeout(350);
  await page.getByRole('button', { name: 'Prüfungen' }).click();
  await page.waitForTimeout(300);
  await shot(page, '14-pruefungen-leer');
  // Prüfung anlegen
  await page.locator('[data-act="newExam"]').first().click();
  await page.waitForSelector('.sheet-wrap.open');
  await page.selectOption('[data-f="subject_id"]', { label: 'Mathe 1' });
  await page.fill('[data-f="on_date"]', '2027-01-27');
  await page.fill('[data-f="starts_at"]', '09:00');
  await page.fill('[data-f="room"]', 'HS1');
  await shot(page, '15-pruefung-anlegen');
  await overflowCheck(page, 'Prüfung-Sheet');
  await page.locator('[data-save]').click();
  await page.waitForTimeout(500);
  await shot(page, '16-pruefungen');
  assert.match(await page.locator('.hero .big').innerText(), /^98/);
  assert.equal(mock.db.exams.find((e) => e.room === 'HS1')?.title, 'Mathe 1');
  assert.deepEqual(errors, []);
  await ctx.close();
});

await test('Stundenplan: Schnellzugriff öffnen/schließen, Wochen blättern, Bearbeiten', async () => {
  const { page, errors, ctx } = await ready();
  await page.locator('[data-fab]').click();
  await page.waitForSelector('.tt-wrap.open');
  await page.waitForTimeout(300);
  await shot(page, '17-stundenplan');
  assert.equal(await page.locator('.tt-col').count(), 5);
  assert.ok(await page.locator('.tt-item').count() >= 12);
  await page.locator('[data-act="tt"][data-d="7"]').click();
  await shot(page, '18-stundenplan-helle-woche');
  await page.locator('[data-fab]').click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.tt-wrap').count(), 0);
  // Bearbeiten-Seite
  await page.locator('[data-fab]').click();
  await page.getByRole('button', { name: /Stundenplan bearbeiten/ }).click();
  await page.waitForSelector('.page.in');
  await page.waitForTimeout(300);
  await shot(page, '19-stundenplan-bearbeiten');
  await overflowCheck(page, 'Stundenplan bearbeiten');
  // Termin hinzufügen mit Überschneidung
  await page.locator('[data-act="newSeries"]').first().click();
  await page.waitForSelector('.sheet-wrap.open');
  await page.locator('[data-seg="weekday"] [data-v="3"]').click();
  await page.fill('[data-f="starts_at"]', '09:00');
  await page.fill('[data-f="ends_at"]', '11:00');
  await page.fill('[data-f="room"]', 'B999');
  await shot(page, '20-termin-anlegen');
  await overflowCheck(page, 'Termin anlegen');
  await tapTargets(page, 'Termin anlegen');
  await page.locator('[data-save]').click();
  await page.waitForTimeout(300);
  await page.locator('.page [data-act="back"]').click();
  await page.waitForTimeout(400);
  await shot(page, '21-heute-ueberschneidung');
  assert.ok(await page.locator('.pause span', { hasText: 'Überschneidung' }).count() >= 1);
  await page.locator('[data-fab]').click();
  await page.waitForTimeout(300);
  await shot(page, '22-stundenplan-ueberschneidung');
  assert.deepEqual(errors, []);
  await ctx.close();
});

await test('Einstellungen, Hell/Dunkel, Mitteilungen-Hinweis, Löschen braucht Bestätigung', async () => {
  const { page, errors, ctx, mock } = await ready();
  await page.locator('[data-act="settings"]').click();
  await page.waitForSelector('.page.in');
  await page.waitForTimeout(400);
  await shot(page, '23-einstellungen');
  await overflowCheck(page, 'Einstellungen');
  await page.locator('[data-seg="theme"] [data-v="light"]').click();
  await page.waitForTimeout(200);
  await shot(page, '24-einstellungen-hell');
  await page.locator('[data-act="offset"][data-v="60"]').click();
  await page.waitForTimeout(400);
  assert.deepEqual(mock.db.settings[0].data.offsets, [1440, 180, 60]);
  // Semester löschen: Tippwort nötig
  await page.locator('[data-act="editSemester"]').click();
  await page.waitForTimeout(400);
  await shot(page, '25-semester');
  await overflowCheck(page, 'Semester');
  await page.locator('.page.in').last().locator('[data-act="delSemester"]').click();
  await page.waitForSelector('[data-word]');
  assert.equal(await page.locator('[data-yes]').isDisabled(), true);
  await page.fill('[data-word]', 'löschen');
  assert.equal(await page.locator('[data-yes]').isDisabled(), false);
  await page.locator('[data-no]').click();
  await page.waitForTimeout(400);
  assert.equal(mock.db.semesters.length, 1);
  assert.deepEqual(errors, []);
  await ctx.close();
});

await test('Hell-Modus und schmale/große Bildschirme sauber', async () => {
  for (const [w, h, theme, scale] of [[320, 640, 'light', 1], [430, 932, 'light', 1], [820, 1180, 'dark', 1], [390, 844, 'light', 1.3]]) {
    const { page, errors, ctx } = await ready({ width: w, height: h, theme, fontScale: scale });
    const tag = `${w}-${theme}${scale !== 1 ? '-gross' : ''}`;
    await shot(page, `30-heute-${tag}`);
    await overflowCheck(page, 'Heute ' + tag);
    await page.locator('.occ').first().click();
    await page.waitForSelector('.sheet-wrap.open');
    await page.waitForTimeout(350);
    await shot(page, `31-sheet-${tag}`);
    await overflowCheck(page, 'Sheet ' + tag);
    await page.locator('[data-close]').click();
    await page.waitForTimeout(300);
    for (const tab of ['Woche', 'Fächer', 'Prüfungen']) {
      await page.getByRole('button', { name: tab }).click();
      await page.waitForTimeout(150);
      await overflowCheck(page, `${tab} ${tag}`);
    }
    await page.locator('[data-fab]').click();
    await page.waitForTimeout(300);
    await shot(page, `32-stundenplan-${tag}`);
    assert.deepEqual(errors, [], tag);
    await ctx.close();
  }
});

await test('Fehlerfall: Server-Fehler wird wiederholt, kaputte Sicherung crasht nicht', async () => {
  const { page, errors, ctx, mock } = await ready();
  mock.state.failNext = 2;
  await page.locator('.occ').first().click();
  await page.locator('[data-quick="25"]').click();
  await page.locator('[data-close]').click();
  await page.waitForTimeout(7000);
  assert.equal(mock.db.occurrences[0]?.progress, 25);
  // Backup-Import mit Unsinn
  await page.locator('[data-act="settings"]').click();
  await page.waitForSelector('.page.in');
  await page.setInputFiles('[data-import]', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{kaputt') });
  await page.waitForSelector('.toast.show');
  assert.match(await page.locator('.toast').innerText(), /keine gültige/);
  await page.setInputFiles('[data-import]', { name: 'y.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ app: 'studyloop', subjects: [{ id: 'z', semester_id: 'gibtsnicht', name: 'X' }], series: 'quatsch' })) });
  await page.waitForSelector('[data-yes]');
  await page.locator('[data-yes]').click();
  await page.waitForTimeout(500);
  assert.equal(mock.db.subjects.length, 6, 'Fach ohne gültiges Semester nicht übernommen');
  assert.deepEqual(errors, []);
  await ctx.close();
});

await browser.close();
const failed = results.filter((r) => r[0] === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} ok`);
process.exit(failed.length ? 1 : 0);
