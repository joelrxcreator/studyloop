// Kleiner Nachbau der Supabase-Schnittstellen (Auth, PostgREST, RPC, Functions) für Browser-Tests.
// Wird per Playwright page.route() vor die echte Projekt-URL gehängt – die App merkt keinen Unterschied.

const PK = {
  semesters: ['id'], subjects: ['id'], series: ['id'], occurrences: ['series_id', 'on_date'], exams: ['id'],
  settings: ['user_id'], activity: ['user_id', 'day'], push_subscriptions: ['endpoint'], push_log: ['id'], notifications: ['id'],
};

export function createMock() {
  const db = Object.fromEntries(Object.keys(PK).map((t) => [t, []]));
  const users = new Map(); // email → { id, password }
  const state = { offline: false, requests: [], failNext: 0, pushLog: [] };
  let n = 0;

  const user = (u) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-10-01T00:00:00Z' });
  const session = (u) => ({ access_token: 'tok-' + u.id, token_type: 'bearer', expires_in: 3600 * 24 * 365, expires_at: 1924992000, refresh_token: 'ref-' + u.id, user: user(u) });
  const uidFrom = (req) => {
    const a = req.headers()['authorization'] || '';
    const m = /tok-(.+)$/.exec(a);
    return m ? m[1] : null;
  };
  const json = (route, status, body, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', ...headers }, body: body === undefined ? '' : JSON.stringify(body) });

  function filterRows(rows, params) {
    let out = rows;
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
      const [op, ...rest] = v.split('.');
      const val = rest.join('.');
      if (op === 'eq') out = out.filter((r) => String(r[k]) === val);
      else if (op === 'gte') out = out.filter((r) => String(r[k]) >= val);
      else if (op === 'lte') out = out.filter((r) => String(r[k]) <= val);
      else if (op === 'lt') out = out.filter((r) => String(r[k]) < val);
      else if (op === 'in') { const set = new Set(val.replace(/^\(|\)$/g, '').split(',')); out = out.filter((r) => set.has(String(r[k]))); }
    }
    return out;
  }

  function cascade(table, row) {
    if (table === 'semesters') { for (const s of db.subjects.filter((x) => x.semester_id === row.id)) del('subjects', s); db.exams = db.exams.filter((e) => e.semester_id !== row.id); }
    if (table === 'subjects') { for (const s of db.series.filter((x) => x.subject_id === row.id)) del('series', s); db.exams.forEach((e) => { if (e.subject_id === row.id) e.subject_id = null; }); }
    if (table === 'series') db.occurrences = db.occurrences.filter((o) => o.series_id !== row.id);
  }
  function del(table, row) {
    const k = PK[table].map((c) => row[c]).join('|');
    db[table] = db[table].filter((r) => PK[table].map((c) => r[c]).join('|') !== k);
    notify('DELETE', table, null, Object.fromEntries(PK[table].map((c) => [c, row[c]])));
    cascade(table, row);
  }

  // ---------- Realtime (Phoenix-Protokoll vsn 2, nur postgres_changes) ----------
  const sockets = new Set();
  function notify(type, table, record, old) {
    for (const s of sockets) {
      for (const [topic, binds] of s.channels) {
        const ids = binds.filter((b) => b.table === table && b.event === type && (!b.filter || (record && b.filter === 'user_id=eq.' + record.user_id))).map((b) => b.id);
        if (!ids.length) continue;
        s.ws.send(JSON.stringify([null, null, topic, 'postgres_changes', { ids, data: { type, schema: 'public', table, commit_timestamp: new Date().toISOString(), record: record || {}, old_record: old || {}, columns: [], errors: null } }]));
      }
    }
  }
  function ws(socket) {
    const s = { ws: socket, channels: new Map() };
    sockets.add(s);
    socket.onClose(() => sockets.delete(s));
    socket.onMessage((msg) => {
      const [joinRef, ref, topic, event, payload] = JSON.parse(String(msg));
      if (state.offline) return;
      const reply = (response) => socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response }]));
      if (event === 'phx_join') {
        const binds = (payload.config?.postgres_changes || []).map((b, i) => ({ ...b, id: 1000 + i }));
        s.channels.set(topic, binds);
        reply({ postgres_changes: binds });
      } else if (event === 'phx_leave') { s.channels.delete(topic); reply({}); }
      else reply({});
    });
  }

  async function handle(route) {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    state.requests.push(`${method} ${path}${url.search}`);
    if (method === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (state.offline) return route.abort('internetdisconnected');
    if (state.failNext > 0 && path.startsWith('/rest/')) { state.failNext--; return json(route, 503, { message: 'Service Unavailable' }); }
    const body = req.postData() ? JSON.parse(req.postData()) : null;

    // ---------- Auth ----------
    if (path === '/auth/v1/signup') {
      if (users.has(body.email)) return json(route, 422, { code: 'user_already_exists', msg: 'User already registered' });
      const u = { id: crypto.randomUUID(), email: body.email, password: body.password };
      users.set(body.email, u);
      return json(route, 200, session(u));
    }
    if (path === '/auth/v1/token') {
      const u = users.get(body?.email);
      if (url.searchParams.get('grant_type') === 'refresh_token') {
        const id = String(body.refresh_token).replace('ref-', '');
        const uu = [...users.values()].find((x) => x.id === id);
        return uu ? json(route, 200, session(uu)) : json(route, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
      }
      if (!u || u.password !== body.password) return json(route, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials', msg: 'Invalid login credentials' });
      return json(route, 200, session(u));
    }
    if (path === '/auth/v1/user') {
      const id = uidFrom(req);
      const u = [...users.values()].find((x) => x.id === id);
      if (!u) return json(route, 401, { msg: 'invalid JWT' });
      if (method === 'PUT') { if (body.password) u.password = body.password; }
      return json(route, 200, user(u));
    }
    if (path === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    if (path === '/auth/v1/recover') return json(route, 200, {});

    // ---------- Functions ----------
    if (path === '/functions/v1/reminders') {
      const uid = uidFrom(req);
      if (body?.action === 'test') {
        const subs = db.push_subscriptions.filter((s) => s.user_id === uid);
        state.pushLog.push({ uid, action: 'test' });
        if (subs.length) addNotification(uid, { key: 'test|' + Date.now(), title: 'Studyloop', body: 'Test-Mitteilung – so kommen deine Erinnerungen an.', url: './' });
        return json(route, 200, { delivered: subs.length, devices: subs.length, error: subs.length ? null : 'kein Gerät' });
      }
      if (body?.action === 'delete_account') {
        for (const t of Object.keys(db)) db[t] = db[t].filter((r) => r.user_id !== uid);
        for (const [e, u] of users) if (u.id === uid) users.delete(e);
        return json(route, 200, { deleted: true });
      }
      return json(route, 400, { error: 'Unbekannte Aktion' });
    }

    // ---------- RPC ----------
    if (path === '/rest/v1/rpc/register_push') {
      const uid = uidFrom(req);
      db.push_subscriptions = db.push_subscriptions.filter((s) => s.endpoint !== body.p_endpoint);
      db.push_subscriptions.push({ id: crypto.randomUUID(), user_id: uid, endpoint: body.p_endpoint, p256dh: body.p_p256dh, auth: body.p_auth });
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    }

    // ---------- PostgREST ----------
    const m = /^\/rest\/v1\/(\w+)$/.exec(path);
    if (m) {
      const table = m[1];
      const uid = uidFrom(req);
      if (!uid) return json(route, 401, { message: 'JWT required' });
      if (!db[table]) return json(route, 404, { message: 'relation does not exist' });
      const own = () => db[table].filter((r) => r.user_id === uid);
      if (method === 'GET') {
        let rows = filterRows(own(), url.searchParams);
        const order = url.searchParams.get('order');
        if (order) { const [col, dir] = order.split('.'); rows = [...rows].sort((a, b) => (String(a[col] ?? '') < String(b[col] ?? '') ? -1 : 1) * (dir === 'desc' ? -1 : 1)); }
        const off = Number(url.searchParams.get('offset') || 0), lim = url.searchParams.get('limit');
        const range = req.headers()['range'];
        if (range) { const [a, b] = range.split('-').map(Number); rows = rows.slice(a, b + 1); } else rows = rows.slice(off, lim ? off + Number(lim) : undefined);
        const accept = req.headers()['accept'] || '';
        if (accept.includes('vnd.pgrst.object')) {
          if (rows.length === 1) return json(route, 200, rows[0]);
          return json(route, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows` });
        }
        return json(route, 200, rows);
      }
      if (method === 'POST') {
        const list = Array.isArray(body) ? body : [body];
        const prefer = req.headers()['prefer'] || '';
        for (const r of list) {
          if (r.user_id && r.user_id !== uid) return json(route, 403, { code: '42501', message: 'new row violates row-level security policy' });
          const row = { ...r, user_id: uid, updated_at: new Date().toISOString(), created_at: r.created_at || new Date(Date.now() + (n++)).toISOString() };
          const k = PK[table].map((c) => row[c]).join('|');
          const i = db[table].findIndex((x) => PK[table].map((c) => x[c]).join('|') === k);
          if (i >= 0) {
            if (prefer.includes('ignore-duplicates')) continue;
            if (!prefer.includes('merge-duplicates')) return json(route, 409, { code: '23505', message: 'duplicate key' });
            db[table][i] = { ...db[table][i], ...row, created_at: db[table][i].created_at };
            notify('UPDATE', table, db[table][i]);
          } else { db[table].push(row); notify('INSERT', table, row); }
        }
        return route.fulfill({ status: 201, headers: { 'access-control-allow-origin': '*' } });
      }
      if (method === 'DELETE') {
        for (const r of filterRows(own(), url.searchParams)) del(table, r);
        return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
      }
    }
    return json(route, 404, { message: 'not mocked: ' + path });
  }

  // wie der Server: Erinnerung in die Mitteilungszentrale legen
  function addNotification(uid, n) {
    const row = { id: crypto.randomUUID(), user_id: uid, created_at: new Date(Date.now() + (n.offsetMs || 0)).toISOString(), read_at: null, body: '', url: null, ...n };
    delete row.offsetMs;
    db.notifications.push(row);
    notify('INSERT', 'notifications', row);
    return row;
  }

  return { db, users, state, handle, ws, sockets, addNotification };
}
