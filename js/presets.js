// Vorlagen für den Start. Später können hier weitere Hochschulen/Studiengänge ergänzt werden.

const W = (w, k, p = null) => ({ w, k, p });

export const SEMESTER_PRESETS = [
  {
    id: 'hbrs-iwk-ws2627',
    school: 'Hochschule Bonn-Rhein-Sieg',
    label: 'Fachbereich IWK · Wintersemester 2026/27',
    semester: {
      name: 'WiSe 2026/27',
      starts_on: '2026-09-28',
      ends_on: '2027-03-28',
      parity_labels: ['Dunkle Woche', 'Helle Woche'],
      // Rhythmus 4-1-4-1-4-1: Vorlesungswochen abwechselnd dunkel/hell, dazwischen Projektwochen
      weeks: [
        W('2026-09-28', 'lecture', 'A'), W('2026-10-05', 'lecture', 'B'),
        W('2026-10-12', 'lecture', 'A'), W('2026-10-19', 'lecture', 'B'),
        W('2026-10-26', 'project'),
        W('2026-11-02', 'lecture', 'A'), W('2026-11-09', 'lecture', 'B'),
        W('2026-11-16', 'lecture', 'A'), W('2026-11-23', 'lecture', 'B'),
        W('2026-11-30', 'project'),
        W('2026-12-07', 'lecture', 'A'), W('2026-12-14', 'lecture', 'B'),
        W('2026-12-21', 'free'), W('2026-12-28', 'free'),
        W('2027-01-04', 'lecture', 'A'), W('2027-01-11', 'lecture', 'B'),
        W('2027-01-18', 'project'),
        W('2027-01-25', 'exams'), W('2027-02-01', 'exams'),
        W('2027-02-08', 'free'), W('2027-02-15', 'free'), W('2027-02-22', 'free'), W('2027-03-01', 'free'),
        W('2027-03-08', 'exams'), W('2027-03-15', 'exams'), W('2027-03-22', 'exams'),
      ],
      holidays: [
        { from: '2026-10-03', to: '2026-10-03', name: 'Tag der Deutschen Einheit' },
        { from: '2026-11-01', to: '2026-11-01', name: 'Allerheiligen' },
        { from: '2026-12-19', to: '2027-01-03', name: 'Weihnachtsferien' },
      ],
    },
    exams: [
      { kind: 'registration', title: 'Prüfungsanmeldung (veranstaltungsbegleitend)', on_date: '2026-10-12', until_date: '2026-10-18', note: 'Bachelor- und Master-Studiengänge' },
      { kind: 'other', title: 'Tag des offenen Projekts', on_date: '2027-01-22', remind: false },
      { kind: 'period', title: '1. Prüfungszeitraum', on_date: '2027-01-25', until_date: '2027-02-05', note: 'Genaue Termine im Fachbereichszeitplan auf LEA', remind: false },
      { kind: 'period', title: '2. Prüfungszeitraum', on_date: '2027-03-10', until_date: '2027-03-25', note: 'Genaue Termine im Fachbereichszeitplan auf LEA', remind: false },
    ],
    timetables: [
      {
        id: 'et1-ek3-b',
        label: 'ET1-EK3 · Gruppe B',
        subjects: [
          { key: 'A1', name: 'Mathe 1', code: 'A1', color: 'blue' },
          { key: 'B1', name: 'Werkstoffe', code: 'B1', color: 'orange' },
          { key: 'C1', name: 'Grundlagen ET 1', code: 'C1', color: 'green' },
          { key: 'D1', name: 'Informatik 1', code: 'D1', color: 'purple' },
          { key: 'E1', name: 'Energieeffizienz + EE', code: 'E1', color: 'yellow' },
          { key: 'P1', name: 'Schaltungstechnik', code: 'P1', color: 'pink' },
        ],
        series: [
          // Montag
          { s: 'C1', kind: 'lecture', weekday: 1, starts_at: '08:15', ends_at: '09:45', room: 'HS7', lecturer: 'Ap' },
          { s: 'A1', kind: 'lesson', weekday: 1, starts_at: '10:00', ends_at: '11:30', room: 'B134', lecturer: 'Hd', note: 'Brückenkurs Mathe 1', valid_from: '2026-10-05' },
          { s: 'P1', kind: 'exercise', weekday: 1, starts_at: '11:45', ends_at: '13:15', room: 'B101+B105', lecturer: 'Vo+Sk', valid_from: '2026-11-16' },
          { s: 'D1', kind: 'lab', weekday: 1, starts_at: '15:15', ends_at: '16:45', room: 'B114', lecturer: 'Flt', group_label: 'Gr. d/4', valid_from: '2026-10-12' },
          { s: 'E1', kind: 'exercise', weekday: 1, starts_at: '17:00', ends_at: '18:30', room: 'B022', lecturer: 'Sm', group_label: 'Gr. B', valid_from: '2026-10-05' },
          // Dienstag
          { s: 'A1', kind: 'lecture', weekday: 2, starts_at: '09:00', ends_at: '11:30', room: 'HS7', lecturer: 'Hd' },
          { s: 'P1', kind: 'exercise', weekday: 2, starts_at: '14:15', ends_at: '15:45', room: 'B150', lecturer: 'GIn' },
          { s: 'E1', kind: 'lecture', weekday: 2, starts_at: '16:00', ends_at: '17:30', room: 'B150', lecturer: 'Sm' },
          // Mittwoch
          { s: 'B1', kind: 'exercise', weekday: 3, starts_at: '08:15', ends_at: '09:45', room: 'B150', lecturer: 'Ka', group_label: 'Gr. B', valid_from: '2026-10-05' },
          { s: 'D1', kind: 'lecture', weekday: 3, starts_at: '10:15', ends_at: '12:30', room: 'HS7', lecturer: 'Flt' },
          { s: 'B1', kind: 'lecture', weekday: 3, starts_at: '13:30', ends_at: '15:00', room: 'B120', lecturer: 'Ka' },
          // Freitag
          { s: 'C1', kind: 'exercise', weekday: 5, starts_at: '08:15', ends_at: '09:45', room: 'B121', lecturer: 'Ap', group_label: 'Gr. B' },
          { s: 'A1', kind: 'exercise', weekday: 5, starts_at: '10:00', ends_at: '12:30', room: 'B150', lecturer: 'Hd', group_label: 'Gr. B' },
          { s: 'B1', kind: 'lab', weekday: 5, starts_at: '13:30', ends_at: '16:45', room: 'B108+B069+B073', lecturer: 'Jo+Lu+Ka+Fro', group_label: 'Gr. B', valid_from: '2026-10-12' },
        ],
      },
    ],
  },
];

export const uuid = () =>
  (globalThis.crypto?.randomUUID?.() ||
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    }));

/** Erzeugt Zeilen für Semester (+ optional Stundenplan) aus einer Vorlage. */
export function buildFromPreset(preset, timetableId) {
  const semId = uuid();
  const semester = { id: semId, ...structuredClone(preset.semester) };
  const subjects = [], series = [];
  const keyToId = {};
  const tt = preset.timetables.find((t) => t.id === timetableId);
  if (tt) {
    tt.subjects.forEach((s, i) => {
      const id = uuid();
      keyToId[s.key] = id;
      subjects.push({ id, semester_id: semId, name: s.name, code: s.code, color: s.color, sort: i });
    });
    for (const r of tt.series) {
      const { s, ...rest } = r;
      series.push({
        id: uuid(), subject_id: keyToId[s], weeks_rule: 'all', custom_weeks: [], every_week: false, mandatory: false,
        valid_from: null, valid_until: null, once_on: null, group_label: null, note: null, room: null, lecturer: null, ...rest,
      });
    }
  }
  const exams = preset.exams.map((e) => {
    const subject = e.subject ? subjects.find((x) => x.code === e.subject) : null;
    return { id: uuid(), semester_id: semId, subject_id: subject?.id || null, until_date: null, starts_at: null, ends_at: null, room: null, note: null, remind: true, ...e };
  });
  return { semester, subjects, series, exams };
}
