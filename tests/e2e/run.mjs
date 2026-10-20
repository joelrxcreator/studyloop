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
  await ctx.routeWebSocket(/ibmhbjwkkgjuzyztakmg\.supabase\.co\/realtime/, mock.ws);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED|net::|incognito mode/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.clock.setFixedTime(new Date(time));
  if (fontScale !== 1) await page.addInitScript((s) => { document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = s * 100 + '%'; }); }, fontScale);
  await page.goto(BASE);
  return { ctx, page, errors, mock };
}

async function signUp(page, email = 'joel@example.org', pw = 'geheim123') {
  await page.locator('[data-auth="up"]').click();
  await page.waitForSelector('.sheet-wrap.open input[name=email]');
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', pw);
  await page.locator('[data-submit]').click();
}
const setRange = (page, v) => page.locator('[data-range]').evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, v);
const title = (page) => page.locator('#main .lt h1').innerText();
const save = (page) => page.locator('.sheet-wrap.open [data-primary]').last().click();

async function setupHBRS(page) {
  await page.getByText('Hochschule Bonn-Rhein-Sieg').click();
  await page.getByText('ET1-EK3 · Gruppe B').click();
  await page.getByText('Ab heute zählen').click();
  if (await page.locator('[data-skip]').count()) await page.locator('[data-skip]').click();
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
      if (e.closest('.sheet-wrap:not(.open), .page:not(.in), .toast:not(.show), .ptr')) return false;
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
await test('Willkommen: Fehler verständlich, Registrieren, Vorlage übernehmen, landet auf heute', async () => {
  const { page, errors, ctx, mock } = await newApp();
  await page.waitForSelector('.auth');
  await shot(page, '01-willkommen');
  await page.locator('[data-auth="in"]').click();
  await page.waitForSelector('.sheet-wrap.open input[name=email]');
  await page.fill('input[name=email]', 'falsch');
  await page.fill('input[name=password]', '123');
  await page.locator('[data-submit]').click();
  assert.match(await page.locator('[data-msg]').innerText(), /gültige E-Mail/);
  mock.users.set('a@b.de', { id: 'x1', email: 'a@b.de', password: 'richtig1' });
  await page.fill('input[name=email]', 'a@b.de');
  await page.fill('input[name=password]', 'falsch12');
  await page.locator('[data-submit]').click();
  await page.waitForFunction(() => /stimmt nicht/.test(document.querySelector('[data-msg]')?.textContent || ''));
  await page.locator('.sheet-h [data-close]').click();
  await page.waitForTimeout(500);
  await signUp(page);
  await page.waitForSelector('[data-preset]');
  assert.equal(await page.locator('.sheet-wrap.open').count(), 0, 'Anmelde-Fenster ist zu');
  await page.getByText('Hochschule Bonn-Rhein-Sieg').click();
  await page.getByText('ET1-EK3 · Gruppe B').click();
  await shot(page, '03-semester-laeuft');
  await page.getByText('Ab heute zählen').click();
  await shot(page, '03b-erinnerungen');
  await page.locator('[data-skip]').click();
  await page.waitForSelector('.occ');
  await page.waitForTimeout(500);
  await shot(page, '04-heute');
  assert.equal(await title(page), 'Heute');
  assert.match(await page.locator('#main .lt-sub').innerText(), /Mittwoch, 14\. Oktober/);
  assert.deepEqual(await page.locator('.occ .name').allInnerTexts(), ['Werkstoffe', 'Informatik 1', 'Werkstoffe']);
  assert.equal(mock.db.semesters.length, 1);
  assert.equal(mock.db.series.length, 14);
  assert.equal(mock.db.exams.length, 4);
  assert.equal(mock.db.settings[0]?.data.trackFrom, '2026-10-14');
  await overflowCheck(page, 'Heute 390');
  await tapTargets(page, 'Heute');
  assert.deepEqual(errors, []);
  await ctx.close();
});

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
  await page.waitForTimeout(450);
  await shot(page, '05-termin');
  await overflowCheck(page, 'Termin-Sheet');
  await tapTargets(page, 'Termin-Sheet');
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
  await shot(page, '06-termin-ausgefuellt');
  await page.locator('.sheet-h [data-close]').click();
  await page.waitForTimeout(600);
  const occ = mock.db.occurrences[0];
  assert.equal(occ.progress, pct);
  assert.equal(occ.stars, 4);
  assert.equal(occ.note, 'Kapitel 5 nochmal anschauen');
  assert.equal(occ.mandatory, true);
  assert.equal(mock.db.activity.length, 1, 'Aktivität für Serie');
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('sl.cache')) localStorage.removeItem(k); });
  await page.reload();
  await page.waitForSelector('.occ');
  const card = await page.locator('.occ').first().innerText();
  assert.match(card, /Kapitel 5/);
  assert.match(card, new RegExp(pct + ' %'));
  assert.match(card, /Pflicht/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

await test('Abhaken mit dem Kreis + Widerrufen', async () => {
  const { page, errors, ctx, mock } = await ready();
  await page.locator('.occ [data-act="done"]').first().click();
  await page.waitForTimeout(500);
  assert.equal(mock.db.occurrences[0].progress, 100);
  assert.equal(await page.locator('.occ .check.done').count(), 1);
  await page.locator('.toast button').click();
  await page.waitForTimeout(500);
  assert.equal(mock.db.occurrences[0].progress, 0);
  assert.equal(await page.locator('.sheet-wrap').count(), 0, 'Kreis öffnet kein Fenster');
  assert.deepEqual(errors, []);
  await ctx.close();
});

await test('Schnell hintereinander tippen: keine Änderung geht verloren', async () => {
  const { page, errors, ctx, mock } = await ready();
  await page.locator('.occ').nth(1).click();
  await page.waitForSelector('.sheet-wrap.open');
  for (const v of [25, 50, 75, 100, 0, 50]) await setRange(page, v);
  for (const s of [1, 2, 3, 5]) await page.locator(`[data-star="${s}"]`).click();
  await page.locator('[data-note]').pressSequentially('abc', { delay: 10 });
  await page.locator('.sheet-h [data-close]').click();
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
  await page.locator('.occ [data-act="done"]').first().click();
  await page.waitForTimeout(2500);
  await shot(page, '08-offline');
  assert.equal(mock.db.occurrences.length, 0);
  assert.match(await page.locator('.syncpill').innerText(), /Offline/);
  await page.reload();
  await page.waitForSelector('.occ');
  assert.equal(await page.locator('.occ .check.done').count(), 1);
  mock.state.offline = false;
  await page.waitForTimeout(4500);
  assert.equal(mock.db.occurrences[0]?.progress, 100, 'nach Wiederverbindung gespeichert');
  assert.deepEqual(errors, []);
  await ctx.close();
});

await test('Navigation: Tage/Wochen wischen, Zukunft & Vergangenheit, Projektwoche, zurück zu heute', async () => {
  const { page, errors, ctx } = await ready();
  await page.locator('.strip button').nth(4).click();
  assert.equal(await title(page), 'Freitag');
  assert.equal(await page.locator('.occ').count(), 3);
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
  assert.equal(await title(page), 'Samstag');
  await shot(page, '09-samstag');
  await swipe('[data-swipe="week"]', -120);
  await swipe('[data-swipe="week"]', -120);
  assert.match(await page.locator('.note-banner').innerText(), /Projektwoche/);
  await shot(page, '10-projektwoche');
  for (let i = 0; i < 4; i++) await swipe('[data-swipe="week"]', 120);
  assert.equal(await page.evaluate(() => window.__studyloop.ui.day), '2026-10-03');
  await page.locator('.pill-btn', { hasText: 'Heute' }).click();
  assert.equal(await title(page), 'Heute');
  assert.deepEqual(errors, []);
  await ctx.close();
});

await test('Woche: Stundenplan-Raster, blättern, Offenes; Fächer, Fach, Nachholen', async () => {
  const { page, errors, ctx, mock } = await ready({ time: '2026-10-21T19:00:00+02:00' });
  await page.locator('[data-tab="week"]').click();
  await page.waitForTimeout(300);
  await shot(page, '11-woche');
  await overflowCheck(page, 'Woche');
  await tapTargets(page, 'Woche');
  assert.equal(await page.locator('.tt-col').count(), 5);
  assert.ok(await page.locator('.tt-item').count() >= 12);
  assert.equal(await page.locator('.gh', { hasText: 'Offen in dieser Woche' }).count(), 1);
  await page.locator('[data-act="wk"][data-d="7"]').click();
  assert.match(await title(page), /26\. Okt/);
  assert.equal(await page.locator('.tt-item').count(), 0, 'Projektwoche leer');
  await page.locator('[data-act="wk"][data-d="0"]').click();
  // offenen Termin abhaken über die Liste
  await page.locator('.group [data-act="done"]').first().click();
  await page.waitForTimeout(300);
  await page.locator('[data-tab="subjects"]').click();
  await page.waitForTimeout(300);
  await shot(page, '12-faecher');
  await overflowCheck(page, 'Fächer');
  await tapTargets(page, 'Fächer');
  assert.equal(await page.locator('[data-act="subject"]').count(), 6);
  await page.locator('[data-act="subject"]').first().click();
  await page.waitForSelector('.page.in');
  await page.waitForTimeout(450);
  await shot(page, '13-fach');
  await overflowCheck(page, 'Fach');
  await page.locator('.page [data-act="back"]').click();
  await page.waitForTimeout(500);
  await page.locator('.stat[data-act="backlog"]').click();
  await page.waitForSelector('.page.in');
  await page.waitForTimeout(450);
  await shot(page, '13b-nachholen');
  assert.equal(await page.locator('.page.in .lt h1').innerText(), 'Nachholen');
  assert.deepEqual(errors, []);
  await ctx.close();
});

await test('Prüfungen: anlegen, Countdown, Fristen', async () => {
  const { page, errors, ctx, mock } = await ready({ time: '2026-10-21T19:00:00+02:00' });
  await page.locator('[data-tab="exams"]').click();
  await page.waitForTimeout(300);
  await shot(page, '14-pruefungen-leer');
  await page.locator('.nav [data-act="newExam"]').click();
  await page.waitForSelector('.sheet-wrap.open');
  await page.selectOption('[data-f="subject_id"]', { label: 'Mathe 1' });
  await page.fill('[data-f="on_date"]', '2027-01-27');
  await page.fill('[data-f="starts_at"]', '09:00');
  await page.fill('[data-f="room"]', 'HS1');
  await page.waitForTimeout(300);
  await shot(page, '15-pruefung-anlegen');
  await overflowCheck(page, 'Prüfung-Sheet');
  await save(page);
  await page.waitForTimeout(600);
  await shot(page, '16-pruefungen');
  assert.match(await page.locator('#main').innerText(), /Nächste Prüfung[\s\S]*Mathe 1[\s\S]*98/);
  assert.equal(mock.db.exams.find((e) => e.room === 'HS1')?.title, 'Mathe 1');
  assert.deepEqual(errors, []);
  await ctx.close();
});

await test('Stundenplan bearbeiten: Termin mit Überschneidung anlegen', async () => {
  const { page, errors, ctx, mock } = await ready();
  await page.locator('[data-tab="week"]').click();
  await page.locator('#main [data-act="editTT"]').first().click();
  await page.waitForSelector('.page.in');
  await page.waitForTimeout(450);
  await shot(page, '19-stundenplan-bearbeiten');
  await overflowCheck(page, 'Stundenplan bearbeiten');
  await page.locator('.page.in [data-act="newSeries"]').first().click();
  await page.waitForSelector('.sheet-wrap.open');
  await page.locator('[data-seg="weekday"] [data-v="3"]').click();
  await page.fill('[data-f="starts_at"]', '09:00');
  await page.fill('[data-f="ends_at"]', '11:00');
  await page.fill('[data-f="room"]', 'B999');
  await page.waitForTimeout(300);
  await shot(page, '20-termin-anlegen');
  await overflowCheck(page, 'Termin anlegen');
  await tapTargets(page, 'Termin anlegen');
  await save(page);
  await page.waitForTimeout(500);
  assert.equal(mock.db.series.length, 15);
  await page.locator('.page.in [data-act="back"]').click();
  await page.waitForTimeout(500);
  await page.locator('[data-tab="day"]').click();
  await page.waitForTimeout(300);
  await shot(page, '21-heute-ueberschneidung');
  assert.ok(await page.locator('.cell.gap.warn').count() >= 1);
  await page.locator('[data-tab="week"]').click();
  await page.waitForTimeout(300);
  await shot(page, '22-woche-ueberschneidung');
  assert.deepEqual(errors, []);
  await ctx.close();
});

await test('Bestimmte Wochen auswählen (z. B. Praktikum nur in einzelnen Wochen)', async () => {
  const { page, errors, ctx, mock } = await ready();
  await page.locator('[data-act="settings"]').click();
  await page.locator('.page.in [data-act="editTT"]').click();
  await page.waitForTimeout(500);
  await page.locator('.page.in').last().getByText('Montag · 15:15–16:45').click();
  await page.waitForSelector('.sheet-wrap.open');
  await page.locator('[data-seg="weeks_rule"] [data-v="custom"]').click();
  await save(page);
  assert.match(await page.locator('.sheet .err').innerText(), /mindestens eine Woche/);
  await page.locator('[data-wk="2026-10-19"]').click();
  await page.locator('[data-wk="2026-11-16"]').click();
  await page.waitForTimeout(200);
  await shot(page, '26-wochen-auswahl');
  await overflowCheck(page, 'Wochen-Auswahl');
  await save(page);
  await page.waitForTimeout(600);
  const sr = mock.db.series.find((x) => x.weekday === 1 && x.starts_at.startsWith('15:15'));
  assert.equal(sr.weeks_rule, 'custom');
  assert.deepEqual(sr.custom_weeks, ['2026-10-19', '2026-11-16']);
  assert.match(await page.locator('.page.in').last().innerText(), /2 ausgewählte Wochen/);
  await page.locator('[data-tab="week"]').click();
  await page.waitForTimeout(300);
  await page.locator('[data-act="wk"][data-d="7"]').click();
  assert.equal(await page.locator('.tt-item', { hasText: 'Informatik' }).count(), 2, 'KW43: Vorlesung + Praktikum');
  await page.locator('[data-act="wk"][data-d="7"]').click();
  await page.locator('[data-act="wk"][data-d="7"]').click();
  assert.equal(await page.locator('.tt-item', { hasText: 'Informatik' }).count(), 1, 'KW45: nur Vorlesung');
  assert.deepEqual(errors, []);
  await ctx.close();
});

await test('Einstellungen, Hell/Dunkel, Löschen braucht Bestätigung', async () => {
  const { page, errors, ctx, mock } = await ready();
  await page.locator('[data-act="settings"]').click();
  await page.waitForSelector('.page.in');
  await page.waitForTimeout(450);
  await shot(page, '23-einstellungen');
  await overflowCheck(page, 'Einstellungen');
  await tapTargets(page, 'Einstellungen');
  await page.locator('[data-seg="theme"] [data-v="light"]').click();
  await page.waitForTimeout(200);
  await shot(page, '24-einstellungen-hell');
  await page.locator('[data-act="offset"][data-v="60"]').click();
  await page.waitForTimeout(400);
  assert.deepEqual(mock.db.settings[0].data.offsets, [1440, 180, 60]);
  await page.locator('.page.in [data-act="editSemester"]').click();
  await page.waitForTimeout(500);
  await shot(page, '25-semester');
  await overflowCheck(page, 'Semester');
  await page.locator('.page.in').last().locator('[data-act="delSemester"]').click();
  await page.waitForSelector('[data-word]');
  assert.equal(await page.locator('[data-yes]').isDisabled(), true);
  await page.fill('[data-word]', 'löschen');
  assert.equal(await page.locator('[data-yes]').isDisabled(), false);
  await page.locator('[data-no]').click();
  await page.waitForTimeout(500);
  assert.equal(mock.db.semesters.length, 1);
  assert.deepEqual(errors, []);
  await ctx.close();
});

await test('Alle Bildschirme sauber: schmal, groß, iPad, große Schrift, hell & dunkel', async () => {
  for (const [w, h, theme, scale] of [[320, 640, 'light', 1], [430, 932, 'dark', 1], [820, 1180, 'light', 1], [390, 844, 'dark', 1.3]]) {
    const { page, errors, ctx } = await ready({ width: w, height: h, theme, fontScale: scale });
    const tag = `${w}-${theme}${scale !== 1 ? '-gross' : ''}`;
    await shot(page, `30-heute-${tag}`);
    await overflowCheck(page, 'Heute ' + tag);
    await page.locator('.occ').first().click();
    await page.waitForSelector('.sheet-wrap.open');
    await page.waitForTimeout(450);
    await shot(page, `31-termin-${tag}`);
    await overflowCheck(page, 'Termin ' + tag);
    await page.locator('.sheet-h [data-close]').click();
    await page.waitForTimeout(450);
    for (const tab of ['Woche', 'Fächer', 'Prüfungen']) {
      await page.locator(`[data-tab="${{ Woche: 'week', Fächer: 'subjects', Prüfungen: 'exams' }[tab]}"]`).click();
      await page.waitForTimeout(200);
      await overflowCheck(page, `${tab} ${tag}`);
      if (tab === 'Woche') await shot(page, `32-woche-${tag}`);
    }
    assert.deepEqual(errors, [], tag);
    await ctx.close();
  }
});

await test('Fehlerfall: Server-Fehler wird wiederholt, kaputte Sicherung crasht nicht', async () => {
  const { page, errors, ctx, mock } = await ready();
  mock.state.failNext = 2;
  await page.locator('.occ [data-act="done"]').first().click();
  await page.waitForTimeout(7000);
  assert.equal(mock.db.occurrences[0]?.progress, 100);
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

await test('Mitteilungszentrale: Glocke, gelesen, Zahl am App-Symbol, Wischen zum Löschen', async () => {
  const { page, errors, ctx, mock } = await ready();
  await ctx.grantPermissions(['notifications']);
  await page.addInitScript(() => {
    window.__badge = null;
    navigator.setAppBadge = (n) => { window.__badge = n; return Promise.resolve(); };
    navigator.clearAppBadge = () => { window.__badge = 0; return Promise.resolve(); };
  });
  await page.reload();
  await page.waitForSelector('.occ');
  const uid = mock.users.get('joel@example.org').id;
  // Server verschickt drei Erinnerungen → kommen live in der App an
  mock.addNotification(uid, { key: 'o|a|2026-10-14|180', title: 'Werkstoffe · Vorlesung', body: 'Pflichttermin in 3 Std. um 13:30 · B120', url: './#day/2026-10-14', created_at: '2026-10-14T07:30:00Z' });
  mock.addNotification(uid, { key: 'e|b|start', title: 'Prüfungsanmeldung: Mathe 1', body: 'Frist endet morgen', url: './#exams', created_at: '2026-10-13T16:00:00Z' });
  mock.addNotification(uid, { key: 'test|1', title: 'Studyloop', body: 'Test-Mitteilung – so kommen deine Erinnerungen an.', url: './', created_at: '2026-10-14T08:10:00Z' });
  await page.waitForFunction(() => document.querySelector('.bell .nb')?.textContent === '3', null, { timeout: 4000 });
  await page.waitForFunction(() => window.__badge === 3);
  await shot(page, '20-glocke');
  await page.locator('[data-act="inbox"]').first().click();
  await page.waitForSelector('.page.in .nrow');
  await page.waitForTimeout(500);
  await shot(page, '21-mitteilungen');
  assert.deepEqual(await page.locator('.page .inbox .gh').allInnerTexts().then((a) => a.map((x) => x.trim().toLowerCase())), ['heute', 'gestern']);
  assert.equal(await page.locator('.page .nrow.new').count(), 3, 'neue sind markiert');
  await overflowCheck(page, 'Mitteilungen');
  // Öffnen = gelesen → überall gespeichert, Zahl am App-Symbol weg
  await page.waitForTimeout(600);
  assert.ok(mock.db.notifications.every((n) => n.read_at), 'alle gelesen gespeichert');
  await page.waitForFunction(() => window.__badge === 0);
  // nach links wischen → löschen
  const row = page.locator('.page .nrow').first();
  const bb = await row.boundingBox();
  await row.evaluate((el, bb) => {
    const ev = (type, x) => el.dispatchEvent(new PointerEvent(type, { pointerType: 'touch', pointerId: 7, bubbles: true, clientX: x, clientY: bb.y + bb.height / 2 }));
    ev('pointerdown', bb.x + bb.width - 20);
    for (let i = 1; i <= 8; i++) ev('pointermove', bb.x + bb.width - 20 - i * 14);
    ev('pointerup', bb.x + bb.width - 20 - 8 * 14);
  }, bb);
  await page.waitForTimeout(300);
  await shot(page, '22-wischen');
  await page.locator('.page .nrow-wrap.open .nrow-del').click();
  await page.waitForTimeout(500);
  assert.equal(mock.db.notifications.length, 2);
  // Antippen → springt zur Stelle (Prüfungen)
  await page.locator('.page .nrow', { hasText: 'Prüfungsanmeldung' }).click();
  await page.waitForTimeout(600);
  assert.equal(await title(page), 'Prüfungen');
  assert.equal(await page.locator('.bell .nb').count(), 0, 'keine Zahl mehr an der Glocke');
  // Alle löschen
  await page.locator('[data-act="inbox"]').first().click();
  await page.waitForSelector('.page.in [data-act="clearNotifs"]');
  await page.locator('.page.in [data-act="clearNotifs"]').click();
  await page.locator('.sheet-wrap.open [data-yes]').click();
  await page.waitForTimeout(600);
  assert.equal(mock.db.notifications.length, 0);
  await page.waitForSelector('.page.in .empty');
  await shot(page, '23-leer');
  // Einstellung: Zahl am App-Symbol = offene Termine
  await page.locator('.page.in [data-act="back"]').click();
  await page.waitForTimeout(500);
  await page.locator('[data-act="settings"]').first().click();
  await page.waitForSelector('.page.in [data-seg="badge"]');
  await page.locator('.page.in [data-seg="badge"] [data-v="open"]').click();
  await page.waitForTimeout(400);
  assert.equal(mock.db.settings[0].data.badge, 'open');
  assert.deepEqual(errors, []);
  await ctx.close();
});

await test('Demnächst Pflicht & Semesterübersicht', async () => {
  const { page, errors, ctx } = await ready();
  // dritten Termin heute (13:30) als Pflicht markieren
  await page.locator('.occ').nth(2).click();
  await page.waitForSelector('.sheet-wrap.open [data-sw="mandatory"]');
  await page.waitForTimeout(400);
  await page.locator('[data-sw="mandatory"]').check({ force: true });
  await page.waitForTimeout(500);
  await page.locator('.sheet-h [data-close]').click();
  await page.waitForTimeout(500);
  const card = page.locator('#main .gh', { hasText: 'Demnächst Pflicht' });
  assert.equal(await card.count(), 1, 'Karte auf Heute');
  await shot(page, '30-heute-pflicht');
  await card.locator('[data-act="pflicht"]').click();
  await page.waitForSelector('.page.in .pf-row');
  await page.waitForTimeout(400);
  await shot(page, '31-pflicht');
  const rows = await page.locator('.page.in .pf-row').allInnerTexts();
  assert.ok(rows.some((r) => /Werkstoffe/.test(r) && /13:30/.test(r)), 'Pflichttermin dabei');
  assert.ok(rows.some((r) => /Anmeldefrist|Prüfungsanmeldung/.test(r)), 'Frist dabei');
  assert.ok(rows.some((r) => /Klausur/.test(r)) || rows.length >= 2, 'Prüfungen dabei');
  // jede Woche bekommt den Pflichttermin (Reihe?) – nur der eine Termin wurde markiert
  assert.equal(rows.filter((r) => /Werkstoffe/.test(r)).length, 1);
  await page.locator('.page.in [data-seg="pf"] [data-v="exam"]').click();
  await page.waitForTimeout(200);
  assert.ok(!(await page.locator('.page.in .pf-row').allInnerTexts()).some((r) => /Werkstoffe/.test(r)), 'Filter Prüfungen');
  await overflowCheck(page, 'Pflicht');
  await page.locator('.page.in [data-act="back"]').click();
  await page.waitForTimeout(500);
  // Prüfungen-Tab hat den Einstieg
  await page.locator('[data-tab="exams"]').click();
  await page.waitForSelector('#main [data-act="pflicht"]');
  // Woche: Semesterübersicht
  await page.locator('[data-tab="week"]').click();
  await page.waitForSelector('#main .lt-link');
  await page.locator('#main .lt-link').click();
  await page.waitForSelector('.sheet-wrap.open .sm-tile');
  await page.waitForTimeout(500);
  await shot(page, '32-semester');
  const tiles = page.locator('.sheet-wrap.open .sm-tile');
  assert.ok(await tiles.count() >= 15, 'alle Wochen: ' + await tiles.count());
  assert.equal(await page.locator('.sheet-wrap.open .sm-tile.cur').count(), 1);
  assert.match(await page.locator('.sheet-wrap.open .sm-tile.cur').innerText(), /KW 42/);
  assert.ok(await page.locator('.sheet-wrap.open .sm-tile.k-project, .sheet-wrap.open .sm-tile.k-free, .sheet-wrap.open .sm-tile.k-exams').count() >= 1, 'andere Wochenarten');
  assert.ok(await page.locator('.sheet-wrap.open .mk.ex').count() >= 1, 'Prüfung markiert');
  await overflowCheck(page, 'Semesterübersicht');
  await page.locator('.sheet-wrap.open .sm-tile', { hasText: 'KW 46' }).click();
  await page.waitForTimeout(600);
  assert.match(await page.locator('#main .lt-sub').innerText(), /KW 46/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

await test('Zwei Geräte: Änderungen erscheinen live und nach Neustart überall gleich', async () => {
  const mock = createMock();
  const phone = await ready({ mock });
  const pad = await newApp({ mock, width: 820, height: 1180 });
  await pad.page.locator('[data-auth="in"]').click();
  await pad.page.waitForSelector('.sheet-wrap.open input[name=email]');
  await pad.page.fill('input[name=email]', 'joel@example.org');
  await pad.page.fill('input[name=password]', 'geheim123');
  await pad.page.locator('[data-submit]').click();
  await pad.page.waitForSelector('.occ');
  await pad.page.waitForTimeout(800);
  const card = (p) => p.locator('.occ').first().innerText();
  const setPct = async (p, v) => {
    await p.locator('.occ').first().click();
    await p.waitForSelector('.sheet-wrap.open [data-range]');
    await p.waitForTimeout(400);
    await setRange(p, v);
    await p.waitForTimeout(700);
    await p.locator('.sheet-h [data-close]').click();
    await p.waitForTimeout(500);
  };
  // iPad ändert → iPhone zeigt es ohne Neuladen
  await setPct(pad.page, 40);
  await phone.page.waitForFunction(() => /40 %/.test(document.querySelector('.occ')?.textContent || ''), null, { timeout: 4000 });
  // iPhone ändert denselben Termin → iPad übernimmt
  await setPct(phone.page, 70);
  await pad.page.waitForFunction(() => /70 %/.test(document.querySelector('.occ')?.textContent || ''), null, { timeout: 4000 });
  assert.equal(mock.db.occurrences[0].progress, 70);
  // Alles schließen und neu öffnen: überall der letzte Stand
  await phone.page.reload(); await pad.page.reload();
  await phone.page.waitForSelector('.occ'); await pad.page.waitForSelector('.occ');
  await phone.page.waitForTimeout(800);
  assert.match(await card(phone.page), /70 %/);
  assert.match(await card(pad.page), /70 %/);
  // nach dem Neustart läuft der Live-Abgleich weiter
  await setPct(pad.page, 20);
  await phone.page.waitForFunction(() => /20 %/.test(document.querySelector('.occ')?.textContent || ''), null, { timeout: 4000 });
  assert.deepEqual(phone.errors, []);
  assert.deepEqual(pad.errors, []);
  await phone.ctx.close(); await pad.ctx.close();
});

await test('Lernplan: Hero-Karte, abhaken, bleibt fest nach Neuladen, neu verteilen, Prüfung zieht vor', async () => {
  const { page, errors, ctx, mock } = await newApp({ time: '2026-10-21T10:40:00+02:00' });
  await signUp(page);
  await page.getByText('Hochschule Bonn-Rhein-Sieg').click();
  await page.getByText('ET1-EK3 · Gruppe B').click();
  await page.getByText('Alles seit Semesterbeginn').click();
  if (await page.locator('[data-skip]').count()) await page.locator('[data-skip]').click();
  await page.waitForSelector('.hero');
  const plan = () => page.locator('#main .occ.plan');
  const heroNum = () => page.locator('#main .hero-num').innerText();
  // ohne Prüfung: höchstens 3 Einträge am Tag
  assert.equal(await plan().count(), 3);
  assert.match(await heroNum(), /^3\s*Einträge/);
  await page.waitForFunction(() => true);
  await page.waitForTimeout(400);
  assert.equal(mock.db.settings[0]?.data.plan?.date, '2026-10-21', 'Plan für heute gespeichert');
  const planned = mock.db.settings[0].data.plan.items.map((x) => x.k);
  // abhaken: Zahl sinkt, Eintrag bleibt durchgestrichen im Plan
  await plan().first().locator('[data-act="done"]').click();
  await page.waitForTimeout(400);
  assert.match(await heroNum(), /^2\s*Einträge/);
  assert.equal(await plan().count(), 3);
  assert.equal(await page.locator('#main .occ.plan.is-done').count(), 1);
  assert.match(await page.locator('#plan').innerText(), /1\/3/);
  await shot(page, '40-lernplan');
  // neu laden: derselbe Plan
  await page.reload();
  await page.waitForSelector('.hero');
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#main .occ.plan.is-done').count(), 1);
  assert.deepEqual(mock.db.settings[0].data.plan.items.map((x) => x.k), planned);
  // alles abhaken → „Geschafft“
  for (let i = 0; i < 2; i++) { await page.locator('#main .occ.plan:not(.is-done) [data-act="done"]').first().click(); await page.waitForTimeout(250); }
  assert.match(await heroNum(), /Geschafft/);
  assert.equal(await page.locator('#main .hero.win').count(), 1);
  // Mathe-Klausur in 5 Tagen → neu verteilen holt Mathe nach vorn
  const mathe = mock.db.subjects.find((x) => x.name === 'Mathe 1');
  mock.db.exams.push({ id: 'e-ma', user_id: mathe.user_id, semester_id: mathe.semester_id, subject_id: mathe.id, kind: 'exam', title: 'Klausur Mathe 1', on_date: '2026-10-26', remind: true });
  await page.reload();
  await page.waitForSelector('.hero');
  await page.locator('[data-act="replan"]').click();
  await page.waitForTimeout(500);
  const names = await plan().locator('.name').allInnerTexts();
  assert.equal(names[0], 'Mathe 1');
  assert.ok(names.filter((n) => n === 'Mathe 1').length >= 2, 'Mathe bekommt mehr als einen Eintrag pro Tag');
  assert.match(await page.locator('#main .hero-tiles').innerText(), /Klausur\s*5\s*Tage/);
  await shot(page, '41-lernplan-pruefung');
  await overflowCheck(page, 'Lernplan 390');
  await tapTargets(page, 'Lernplan');
  await page.setViewportSize({ width: 320, height: 640 });
  await overflowCheck(page, 'Lernplan 320');
  assert.deepEqual(errors, []);
  await ctx.close();
});

await browser.close();
const failed = results.filter((r) => r[0] === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} ok`);
process.exit(failed.length ? 1 : 0);
