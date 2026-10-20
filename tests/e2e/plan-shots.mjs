// Bilder vom Lernplan auf „Heute“ (alle Termine seit Semesterbeginn offen, Klausur in 10 Tagen).
import { createMock } from './mock-supabase.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');
const SHOTS = process.env.SHOTS || 'shots';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
for (const theme of (process.env.THEMES || 'light,dark').split(',')) {
  for (const W of (process.env.WIDTHS || '390').split(',').map(Number)) {
    const mock = createMock();
    const ctx = await browser.newContext({ viewport: { width: W, height: 844 }, deviceScaleFactor: 2, isMobile: W < 700, hasTouch: true, locale: 'de-DE', timezoneId: 'Europe/Berlin', colorScheme: theme });
    await ctx.route('https://ibmhbjwkkgjuzyztakmg.supabase.co/**', mock.handle);
    await ctx.routeWebSocket(/ibmhbjwkkgjuzyztakmg\.supabase\.co\/realtime/, mock.ws);
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
    await p.clock.setFixedTime(new Date('2026-10-21T10:40:00+02:00'));
    await p.goto(process.env.BASE || 'http://localhost:8080/');
    await p.getByRole('button', { name: 'Konto erstellen' }).click();
    await p.fill('input[name=email]', 'joel@example.org');
    await p.fill('input[name=password]', 'geheim123');
    await p.locator('[data-submit]').click();
    await p.locator('[data-preset]').click();
    await p.locator('[data-tt="et1-ek3-b"]').click();
    await p.locator('[data-count="all"]').click();
    await p.locator('[data-skip]').click();
    await p.waitForSelector('.tabbar');
    await p.waitForTimeout(600);
    const s = async (n) => { await p.waitForTimeout(450); await p.screenshot({ path: `${SHOTS}/${theme}-${W}-${n}.png` }); };
    await s('a-today');
    await p.evaluate(() => document.getElementById('plan')?.scrollIntoView());
    await s('b-plan');
    console.log(theme, W, 'Fehler:', errs.join(' | ') || 'keine');
    await ctx.close();
  }
}
await browser.close();
