// Gemeinsamer UI-Zustand und Navigation (wird von app.js befüllt).
import * as S from './schedule.js';
import { store } from './store.js';

export const ui = {
  tab: 'day',
  day: S.localDate(),
  weekMon: S.mondayOf(S.localDate()),
  ttMon: S.mondayOf(S.localDate()),
  semId: null,
  showDone: false,
  showPast: false,
};

/** Navigations-Funktionen, von app.js gesetzt. */
export const nav = {
  go: () => {}, render: () => {}, openSettings: () => {}, pushPage: () => {}, popPage: () => {}, openTimetable: () => {}, closeTimetable: () => {},
};

export const today = () => S.localDate();
export const nowMin = () => S.localMinutes();

/** Aktuelles Semester: das heutige, sonst das nächste kommende, sonst das zuletzt beendete. */
export function currentSemester(date = today()) {
  const sems = store.data.semesters;
  if (!sems.length) return null;
  if (ui.semId) { const s = sems.find((x) => x.id === ui.semId); if (s) return s; }
  return S.semesterFor(sems, date)
    || [...sems].filter((s) => s.starts_on > date).sort((a, b) => (a.starts_on < b.starts_on ? -1 : 1))[0]
    || [...sems].sort((a, b) => (a.ends_on > b.ends_on ? -1 : 1))[0];
}

export const subjectsOf = (semId) => store.data.subjects.filter((s) => s.semester_id === semId).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
