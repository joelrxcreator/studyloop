import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../js/schedule.js';
import { SEMESTER_PRESETS, buildFromPreset } from '../js/presets.js';

const preset = SEMESTER_PRESETS[0];
function data() {
  const b = buildFromPreset(preset, 'et1-ek3-b');
  return { semesters: [b.semester], subjects: b.subjects, series: b.series, occurrences: [], exams: b.exams };
}

test('Datumsgrundlagen', () => {
  assert.equal(S.weekday('2026-10-14'), 3);
  assert.equal(S.mondayOf('2026-10-18'), '2026-10-12');
  assert.equal(S.isoWeek('2026-10-14'), 42);
  assert.equal(S.isoWeek('2026-12-31'), 53);
  assert.equal(S.isoWeek('2027-01-01'), 53);
  assert.equal(S.isoWeek('2027-01-04'), 1);
  assert.equal(S.addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(S.addDays('2026-03-29', 1), '2026-03-30'); // Zeitumstellung egal
  assert.equal(S.diffDays('2026-10-14', '2027-01-25'), 103);
  assert.ok(S.isValidDate('2026-02-28'));
  assert.ok(!S.isValidDate('2026-02-30'));
});

test('Wochen der HBRS: dunkel/hell/Projekt', () => {
  const sem = data().semesters[0];
  assert.deepEqual(S.weekInfo(sem, '2026-10-14'), { kind: 'lecture', parity: 'A', monday: '2026-10-12' });
  assert.equal(S.weekInfo(sem, '2026-10-21').parity, 'B');
  assert.equal(S.weekInfo(sem, '2026-10-28').kind, 'project');
  assert.equal(S.weekInfo(sem, '2026-12-23').kind, 'free');
  assert.equal(S.weekInfo(sem, '2027-01-27').kind, 'exams');
  assert.equal(S.weekInfo(sem, '2026-09-01'), null);
  // 6 dunkle und 6 helle Wochen
  assert.equal(sem.weeks.filter((w) => w.p === 'A').length, 6);
  assert.equal(sem.weeks.filter((w) => w.p === 'B').length, 6);
});

test('Termine am Mittwoch 14.10. (KW42)', () => {
  const idx = S.buildIndex(data());
  const list = S.occurrencesOn(idx, '2026-10-14');
  assert.deepEqual(list.map((o) => `${o.starts} ${o.subject.code} ${o.series.kind}`), [
    '08:15 B1 exercise', '10:15 D1 lecture', '13:30 B1 lecture',
  ]);
  assert.ok(list.every((o) => !o.overlaps));
});

test('Start ab KW: Werkstoffe-Übung erst ab KW41, Schaltungstechnik-Übung Mo ab KW47', () => {
  const idx = S.buildIndex(data());
  const codes = (d) => S.occurrencesOn(idx, d).map((o) => o.subject.code + o.series.kind[0]);
  assert.ok(!codes('2026-09-30').includes('B1e'));
  assert.ok(codes('2026-10-07').includes('B1e'));
  assert.ok(!codes('2026-11-09').includes('P1e'));
  assert.ok(codes('2026-11-16').includes('P1e'));
});

test('Projektwoche, Feiertage und Ferien: keine Termine', () => {
  const idx = S.buildIndex(data());
  assert.equal(S.occurrencesOn(idx, '2026-10-28').length, 0);
  assert.equal(S.occurrencesOn(idx, '2026-12-14').length > 0, true);
  assert.equal(S.occurrencesOn(idx, '2026-12-23').length, 0);
  assert.equal(S.occurrencesOn(idx, '2027-01-27').length, 0);
});

test('Wochen-Regel dunkel/hell und eigene Auswahl', () => {
  const d = data();
  const sr = d.series.find((s) => s.weekday === 5 && s.kind === 'exercise' && s.starts_at === '08:15');
  sr.weeks_rule = 'B';
  let idx = S.buildIndex(d);
  assert.equal(S.occurrencesOn(idx, '2026-10-16').some((o) => o.series.id === sr.id), false); // KW42 dunkel
  assert.equal(S.occurrencesOn(idx, '2026-10-23').some((o) => o.series.id === sr.id), true);  // KW43 hell
  sr.weeks_rule = 'custom'; sr.custom_weeks = ['2026-11-09'];
  idx = S.buildIndex(d);
  assert.equal(S.occurrencesOn(idx, '2026-10-23').some((o) => o.series.id === sr.id), false);
  assert.equal(S.occurrencesOn(idx, '2026-11-13').some((o) => o.series.id === sr.id), true);
});

test('Einzeltermin, Ausfall, Verlegung, Pflicht', () => {
  const d = data();
  const sub = d.subjects[0];
  d.series.push({ id: 'once', subject_id: sub.id, kind: 'lecture', starts_at: '13:30', ends_at: '15:00', once_on: '2026-10-28', weeks_rule: 'all' });
  const tue = d.series.find((s) => s.weekday === 2 && s.kind === 'lecture' && s.starts_at === '09:00');
  d.occurrences.push({ series_id: tue.id, on_date: '2026-10-20', cancelled: true, progress: 0 });
  d.occurrences.push({ series_id: tue.id, on_date: '2026-10-27', progress: 0 }); // Projektwoche: findet nicht statt
  d.occurrences.push({ series_id: tue.id, on_date: '2026-11-03', starts_at: '12:00', ends_at: '13:30', room: 'HS1', mandatory: true, progress: 40 });
  const idx = S.buildIndex(d);
  assert.deepEqual(S.occurrencesOn(idx, '2026-10-28').map((o) => o.series.id), ['once']); // trotz Projektwoche
  const c = S.occurrencesOn(idx, '2026-10-20').find((o) => o.series.id === tue.id);
  assert.equal(c.cancelled, true);
  const m = S.occurrencesOn(idx, '2026-11-03').find((o) => o.series.id === tue.id);
  assert.equal(m.starts, '12:00'); assert.equal(m.room, 'HS1'); assert.equal(m.mandatory, true); assert.equal(m.moved, true); assert.equal(m.progress, 40);
});

test('Überschneidungen werden erkannt und in Spalten gelegt', () => {
  const d = data();
  const sub = d.subjects[1];
  d.series.push({ id: 'x', subject_id: sub.id, kind: 'lab', weekday: 3, starts_at: '09:00', ends_at: '11:00', weeks_rule: 'all' });
  const idx = S.buildIndex(d);
  const list = S.occurrencesOn(idx, '2026-10-14');
  const ov = list.filter((o) => o.overlaps).map((o) => o.starts);
  assert.deepEqual(ov, ['08:15', '09:00', '10:15']);
  const cols = S.layoutColumns(list);
  assert.equal(Math.max(...cols.map((c) => c.cols)), 2);
});

test('Statistik pro Fach, Rückstand, Cockpit-Sortierung', () => {
  const d = data();
  const mathe = d.subjects.find((s) => s.code === 'A1');
  const tue = d.series.find((s) => s.subject_id === mathe.id && s.weekday === 2);
  d.occurrences.push({ series_id: tue.id, on_date: '2026-09-29', progress: 100, stars: 2 });
  d.occurrences.push({ series_id: tue.id, on_date: '2026-10-06', progress: 50, stars: 4 });
  const idx = S.buildIndex(d);
  const st = S.subjectStats(idx, mathe.id, '2026-10-14', 12 * 60);
  // fällige Mathe-Termine bis Mi 14.10.: Di 29.9., Fr 2.10., Mo 5.10. (Brückenkurs), Di 6.10., Fr 9.10., Mo 12.10., Di 13.10.
  assert.equal(st.due.length, 7);
  assert.equal(st.avgStars, 3);
  assert.equal(st.weak.length, 1);
  assert.equal(st.open.length, 6);
  assert.ok(st.total > st.due.length);
  const sorted = S.sortForReview(st.open);
  assert.equal(sorted[0].progress, 0);
  const bl = S.backlog(idx, d.semesters[0].id, '2026-10-14', 12 * 60);
  assert.ok(bl.count >= 6 && bl.minutes > 0);
});

test('Serie: Wochenende unterbricht nicht, Tag mit Terminen ohne Eintrag schon', () => {
  const idx = S.buildIndex(data());
  // Fr 9.10., Sa/So frei, Mo 12.10., Di 13.10. aktiv; heute Mi 14.10. noch nichts
  assert.equal(S.streak(idx, ['2026-10-09', '2026-10-12', '2026-10-13'], '2026-10-14'), 3);
  assert.equal(S.streak(idx, ['2026-10-09', '2026-10-12', '2026-10-13', '2026-10-14'], '2026-10-14'), 4);
  // Do 8.10. hat keine Termine → zählt nicht als Lücke; Mi 7.10. aktiv
  assert.equal(S.streak(idx, ['2026-10-07', '2026-10-09'], '2026-10-09'), 2);
  // Di 13.10. vergessen → Serie bricht
  assert.equal(S.streak(idx, ['2026-10-09', '2026-10-12', '2026-10-14'], '2026-10-14'), 1);
  assert.equal(S.streak(idx, [], '2026-10-14'), 0);
});

test('Wochenlast', () => {
  const idx = S.buildIndex(data());
  const wl = S.weekLoad(idx, '2026-10-12', '2026-10-14', 12 * 60);
  assert.equal(wl.length, 7);
  assert.equal(wl[3].minutes, 0); // Donnerstag frei
  assert.equal(wl[4].minutes, 90 + 150 + 195);
  assert.ok(wl[0].open > 0 && wl[4].open === 0);
});

test('Zeitzonen Europe/Berlin (Sommer/Winter)', () => {
  const tz = 'Europe/Berlin';
  assert.equal(new Date(S.zonedToUtc('2026-10-14', '08:15', tz)).toISOString(), '2026-10-14T06:15:00.000Z');
  assert.equal(new Date(S.zonedToUtc('2026-11-03', '08:15', tz)).toISOString(), '2026-11-03T07:15:00.000Z');
  assert.deepEqual(S.utcToZoned(Date.parse('2026-10-25T00:30:00Z'), tz), { date: '2026-10-25', min: 2 * 60 + 30 });
  assert.deepEqual(S.utcToZoned(Date.parse('2026-10-25T01:30:00Z'), tz), { date: '2026-10-25', min: 2 * 60 + 30 });
});

test('Ruhezeit verschiebt Erinnerungen sinnvoll', () => {
  const q = { on: true, from: '22:00', to: '07:00' };
  // 05:15 → 07:00 (Termin 08:15)
  assert.deepEqual(S.adjustForQuiet({ date: '2026-10-14', min: 315 }, { date: '2026-10-14', min: 495 }, q), { date: '2026-10-14', min: 420 });
  // 05:00 für Termin 06:30 → Vorabend 21:59
  assert.deepEqual(S.adjustForQuiet({ date: '2026-10-14', min: 300 }, { date: '2026-10-14', min: 390 }, q), { date: '2026-10-13', min: 1319 });
  // 23:00 für Termin morgen 10:00 → morgen 07:00
  assert.deepEqual(S.adjustForQuiet({ date: '2026-10-13', min: 1380 }, { date: '2026-10-14', min: 600 }, q), { date: '2026-10-14', min: 420 });
  // außerhalb der Ruhezeit unverändert
  assert.deepEqual(S.adjustForQuiet({ date: '2026-10-14', min: 600 }, { date: '2026-10-14', min: 700 }, q), { date: '2026-10-14', min: 600 });
});

test('Erinnerungen: Pflichttermin 1 Tag + 3 Std. vorher, Prüfungen, Fristen', () => {
  const d = data();
  const tz = 'Europe/Berlin';
  const wed = d.series.find((s) => s.weekday === 3 && s.starts_at === '13:30');
  d.occurrences.push({ series_id: wed.id, on_date: '2026-10-21', mandatory: true, progress: 0 });
  d.exams.push({ id: 'ex1', kind: 'exam', title: 'Mathe 1', on_date: '2026-10-30', starts_at: '09:00', remind: true });
  const all = S.dueReminders(d, {}, tz, Date.parse('2026-10-14T00:00:00Z'), Date.parse('2026-10-31T00:00:00Z'));
  const occ = all.filter((r) => r.key.startsWith('o|'));
  assert.deepEqual(occ.map((r) => new Date(r.at).toISOString()), ['2026-10-20T11:30:00.000Z', '2026-10-21T08:30:00.000Z']);
  assert.match(occ[0].body, /morgen um 13:30/);
  assert.match(occ[1].body, /in 3 Std\./);
  const ex = all.filter((r) => r.key.startsWith('e|ex1'));
  assert.equal(ex.length, 3); // 1 Woche, 1 Tag, 3 Std (06:00 → Ruhezeit → 07:00)
  assert.equal(new Date(ex[2].at).toISOString(), '2026-10-30T06:00:00.000Z');
  const reg = all.filter((r) => r.title.startsWith('Anmeldung'));
  assert.deepEqual(reg.map((r) => r.body), ['Frist endet morgen', 'Frist endet heute']);
  // Schlüssel eindeutig
  assert.equal(new Set(all.map((r) => r.key)).size, all.length);
});

test('Einstellungen normalisieren: kaputte Werte fallen auf Standard zurück', () => {
  const s = S.normalizeSettings({ offsets: ['180', -5, 'x', 1440, 1440], quiet: { from: 'abc' } });
  assert.deepEqual(s.offsets, [1440, 180]);
  assert.equal(s.quiet.from, '22:00');
  assert.deepEqual(S.normalizeSettings(null).offsets, [1440, 180]);
});

test('Kalender-Export (.ics) ist gültig aufgebaut', async () => {
  globalThis.document ??= undefined;
  const { buildIcs } = await import('../js/apple.js');
  const ics = buildIcs([
    { uid: 'a', title: 'Mathe 1 · Vorlesung; Raum, neu', date: '2026-10-20', start: '09:00', end: '11:30', location: 'HS7', alarmMin: 60 },
    { uid: 'b', title: 'Prüfungsanmeldung', date: '2026-10-12', endDate: '2026-10-18' },
  ], 'Studyloop');
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
  assert.match(ics, /DTSTART;TZID=Europe\/Berlin:20261020T090000/);
  assert.match(ics, /DTEND;TZID=Europe\/Berlin:20261020T113000/);
  assert.ok(ics.includes('SUMMARY:Mathe 1 · Vorlesung\\; Raum\\, neu'), 'Sonderzeichen maskiert');
  assert.match(ics, /DTSTART;VALUE=DATE:20261012\r\nDTEND;VALUE=DATE:20261019/);
  assert.match(ics, /TRIGGER:-PT60M/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.ok(ics.split('\r\n').every((l) => l.length <= 75), 'Zeilen max. 75 Zeichen');
});
