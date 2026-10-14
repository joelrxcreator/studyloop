import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { encryptPayload, vapidHeader, sendPush, bytesToB64u, b64uToBytes } from '../supabase/functions/reminders/webpush.js';

// Unabhängige Entschlüsselung mit node:crypto (Empfänger-Seite, RFC 8291)
function hkdf(salt, ikm, info, len) {
  const prk = crypto.createHmac('sha256', salt).update(ikm).digest();
  return crypto.createHmac('sha256', prk).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, len);
}
function decrypt(body, uaEcdh, authSecret) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const cipher = body.subarray(21 + idlen);
  const shared = uaEcdh.computeSecret(asPublic);
  const ikm = hkdf(authSecret, shared, Buffer.concat([Buffer.from('WebPush: info\0'), uaEcdh.getPublicKey(), asPublic]), 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2); // Padding-Trenner
  return plain.subarray(0, plain.length - 1).toString();
}

function makeSubscriber() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return { ecdh, auth, sub: { endpoint: 'https://web.push.apple.com/abc', p256dh: bytesToB64u(ecdh.getPublicKey()), auth: bytesToB64u(auth) } };
}

function makeVapid() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: bytesToB64u(ecdh.getPublicKey()), privateKey: bytesToB64u(ecdh.getPrivateKey()), subject: 'https://example.org/app/' };
}

test('Verschlüsselte Nachricht lässt sich beim Empfänger entschlüsseln', async () => {
  const { ecdh, auth, sub } = makeSubscriber();
  const msg = JSON.stringify({ title: 'Mathe 1 · Übung', body: 'Pflichttermin morgen um 10:00 · Ümläute ✓' });
  const body = Buffer.from(await encryptPayload(sub, msg));
  assert.equal(decrypt(body, ecdh, auth), msg);
});

test('VAPID-JWT ist gültig signiert und hat die richtige Zielgruppe', async () => {
  const vapid = makeVapid();
  const h = await vapidHeader('https://web.push.apple.com/QGx/abc', vapid);
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h);
  assert.ok(m);
  const payload = JSON.parse(Buffer.from(b64uToBytes(m[2])).toString());
  assert.equal(payload.aud, 'https://web.push.apple.com');
  assert.equal(payload.sub, 'https://example.org/app/');
  const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: bytesToB64u(b64uToBytes(vapid.publicKey).slice(1, 33)), y: bytesToB64u(b64uToBytes(vapid.publicKey).slice(33)) }, format: 'jwk' });
  const ok = crypto.verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(b64uToBytes(m[3])));
  assert.ok(ok);
});

test('sendPush: 201 = ok, 410 = Abo weg, Netzfehler = nicht ok', async () => {
  const { sub } = makeSubscriber();
  const vapid = makeVapid();
  let seen;
  const r1 = await sendPush(sub, { title: 'x' }, vapid, { fetchImpl: async (url, init) => { seen = init; return new Response(null, { status: 201 }); } });
  assert.deepEqual({ ok: r1.ok, gone: r1.gone }, { ok: true, gone: false });
  assert.equal(seen.headers['Content-Encoding'], 'aes128gcm');
  const r2 = await sendPush(sub, { title: 'x' }, vapid, { fetchImpl: async () => new Response('gone', { status: 410 }) });
  assert.deepEqual({ ok: r2.ok, gone: r2.gone }, { ok: false, gone: true });
  const r3 = await sendPush(sub, { title: 'x' }, vapid, { fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(r3.ok, false); assert.match(r3.error, /offline/);
});

test('Server nutzt dieselbe Kernlogik wie die App (Datei synchron)', async () => {
  const fs = await import('node:fs');
  assert.equal(fs.readFileSync('supabase/functions/reminders/schedule.js', 'utf8'), fs.readFileSync('js/schedule.js', 'utf8'),
    'js/schedule.js nach supabase/functions/reminders/schedule.js kopieren');
});
