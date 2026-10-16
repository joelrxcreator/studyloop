// Bearbeiten: einzelner Termin, Terminreihe, Fach, Prüfung, Stundenplan-Seite, Semester.
import * as S from './schedule.js';
import { store, idx, put, putMany, remove, patchOcc } from './store.js';
import { icon } from './icons.js';
import { esc, sheet, toast, confirmDialog, seg, bindSegs, segValue, sw, fmtDate, fmtLong, fmtRange, fmtDayTitle, WD, WD_LONG, COLORS, COLOR_NAMES, haptic, navBar, largeTitle, backBtn } from './ui.js';
import { ui, nav, today, nowMin, currentSemester, subjectsOf } from './ctx.js';
import { uuid, SEMESTER_PRESETS, buildFromPreset } from './presets.js';
import { pushState } from './push.js';
import { buildIcs, shareIcs } from './apple.js';

const KIND_OPTS = Object.entries(S.KINDS).map(([k, v]) => [k, v.label]);
const short = (l) => l.replace(' Woche', '').replace('Woche ', '');
/** Alle Wochen des Semesters, in denen regelmäßige Termine stattfinden können. */
function lectureWeeks(sem, all = false) {
  const out = [];
  for (let m = S.mondayOf(sem.starts_on); m <= sem.ends_on; m = S.addDays(m, 7)) {
    const w = (sem.weeks || []).find((x) => x.w === m);
    if (all || !w || w.k === 'lecture') out.push({ w: m, p: w?.p || null });
  }
  return out;
}

// ======================= EINZELNER TERMIN =======================
export function openOcc(key) {
  const [sid, date] = key.split('|');
  const sr = store.data.series.find((s) => s.id === sid);
  if (!sr) { toast('Diesen Termin gibt es nicht mehr.'); return; }
  const get = () => S.makeOcc(idx(), store.data.series.find((s) => s.id === sid) || sr, date);
  let o = get();
  let noteTimer = 0;
  let pendingNote = null;
  const flushNote = () => { if (pendingNote != null) { patchOcc(get(), { note: pendingNote.trim() || null }); pendingNote = null; } };

  sheet({
    title: o.subject?.name || 'Termin',
    onClose: () => { clearTimeout(noteTimer); flushNote(); },
    render(b, api) {
      const draw = () => {
        o = get();
        const t = today();
        const future = !S.isDue(o, t, nowMin()) && !o.cancelled;
        const kind = S.KINDS[sr.kind]?.label || 'Termin';
        const offs = store.settings.offsets.map(S.offsetLabel).join(' & ');
        const hints = ['Noch nicht bewertet', 'Gar nicht', 'Wackelig', 'Geht so', 'Ziemlich sicher', 'Sitzt'];
        b.innerHTML = `
        <div data-c="${o.subject?.color || 'slate'}">
          <div style="display:flex;gap:12px;align-items:center;padding:4px 4px 0">
            <span class="sq lg">${esc((o.subject?.code || o.subject?.name || '').slice(0, 3))}</span>
            <div style="flex:1;min-width:0">
              <div style="font-weight:600">${esc(kind)} · ${fmtLong(date)}</div>
              <div class="sub">${o.starts}–${o.ends}${o.room ? ' · ' + esc(o.room) : ''}${sr.lecturer ? ' · ' + esc(sr.lecturer) : ''}${sr.group_label ? ' · ' + esc(sr.group_label) : ''}</div>
            </div>
          </div>
          ${o.cancelled || o.mandatory || o.moved || o.overlaps || future ? `<div class="chips" style="margin:10px 4px 0">
            ${o.cancelled ? '<span class="chip red">Fällt aus</span>' : ''}${o.mandatory && !o.cancelled ? '<span class="chip red">Pflicht</span>' : ''}
            ${o.moved ? '<span class="chip amber">Verlegt</span>' : ''}${o.overlaps ? '<span class="chip amber">Überschneidet sich</span>' : ''}${future ? '<span class="chip">Kommt noch</span>' : ''}</div>` : ''}

          <div ${o.cancelled ? 'hidden' : ''}>
            <div class="gh">Bearbeitet<b data-pct class="num" style="font-family:var(--round);font-size:1.18rem;color:var(--label);text-transform:none">${o.progress} %</b></div>
            <div class="group"><div class="cell" style="padding:2px 16px"><input type="range" class="range" min="0" max="100" step="5" value="${o.progress}" style="--p:${o.progress}%" data-range aria-label="Fortschritt in Prozent"></div></div>
            <div class="gf">Wie viel der Vorlesung bzw. Übung du schon nachgearbeitet hast.</div>
            <div class="gh">Sicherheit<span data-starhint style="text-transform:none">${hints[o.stars || 0]}</span></div>
            <div class="group"><div class="cell" style="padding:2px 6px"><div class="stars" style="flex:1">${[1, 2, 3, 4, 5].map((n) => `<button data-star="${n}" class="${o.stars >= n ? 'on' : ''}" aria-label="${n} von 5 Sternen">${icon('star')}</button>`).join('')}</div></div></div>
          </div>

          <div class="gh">Notiz</div>
          <textarea data-note maxlength="2000" placeholder="z. B. Kapitel 5 nochmal anschauen">${esc(o.note)}</textarea>

          <div class="group" style="margin-top:22px">
            <label class="cell ic"><span class="sq red">${icon('bell')}</span><span class="main"><span class="t">Pflichttermin</span></span>${sw('mandatory', o.mandatory, 'Pflichttermin')}</label>
          </div>
          <div class="gf">${o.mandatory ? `Du wirst ${esc(offs || 'nicht')} vorher erinnert.` : 'Bei Pflichtterminen bekommst du eine Erinnerung aufs Handy.'}</div>

          <div class="gh">Nur dieser Termin</div>
          <div class="group">
            <label class="cell ic"><span class="sq gray">${icon('calX')}</span><span class="main"><span class="t">Fällt aus</span></span>${sw('cancelled', o.cancelled, 'Fällt aus')}</label>
            <button class="cell ic" data-move><span class="sq blue">${icon('clock')}</span><span class="main"><span class="t">Zeit oder Raum ändern</span>${o.moved ? '<span class="s">Geändert</span>' : ''}</span>${icon('right', 'chev')}</button>
          </div>
          <div data-movebox hidden style="margin-top:12px">
            <div class="form">
              <div class="grid2"><label class="field"><span>Beginn</span><input type="time" data-ms value="${o.starts}"></label><label class="field"><span>Ende</span><input type="time" data-me value="${o.ends}"></label></div>
              <label class="field"><span>Raum</span><input data-mr value="${esc(o.room)}" maxlength="60" placeholder="${esc(sr.room || 'Raum')}"></label>
              <div class="btn-row"><button class="btn" data-mreset ${o.moved ? '' : 'disabled'}>Zurücksetzen</button><button class="btn primary" data-msave>Übernehmen</button></div>
            </div>
          </div>

          <div class="group" style="margin-top:22px"><button class="cell accent" data-series><span class="main"><span class="t">Terminreihe bearbeiten</span></span></button></div>
          <div class="gf">Ändert alle Wochen dieses Termins, z. B. Raum oder Uhrzeit.</div>
        </div>`;
        bind();
      };

      const bind = () => {
        const range = b.querySelector('[data-range]');
        const pct = b.querySelector('[data-pct]');
        const setVal = (v, save) => {
          range.value = v; range.style.setProperty('--p', v + '%'); pct.textContent = v + ' %';
          if (!save && Number(v) % 25 === 0) haptic();
          if (save && Number(v) !== get().progress) { patchOcc(get(), { progress: Number(v) }); haptic(); }
        };
        range.addEventListener('input', () => setVal(range.value, false));
        range.addEventListener('change', () => setVal(range.value, true));
        b.querySelectorAll('[data-quick]').forEach((x) => x.addEventListener('click', () => setVal(x.dataset.quick, true)));
        b.querySelectorAll('[data-star]').forEach((x) => x.addEventListener('click', () => {
          const n = Number(x.dataset.star);
          const v = get().stars === n ? null : n;
          patchOcc(get(), { stars: v });
          haptic();
          b.querySelectorAll('[data-star]').forEach((y) => y.classList.toggle('on', v != null && Number(y.dataset.star) <= v));
          b.querySelector('[data-starhint]').textContent = ['Noch nicht bewertet', 'Gar nicht', 'Wackelig', 'Geht so', 'Ziemlich sicher', 'Sitzt'][v || 0];
        }));
        const note = b.querySelector('[data-note]');
        note.addEventListener('input', () => { pendingNote = note.value; clearTimeout(noteTimer); noteTimer = setTimeout(flushNote, 600); });
        note.addEventListener('blur', () => { clearTimeout(noteTimer); flushNote(); });
        b.querySelector('[data-sw="mandatory"]').addEventListener('change', (e) => {
          const v = e.target.checked;
          patchOcc(get(), { mandatory: v === !!sr.mandatory ? null : v });
          draw();
          if (v) {
            const ps = pushState();
            if (ps.permission !== 'granted') toast('Mitteilungen sind auf diesem Gerät noch aus.', { action: { label: 'Einschalten', fn: () => { api.close(); nav.openSettings(); } } });
            else toast('Du wirst vorher erinnert.');
          }
        });
        b.querySelector('[data-sw="cancelled"]').addEventListener('change', (e) => { patchOcc(get(), { cancelled: e.target.checked }); draw(); });
        b.querySelector('[data-move]').addEventListener('click', () => { const box = b.querySelector('[data-movebox]'); box.hidden = !box.hidden; if (!box.hidden) box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); });
        b.querySelector('[data-msave]').addEventListener('click', () => {
          const s = b.querySelector('[data-ms]').value, e = b.querySelector('[data-me]').value, r = b.querySelector('[data-mr]').value.trim();
          if (!s || !e || S.toMin(e) <= S.toMin(s)) { toast('Das Ende muss nach dem Beginn liegen.', { error: true }); return; }
          const same = s === S.hhmm(sr.starts_at) && e === S.hhmm(sr.ends_at);
          patchOcc(get(), { starts_at: same ? null : s, ends_at: same ? null : e, room: r && r !== (sr.room || '') ? r : null });
          toast('Nur dieser Termin wurde geändert.');
          draw();
        });
        b.querySelector('[data-mreset]').addEventListener('click', () => { patchOcc(get(), { starts_at: null, ends_at: null, room: null }); draw(); });
        b.querySelector('[data-series]').addEventListener('click', () => { flushNote(); api.close(); openSeries(store.data.series.find((s) => s.id === sid)); });
      };
      draw();
    },
  });
}

// ======================= TERMINREIHE =======================
export function openSeries(existing, preset = {}) {
  const sem = existing ? store.data.semesters.find((x) => x.id === idx().subById.get(existing.subject_id)?.semester_id) : currentSemester();
  if (!sem) { toast('Lege zuerst ein Semester an.'); return; }
  const subs = subjectsOf(sem.id);
  if (!subs.length) { openSubject(null, sem.id, (sub) => openSeries(null, { subject_id: sub.id })); return; }
  const hasParity = (sem.weeks || []).some((w) => w.p);
  const v = existing ? { ...existing } : {
    subject_id: preset.subject_id || subs[0].id, kind: 'lecture', weekday: preset.weekday || 1, starts_at: '08:15', ends_at: '09:45',
    weeks_rule: 'all', custom_weeks: [], every_week: false, mandatory: false, room: '', lecturer: '', group_label: '', note: '',
    valid_from: null, valid_until: null, once_on: null,
  };
  v.starts_at = S.hhmm(v.starts_at); v.ends_at = S.hhmm(v.ends_at);
  let mode = v.once_on ? 'once' : 'weekly';

  sheet({
    title: existing ? 'Termin bearbeiten' : 'Neuer Termin', primary: existing ? 'Sichern' : 'Hinzufügen',
    render(b, api) {
      const labels = Array.isArray(sem.parity_labels) ? sem.parity_labels : ['Woche A', 'Woche B'];
      b.innerHTML = `<div class="form">
        <label class="field"><span>Fach</span><select data-f="subject_id">${subs.map((s) => `<option value="${s.id}" ${s.id === v.subject_id ? 'selected' : ''}>${esc(s.code ? s.code + ' · ' : '')}${esc(s.name)}</option>`).join('')}<option value="__new">+ Neues Fach …</option></select></label>
        <div class="field"><span>Art</span>${seg('kind', KIND_OPTS, v.kind)}</div>
        <div class="field"><span>Wiederholung</span>${seg('mode', [['weekly', 'Jede Woche'], ['once', 'Einmalig']], mode)}</div>
        <div data-weekly class="form">
          <div class="field"><span>Wochentag</span>${seg('weekday', WD.map((d, i) => [i + 1, d]), v.weekday)}</div>
          <div class="field"><span>In welchen Wochen?</span>${seg('weeks_rule', [['all', 'Jede'], ...(hasParity ? [['A', short(labels[0])], ['B', short(labels[1])]] : []), ['custom', 'Auswahl']], v.weeks_rule)}
            <span class="hint" data-wrhint></span></div>
          <div class="chips" data-customweeks></div>
          <div class="grid2"><label class="field"><span>Ab (optional)</span><input type="date" data-f="valid_from" value="${v.valid_from || ''}" min="${sem.starts_on}" max="${sem.ends_on}"></label>
          <label class="field"><span>Bis (optional)</span><input type="date" data-f="valid_until" value="${v.valid_until || ''}" min="${sem.starts_on}" max="${sem.ends_on}"></label></div>
        </div>
        <label class="field" data-once><span>Datum</span><input type="date" data-f="once_on" value="${v.once_on || ''}"></label>
        <div class="grid2"><label class="field"><span>Beginn</span><input type="time" data-f="starts_at" value="${v.starts_at}"></label><label class="field"><span>Ende</span><input type="time" data-f="ends_at" value="${v.ends_at}"></label></div>
        <div class="grid2"><label class="field"><span>Raum</span><input data-f="room" value="${esc(v.room || '')}" maxlength="60" placeholder="z. B. HS7"></label>
        <label class="field"><span>Dozent/in</span><input data-f="lecturer" value="${esc(v.lecturer || '')}" maxlength="60" placeholder="optional"></label></div>
        <label class="field"><span>Gruppe / Hinweis</span><input data-f="group_label" value="${esc(v.group_label || '')}" maxlength="30" placeholder="z. B. Gr. B"></label>
        <div class="list">
          <label class="row"><span class="main"><span class="t" style="display:block">Immer Pflicht</span><span class="s" style="display:block">Jeder Termin dieser Reihe mit Erinnerung</span></span>${sw('mandatory', v.mandatory)}</label>
          <label class="row" data-weekly2><span class="main"><span class="t" style="display:block">Auch in Projekt- & freien Wochen</span><span class="s" style="display:block">Sonst nur in Vorlesungswochen</span></span>${sw('every_week', v.every_week)}</label>
        </div>
        <div data-err></div>
        <button class="btn primary" data-save>${existing ? 'Speichern' : 'Termin anlegen'}</button>
        ${existing ? `<div class="list" style="margin-top:12px"><button class="row danger" data-del><span class="main"><span class="t">Terminreihe löschen</span></span></button></div>` : ''}
      </div>`;
      const showMode = () => {
        b.querySelector('[data-weekly]').hidden = mode !== 'weekly';
        b.querySelector('[data-weekly2]').hidden = mode !== 'weekly';
        b.querySelector('[data-once]').hidden = mode !== 'once';
      };
      showMode();
      const custom = new Set(v.custom_weeks || []);
      const drawWeeks = () => {
        const rule = segValue(b, 'weeks_rule');
        const box = b.querySelector('[data-customweeks]');
        box.hidden = rule !== 'custom';
        b.querySelector('[data-wrhint]').textContent = rule === 'custom' ? 'Tippe die Wochen an, in denen der Termin stattfindet.'
          : rule === 'all' ? 'In jeder Vorlesungswoche' : `Nur in der ${labels[rule === 'A' ? 0 : 1]} – wie im Semesterplan`;
        if (rule !== 'custom') return;
        const all = b.querySelector('[data-sw="every_week"]').checked;
        box.innerHTML = lectureWeeks(sem, all).map((w) => `<button type="button" class="pill-toggle" data-wk="${w.w}" aria-pressed="${custom.has(w.w)}" style="padding:0 12px">KW ${S.isoWeek(w.w)}<span class="muted" style="font-weight:500;margin-left:6px">${fmtDate(w.w, { weekday: false })}</span></button>`).join('');
        box.querySelectorAll('[data-wk]').forEach((x) => x.addEventListener('click', () => {
          if (custom.has(x.dataset.wk)) custom.delete(x.dataset.wk); else custom.add(x.dataset.wk);
          x.setAttribute('aria-pressed', String(custom.has(x.dataset.wk)));
        }));
      };
      drawWeeks();
      b.querySelector('[data-sw="every_week"]').addEventListener('change', drawWeeks);
      bindSegs(b, (name, val) => { if (name === 'mode') { mode = val; showMode(); } if (name === 'weeks_rule') drawWeeks(); });
      b.querySelector('[data-f="subject_id"]').addEventListener('change', (e) => {
        if (e.target.value === '__new') { e.target.value = v.subject_id; openSubject(null, sem.id, (sub) => { api.close(); openSeries(existing ? { ...existing, subject_id: sub.id } : null, { subject_id: sub.id }); }); }
      });
      b.querySelector('[data-f="starts_at"]').addEventListener('change', (e) => {
        const en = b.querySelector('[data-f="ends_at"]');
        if (e.target.value && (!en.value || S.toMin(en.value) <= S.toMin(e.target.value))) en.value = S.minToHHMM(Math.min(23 * 60 + 59, S.toMin(e.target.value) + 90));
      });
      b.querySelector('[data-save]').addEventListener('click', async () => {
        const f = (n) => b.querySelector(`[data-f="${n}"]`)?.value ?? '';
        const row = {
          ...(existing || {}), id: existing?.id || uuid(),
          subject_id: f('subject_id'), kind: segValue(b, 'kind'),
          starts_at: f('starts_at'), ends_at: f('ends_at'),
          room: f('room').trim() || null, lecturer: f('lecturer').trim() || null, group_label: f('group_label').trim() || null,
          mandatory: b.querySelector('[data-sw="mandatory"]').checked,
        };
        if (mode === 'weekly') {
          Object.assign(row, {
            once_on: null, weekday: Number(segValue(b, 'weekday')), weeks_rule: segValue(b, 'weeks_rule'), custom_weeks: segValue(b, 'weeks_rule') === 'custom' ? [...custom].sort() : [],
            valid_from: f('valid_from') || null, valid_until: f('valid_until') || null, every_week: b.querySelector('[data-sw="every_week"]').checked,
          });
        } else Object.assign(row, { once_on: f('once_on') || null, weekday: null, valid_from: null, valid_until: null, every_week: false });
        const err = (m) => { b.querySelector('[data-err]').innerHTML = `<div class="err">${esc(m)}</div>`; };
        if (!row.starts_at || !row.ends_at) return err('Bitte Beginn und Ende angeben.');
        if (S.toMin(row.ends_at) <= S.toMin(row.starts_at)) return err('Das Ende muss nach dem Beginn liegen.');
        if (mode === 'once' && !S.isValidDate(row.once_on || '')) return err('Bitte ein Datum wählen.');
        if (row.valid_from && row.valid_until && row.valid_until < row.valid_from) return err('„Bis“ liegt vor „Ab“.');
        if (mode === 'weekly' && row.weeks_rule === 'custom' && !row.custom_weeks.length) return err('Bitte mindestens eine Woche auswählen.');

        // Bei Änderung von Tag/Zeit/Wochen einer Reihe mit Einträgen: ab wann soll es gelten?
        if (existing && mode === 'weekly' && !existing.once_on) {
          const changed = row.weekday !== existing.weekday || row.starts_at !== S.hhmm(existing.starts_at) || row.weeks_rule !== existing.weeks_rule || JSON.stringify(row.custom_weeks) !== JSON.stringify(existing.custom_weeks || []);
          const t = today();
          const hasPast = store.data.occurrences.some((o) => o.series_id === existing.id && o.on_date < t);
          const startedBefore = (existing.valid_from || sem.starts_on) < t;
          if (changed && hasPast && startedBefore) {
            const choice = await chooseSplit();
            if (choice === null) return;
            if (choice === 'split') {
              const startFrom = t;
              put('series', { ...existing, valid_until: S.addDays(startFrom, -1) });
              put('series', { ...row, id: uuid(), valid_from: row.valid_from && row.valid_from > startFrom ? row.valid_from : startFrom });
              toast(`Gilt ab ${fmtDate(startFrom)} – Einträge davor bleiben erhalten.`);
              api.close();
              return;
            }
          }
        }
        put('series', row);
        toast(existing ? 'Gespeichert' : 'Termin angelegt');
        api.close();
      });
      b.querySelector('[data-del]')?.addEventListener('click', async () => {
        const n = store.data.occurrences.filter((o) => o.series_id === existing.id && (o.progress > 0 || o.stars || o.note)).length;
        const ok = await confirmDialog({
          title: 'Terminreihe löschen?',
          text: `Alle Termine dieser Reihe verschwinden aus dem Stundenplan${n ? `, auch ${n} ${n === 1 ? 'Eintrag' : 'Einträge'} mit Fortschritt, Sternen oder Notizen` : ''}. Tipp: Wenn sie nur ab einem Datum wegfällt, setze stattdessen „Bis“.`,
          confirm: 'Löschen', danger: true,
        });
        if (!ok) return;
        remove('series', existing);
        toast('Terminreihe gelöscht');
        api.close();
      });
    },
  });
}

function chooseSplit() {
  return new Promise((resolve) => {
    let r = null;
    sheet({
      title: 'Ab wann gilt die Änderung?',
      onClose: () => resolve(r),
      render(b, api) {
        b.innerHTML = `<div class="form">
          <p class="sub" style="margin:0">Zu dieser Reihe gibt es schon Einträge (Fortschritt, Sterne, Notizen).</p>
          <button class="choice" data-c="split"><span class="ibox">${icon('right')}</span><span><span class="t" style="display:block">Ab jetzt</span><span class="s">Vergangene Termine bleiben wie sie waren (empfohlen).</span></span></button>
          <button class="choice" data-c="all"><span class="ibox amber">${icon('repeat')}</span><span><span class="t" style="display:block">Für alle Termine</span><span class="s">Einträge an alten Tagen werden nicht mehr angezeigt.</span></span></button>
        </div>`;
        b.querySelectorAll('[data-c]').forEach((x) => x.addEventListener('click', () => { r = x.dataset.c; api.close(); }));
      },
    });
  });
}

// ======================= FACH =======================
export function openSubject(existing, semId, onSaved) {
  const sem = store.data.semesters.find((s) => s.id === (existing?.semester_id || semId)) || currentSemester();
  if (!sem) { toast('Lege zuerst ein Semester an.'); return; }
  const used = new Set(subjectsOf(sem.id).map((s) => s.color));
  let color = existing?.color || COLORS.find((c) => !used.has(c)) || 'blue';
  sheet({
    title: existing ? 'Fach bearbeiten' : 'Neues Fach', primary: existing ? 'Sichern' : 'Hinzufügen',
    render(b, api) {
      b.innerHTML = `<div class="form">
        <label class="field"><span>Name</span><input data-name value="${esc(existing?.name || '')}" maxlength="80" placeholder="z. B. Mathe 1" autocomplete="off"></label>
        <label class="field"><span>Kürzel (optional)</span><input data-code value="${esc(existing?.code || '')}" maxlength="12" placeholder="z. B. A1" autocomplete="off" autocapitalize="characters"></label>
        <div class="field"><span>Farbe</span><div class="swatches">${COLORS.map((c) => `<button data-c="${c}" data-color="${c}" aria-label="${COLOR_NAMES[c]}" aria-pressed="${c === color}"></button>`).join('')}</div></div>
        <div data-err></div>
        <button class="btn primary" data-save>${existing ? 'Speichern' : 'Fach anlegen'}</button>
        ${existing ? `<div class="list" style="margin-top:12px"><button class="row danger" data-del><span class="main"><span class="t">Fach löschen</span></span></button></div>` : ''}
      </div>`;
      b.querySelectorAll('[data-color]').forEach((x) => x.addEventListener('click', () => {
        color = x.dataset.color;
        b.querySelectorAll('[data-color]').forEach((y) => y.setAttribute('aria-pressed', String(y === x)));
      }));
      if (!existing) setTimeout(() => b.querySelector('[data-name]').focus(), 350);
      b.querySelector('[data-save]').addEventListener('click', () => {
        const name = b.querySelector('[data-name]').value.trim();
        if (!name) { b.querySelector('[data-err]').innerHTML = '<div class="err">Bitte einen Namen eingeben.</div>'; return; }
        const row = put('subjects', { ...(existing || {}), id: existing?.id || uuid(), semester_id: sem.id, name, code: b.querySelector('[data-code]').value.trim() || null, color, sort: existing?.sort ?? subjectsOf(sem.id).length });
        api.close();
        toast(existing ? 'Gespeichert' : 'Fach angelegt');
        onSaved?.(row);
      });
      b.querySelector('[data-del]')?.addEventListener('click', async () => {
        const n = store.data.series.filter((s) => s.subject_id === existing.id).length;
        const ok = await confirmDialog({ title: `„${existing.name}“ löschen?`, text: `Das Fach mit ${n} ${n === 1 ? 'Terminreihe' : 'Terminreihen'} und allen Einträgen wird gelöscht. Verknüpfte Prüfungen bleiben ohne Fach erhalten.`, confirm: 'Fach löschen', danger: true, typeWord: n ? 'LÖSCHEN' : null });
        if (!ok) return;
        remove('subjects', existing);
        api.close();
        nav.popPage?.('subject');
        toast('Fach gelöscht');
      });
    },
  });
}

// ======================= PRÜFUNG / FRIST =======================
export function openExam(existing, preset = {}) {
  const sem = currentSemester();
  const subs = sem ? subjectsOf(sem.id) : [];
  const v = existing ? { ...existing } : { kind: 'exam', title: '', subject_id: preset.subject_id || null, on_date: '', until_date: null, starts_at: null, ends_at: null, room: '', note: '', remind: true };
  sheet({
    title: existing ? 'Bearbeiten' : 'Prüfung oder Frist', primary: existing ? 'Sichern' : 'Hinzufügen',
    render(b, api) {
      b.innerHTML = `<div class="form">
        <label class="field"><span>Art</span><select data-f="kind">${Object.entries(S.EXAM_KINDS).map(([k, x]) => `<option value="${k}" ${k === v.kind ? 'selected' : ''}>${x.label}</option>`).join('')}</select></label>
        <label class="field"><span>Fach</span><select data-f="subject_id"><option value="">Kein Fach</option>${subs.map((s) => `<option value="${s.id}" ${s.id === v.subject_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Titel</span><input data-f="title" value="${esc(v.title)}" maxlength="100" placeholder="z. B. Klausur Mathe 1" autocomplete="off"></label>
        <div class="grid2"><label class="field"><span data-l-date>Datum</span><input type="date" data-f="on_date" value="${v.on_date || ''}"></label>
        <label class="field" data-until><span>Bis</span><input type="date" data-f="until_date" value="${v.until_date || ''}"></label></div>
        <div class="grid2" data-times><label class="field"><span>Beginn</span><input type="time" data-f="starts_at" value="${S.hhmm(v.starts_at)}"></label><label class="field"><span>Ende</span><input type="time" data-f="ends_at" value="${S.hhmm(v.ends_at)}"></label></div>
        <label class="field"><span>Raum</span><input data-f="room" value="${esc(v.room || '')}" maxlength="60" placeholder="optional"></label>
        <label class="field"><span>Notiz</span><textarea data-f="note" maxlength="1000" placeholder="z. B. Hilfsmittel: Taschenrechner, Formelsammlung">${esc(v.note || '')}</textarea></label>
        <div class="list"><label class="row"><span class="ibox red">${icon('bell')}</span><span class="main"><span class="t" style="display:block">Erinnern</span><span class="s" style="display:block" data-remindhint></span></span>${sw('remind', v.remind)}</label></div>
        <div data-err></div>
        <button class="btn primary" data-save>${existing ? 'Speichern' : 'Hinzufügen'}</button>
        ${existing ? `<div class="list" style="margin-top:12px"><button class="row" data-ics><span class="main"><span class="t" style="color:var(--accent)">Zum Kalender hinzufügen</span></span></button></div>
        <div class="list" style="margin-top:12px"><button class="row danger" data-del><span class="main"><span class="t">Löschen</span></span></button></div>` : ''}
      </div>`;
      const f = (n) => b.querySelector(`[data-f="${n}"]`);
      const upd = () => {
        const k = f('kind').value;
        const range = k === 'registration' || k === 'period';
        b.querySelector('[data-until]').hidden = !range;
        b.querySelector('[data-l-date]').textContent = range ? 'Von' : 'Datum';
        b.querySelector('[data-times]').hidden = k === 'period' || k === 'registration';
        b.querySelector('[data-remindhint]').textContent = k === 'registration' || k === 'submission' ? 'Am Vortag und am letzten Tag der Frist' : k === 'period' ? 'Zeiträume erinnern nicht' : [store.settings.examWeek ? '1 Woche' : '', ...store.settings.offsets.map(S.offsetLabel)].filter(Boolean).join(', ') + ' vorher';
      };
      upd();
      f('kind').addEventListener('change', upd);
      f('subject_id').addEventListener('change', () => {
        const s = subs.find((x) => x.id === f('subject_id').value);
        if (s && !f('title').value.trim()) f('title').value = s.name;
      });
      b.querySelector('[data-save]').addEventListener('click', () => {
        const k = f('kind').value;
        const range = k === 'registration' || k === 'period';
        const row = {
          ...(existing || {}), id: existing?.id || uuid(), semester_id: existing?.semester_id || sem?.id || null,
          kind: k, subject_id: f('subject_id').value || null, title: f('title').value.trim(),
          on_date: f('on_date').value, until_date: range ? f('until_date').value || null : null,
          starts_at: range ? null : f('starts_at').value || null, ends_at: range ? null : f('ends_at').value || null,
          room: f('room').value.trim() || null, note: f('note').value.trim() || null, remind: b.querySelector('[data-sw="remind"]').checked,
        };
        const sub = subs.find((x) => x.id === row.subject_id);
        if (!row.title) row.title = sub?.name || S.EXAM_KINDS[k].label;
        const err = (m) => { b.querySelector('[data-err]').innerHTML = `<div class="err">${esc(m)}</div>`; };
        if (!S.isValidDate(row.on_date)) return err('Bitte ein Datum wählen.');
        if (row.until_date && row.until_date < row.on_date) return err('„Bis“ liegt vor dem Startdatum.');
        if (row.starts_at && row.ends_at && S.toMin(row.ends_at) <= S.toMin(row.starts_at)) return err('Das Ende muss nach dem Beginn liegen.');
        put('exams', row);
        toast(existing ? 'Gespeichert' : 'Hinzugefügt');
        api.close();
      });
      b.querySelector('[data-ics]')?.addEventListener('click', () => {
        const e = store.data.exams.find((x) => x.id === existing.id) || existing;
        const sub = subs.find((x) => x.id === e.subject_id);
        shareIcs(`${e.title.replace(/[^\wäöüÄÖÜß -]/g, '')}.ics`, buildIcs([{
          uid: e.id, title: `${S.EXAM_KINDS[e.kind]?.label || 'Termin'}: ${e.title}`, date: e.on_date, endDate: e.until_date || null,
          start: e.until_date ? null : S.hhmm(e.starts_at) || null, end: S.hhmm(e.ends_at) || (e.starts_at ? S.minToHHMM(S.toMin(e.starts_at) + 90) : null),
          location: e.room, notes: [sub?.name, e.note].filter(Boolean).join('\n'), alarmMin: e.starts_at ? 1440 : null,
        }], e.title));
      });
      b.querySelector('[data-del]')?.addEventListener('click', async () => {
        if (!(await confirmDialog({ title: `„${existing.title}“ löschen?`, confirm: 'Löschen', danger: true }))) return;
        remove('exams', existing);
        toast('Gelöscht');
        api.close();
      });
    },
  });
}

// ======================= STUNDENPLAN BEARBEITEN (Seite) =======================
export function renderTTEditor(el) {
  const sem = currentSemester();
  if (!sem) { el.innerHTML = `${navBar({ left: backBtn() })}<div class="wrap"><div class="empty"><h3>Noch kein Semester</h3><p>Lege zuerst ein Semester an.</p><button class="btn small primary" data-act="newSemester">Semester anlegen</button></div></div>`; return; }
  const subs = subjectsOf(sem.id);
  const order = (s) => (s.once_on ? 10 : s.weekday) * 10000 + S.toMin(s.starts_at);
  el.innerHTML = `
    ${navBar({ title: 'Stundenplan', left: backBtn(), right: '<button class="nav-btn" data-act="newSubject">Fach +</button>' })}
    ${largeTitle('Stundenplan', esc(sem.name))}
    <div class="wrap">
    <p class="gf" style="margin-top:0">Trag jeden wiederkehrenden Termin einmal ein – alle Wochen ergeben sich daraus. Tippe einen Termin an, um ihn zu ändern.</p>
    ${subs.map((s) => {
      const list = store.data.series.filter((x) => x.subject_id === s.id).sort((a, b) => order(a) - order(b));
      return `<div class="gh"><span style="display:flex;align-items:center;gap:8px"><span class="dot" data-c="${s.color}"></span>${esc(s.name)}</span><button class="link" data-act="editSubject" data-id="${s.id}">Fach bearbeiten</button></div>
      <div class="list">${list.map((x) => `<button class="row" data-act="editSeries" data-id="${x.id}">
        <span class="main"><span class="t" style="display:block">${x.once_on ? fmtDate(x.once_on) : WD_LONG[x.weekday - 1]} · ${S.hhmm(x.starts_at)}–${S.hhmm(x.ends_at)}</span>
        <span class="s" style="display:block">${[S.KINDS[x.kind]?.label, x.room, x.group_label, x.weeks_rule === 'A' || x.weeks_rule === 'B' ? S.parityLabel(sem, x.weeks_rule) : x.weeks_rule === 'custom' ? `${(x.custom_weeks || []).length} ausgewählte Wochen` : '', x.valid_from ? 'ab ' + fmtDate(x.valid_from, { weekday: false }) : '', x.valid_until ? 'bis ' + fmtDate(x.valid_until, { weekday: false }) : '', x.mandatory ? 'Pflicht' : ''].filter(Boolean).map(esc).join(' · ')}</span></span>
        ${icon('right', 'sm chev')}</button>`).join('')}
        <button class="row" data-act="newSeries" data-subject="${s.id}"><span class="main"><span class="t" style="color:var(--accent)">Termin hinzufügen</span></span></button>
      </div>`;
    }).join('')}
    <div class="list" style="margin-top:22px"><button class="row" data-act="newSubject"><span class="main"><span class="t" style="color:var(--accent)">Neues Fach hinzufügen</span></span></button></div>
  </div>`;
}

// ======================= SEMESTER =======================
const WEEK_OPTS = (hasParity, labels) => [
  ...(hasParity ? [['lecture|A', 'Vorlesung · ' + labels[0].replace(' Woche', '').replace('Woche ', '')], ['lecture|B', 'Vorlesung · ' + labels[1].replace(' Woche', '').replace('Woche ', '')]] : []),
  ['lecture|', 'Vorlesungswoche'], ['project|', 'Projektwoche'], ['free|', 'Vorlesungsfrei'], ['exams|', 'Prüfungszeit'],
];

export function renderSemesterEditor(el, semId) {
  const sem = store.data.semesters.find((s) => s.id === semId) || currentSemester();
  if (!sem) { el.innerHTML = navBar({ left: backBtn() }); return; }
  const labels = Array.isArray(sem.parity_labels) ? sem.parity_labels : ['Woche A', 'Woche B'];
  const hasParity = (sem.weeks || []).some((w) => w.p);
  const weeks = [];
  for (let m = S.mondayOf(sem.starts_on); m <= sem.ends_on; m = S.addDays(m, 7)) {
    const w = (sem.weeks || []).find((x) => x.w === m) || { w: m, k: 'lecture', p: null };
    weeks.push(w);
  }
  el.innerHTML = `
    ${navBar({ title: sem.name, left: backBtn() })}
    ${largeTitle(sem.name, 'Semester')}
    <div class="wrap">
    <div class="form" style="margin-top:8px">
      <label class="field"><span>Name</span><input data-sf="name" value="${esc(sem.name)}" maxlength="80"></label>
      <div class="grid2"><label class="field"><span>Beginn</span><input type="date" data-sf="starts_on" value="${sem.starts_on}"></label><label class="field"><span>Ende</span><input type="date" data-sf="ends_on" value="${sem.ends_on}"></label></div>
      <p class="gf" style="margin:-8px 0 0">Das Ende sollte nach dem letzten Prüfungszeitraum liegen.</p>
    </div>
    <div class="gh">Freie Tage & Ferien<button class="link" data-act="addHoliday" data-id="${sem.id}">Hinzufügen</button></div>
    <div class="list">${(sem.holidays || []).length ? sem.holidays.map((h, i) => `<div class="row"><span class="main"><span class="t" style="display:block">${esc(h.name || 'Frei')}</span><span class="s" style="display:block">${fmtRange(h.from, h.to || h.from)}</span></span><button class="icon-btn plain" data-act="delHoliday" data-id="${sem.id}" data-i="${i}" aria-label="Entfernen">${icon('trash', 'sm')}</button></div>`).join('') : '<div class="row"><span class="s">Keine freien Tage eingetragen.</span></div>'}</div>
    <div class="gh">Wochen</div>
    <p class="gf" style="margin:-2px 0 8px">Regelmäßige Termine finden nur in Vorlesungswochen statt.${hasParity ? ` ${esc(labels[0])} und ${esc(labels[1])} wechseln sich ab.` : ''}</p>
    <div class="list">${weeks.map((w) => `<div class="weekrow"><div><div class="t">KW ${S.isoWeek(w.w)}</div><div class="s">${fmtRange(w.w, S.addDays(w.w, 6))}</div></div>
      <select data-week="${w.w}" aria-label="Art der Woche KW ${S.isoWeek(w.w)}">${WEEK_OPTS(true, labels).map(([val, l]) => `<option value="${val}" ${val === w.k + '|' + (w.p || '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`).join('')}</div>
    <div class="list" style="margin-top:28px"><button class="row danger" data-act="delSemester" data-id="${sem.id}"><span class="main"><span class="t">Semester löschen</span></span></button></div>
  </div>`;
  const save = (patch) => put('semesters', { ...store.data.semesters.find((s) => s.id === sem.id), ...patch });
  el.querySelectorAll('[data-sf]').forEach((inp) => inp.addEventListener('change', () => {
    const k = inp.dataset.sf, val = inp.value.trim();
    if (k === 'name') { if (val) save({ name: val }); return; }
    const cur = store.data.semesters.find((s) => s.id === sem.id);
    const next = { ...cur, [k]: val };
    if (!S.isValidDate(val) || next.ends_on < next.starts_on) { toast('Das Ende muss nach dem Beginn liegen.', { error: true }); inp.value = cur[k]; return; }
    save({ [k]: val });
  }));
  el.querySelectorAll('[data-week]').forEach((sel) => sel.addEventListener('change', () => {
    const [k, p] = sel.value.split('|');
    const cur = store.data.semesters.find((s) => s.id === sem.id);
    const list = (cur.weeks || []).filter((x) => x.w !== sel.dataset.week);
    list.push({ w: sel.dataset.week, k, p: p || null });
    list.sort((a, b) => (a.w < b.w ? -1 : 1));
    save({ weeks: list });
  }));
}

export function addHoliday(semId) {
  const sem = store.data.semesters.find((s) => s.id === semId);
  sheet({
    title: 'Freier Tag', primary: 'Hinzufügen',
    render(b, api) {
      b.innerHTML = `<div class="form">
        <label class="field"><span>Name</span><input data-n maxlength="60" placeholder="z. B. Feiertag, Exkursion"></label>
        <div class="grid2"><label class="field"><span>Von</span><input type="date" data-a min="${sem.starts_on}" max="${sem.ends_on}"></label><label class="field"><span>Bis (optional)</span><input type="date" data-b min="${sem.starts_on}" max="${sem.ends_on}"></label></div>
        <div data-err></div><button class="btn primary" data-save>Hinzufügen</button></div>`;
      b.querySelector('[data-save]').addEventListener('click', () => {
        const a = b.querySelector('[data-a]').value, z = b.querySelector('[data-b]').value || a;
        if (!S.isValidDate(a) || z < a) { b.querySelector('[data-err]').innerHTML = '<div class="err">Bitte ein gültiges Datum wählen.</div>'; return; }
        const cur = store.data.semesters.find((s) => s.id === semId);
        put('semesters', { ...cur, holidays: [...(cur.holidays || []), { from: a, to: z, name: b.querySelector('[data-n]').value.trim() || 'Frei' }].sort((x, y) => (x.from < y.from ? -1 : 1)) });
        api.close();
      });
    },
  });
}

export async function delHoliday(semId, i) {
  const cur = store.data.semesters.find((s) => s.id === semId);
  const h = cur.holidays[i];
  if (!(await confirmDialog({ title: `„${h.name}“ entfernen?`, text: 'Termine finden an diesen Tagen dann wieder statt.', confirm: 'Entfernen', danger: true }))) return;
  put('semesters', { ...cur, holidays: cur.holidays.filter((_, k) => k !== i) });
}

export async function delSemester(semId) {
  const sem = store.data.semesters.find((s) => s.id === semId);
  if (!sem) return;
  const ok = await confirmDialog({ title: `${sem.name} löschen?`, text: 'Alle Fächer, Termine, Einträge und Prüfungen dieses Semesters werden endgültig gelöscht.', confirm: 'Endgültig löschen', danger: true, typeWord: 'LÖSCHEN' });
  if (!ok) return;
  remove('semesters', sem);
  ui.semId = null;
  nav.popPage();
  toast('Semester gelöscht');
}

/** Neues Semester: Vorlage oder eigenes. */
export function newSemester({ onDone } = {}) {
  sheet({
    title: 'Neues Semester', primary: 'Anlegen',
    render(b, api) {
      const t = today();
      const presets = SEMESTER_PRESETS.filter((p) => p.semester.ends_on >= t && !store.data.semesters.some((s) => s.name === p.semester.name));
      b.innerHTML = `<div class="form">
        ${presets.map((p) => `<button class="choice" data-preset="${p.id}"><span class="ibox">${icon('cap')}</span><span><span class="t" style="display:block">${esc(p.school)}</span><span class="s">${esc(p.label)} – mit Wochenplan & Fristen</span></span></button>`).join('')}
        <div class="section-h" style="margin:var(--s2) 4px 0"><h2>Eigenes Semester</h2></div>
        <label class="field"><span>Name</span><input data-n maxlength="80" placeholder="z. B. SoSe 2027"></label>
        <div class="grid2"><label class="field"><span>Beginn</span><input type="date" data-a></label><label class="field"><span>Ende</span><input type="date" data-b></label></div>
        <div data-err></div>
        <button class="btn primary" data-save>Semester anlegen</button></div>`;
      b.querySelectorAll('[data-preset]').forEach((x) => x.addEventListener('click', () => {
        const p = SEMESTER_PRESETS.find((y) => y.id === x.dataset.preset);
        api.close();
        applyPreset(p, null);
        onDone?.();
      }));
      b.querySelector('[data-save]').addEventListener('click', () => {
        const name = b.querySelector('[data-n]').value.trim(), a = b.querySelector('[data-a]').value, z = b.querySelector('[data-b]').value;
        const err = (m) => { b.querySelector('[data-err]').innerHTML = `<div class="err">${esc(m)}</div>`; };
        if (!name) return err('Bitte einen Namen eingeben.');
        if (!S.isValidDate(a) || !S.isValidDate(z) || z <= a) return err('Bitte Beginn und Ende angeben (Ende nach Beginn).');
        const row = put('semesters', { id: uuid(), name, starts_on: a, ends_on: z, weeks: [], holidays: [], parity_labels: ['Woche A', 'Woche B'] });
        ui.semId = null;
        api.close();
        toast('Semester angelegt');
        onDone?.(row);
      });
    },
  });
}

export function applyPreset(preset, timetableId) {
  const built = buildFromPreset(preset, timetableId);
  putMany([
    ['semesters', built.semester],
    ...built.subjects.map((s) => ['subjects', s]),
    ...built.series.map((s) => ['series', s]),
    ...built.exams.map((e) => ['exams', e]),
  ]);
  ui.semId = null;
  return built;
}
