# Studyloop

Studien-Begleiter als Web-App für den iPhone-Home-Bildschirm: Stundenplan, Fortschritt & Sterne pro Termin,
Lern-Cockpit pro Fach, täglicher Lernplan bis zur Prüfung, Prüfungs-Countdown und Push-Erinnerungen für Pflichttermine.

## Aufbau

| Teil | Ort |
| --- | --- |
| App (reines HTML/CSS/JS, kein Build) | `index.html`, `css/`, `js/`, `icons/`, `sw.js`, `manifest.webmanifest` |
| Kernlogik (Wochen, Termine, Statistik, Erinnerungen) | `js/schedule.js` – identische Kopie in `supabase/functions/reminders/` |
| Datenbank (Supabase, RLS pro Konto) | `supabase/migrations/` |
| Server-Funktion (Web Push alle 5 min, Test, Konto löschen) | `supabase/functions/reminders/` |
| Vorlagen (HBRS WiSe 26/27, ET1-EK3 Gr. B) | `js/presets.js` |

- **Hosting:** GitHub Pages (Branch-Root). Supabase-Projekt `studyloop` (eu-central-1).
- **Datenmodell:** Terminreihen (`series`) erzeugen die einzelnen Termine; Fortschritt/Sterne/Notiz/Pflicht/Ausfall
  liegen pro Datum in `occurrences`. Semesterwochen (Vorlesung dunkel/hell, Projekt, frei, Prüfungen) stehen im Semester.
- **Lernplan:** `studyPlan()` in `js/schedule.js` verteilt Offenes (und vor Prüfungen Schwaches) gleichmäßig bis zur Prüfung;
  der Plan des Tages wird in den Einstellungen festgeschrieben, damit Abhaken ihn nicht verschiebt.
- **Speichern:** sofort lokal, dann über eine Warteschlange an Supabase (wiederholt bei Netzfehlern, übersteht Neustart).

## Tests

```bash
npm test                                   # Kernlogik + Web-Push-Verschlüsselung (node --test)
npx http-server -p 8080 -c-1 . &           # App lokal
PLAYWRIGHT=$(npm root -g)/playwright/index.mjs node tests/e2e/run.mjs   # Browser-Durchlauf gegen Supabase-Nachbau
```

## Ändern der Kernlogik

`js/schedule.js` bearbeiten, dann nach `supabase/functions/reminders/schedule.js` kopieren und die Funktion neu deployen
(ein Test schlägt fehl, solange die Kopien abweichen).
