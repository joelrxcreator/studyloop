// Web Push ohne Zusatzpakete: VAPID (RFC 8292) + Verschlüsselung aes128gcm (RFC 8291) mit WebCrypto.
// Läuft in Deno (Supabase Edge Functions) und Node ≥ 20.

const enc = new TextEncoder();

export function b64uToBytes(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
export function bytesToB64u(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const concat = (...arrs) => {
  const out = new Uint8Array(arrs.reduce((a, x) => a + x.length, 0));
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
};

async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}
async function hkdf(salt, ikm, info, len) {
  const prk = await hmac(salt, ikm);
  const okm = await hmac(prk, concat(info, new Uint8Array([1])));
  return okm.slice(0, len);
}

/** VAPID-Schlüssel (base64url: public 65 Bytes, private 32 Bytes) → CryptoKey zum Signieren. */
async function vapidKey(publicKey, privateKey) {
  const pub = b64uToBytes(publicKey);
  const jwk = {
    kty: 'EC', crv: 'P-256', d: privateKey,
    x: bytesToB64u(pub.slice(1, 33)), y: bytesToB64u(pub.slice(33, 65)), ext: true,
  };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

export async function vapidHeader(endpoint, { publicKey, privateKey, subject }, expSeconds = 12 * 3600) {
  const aud = new URL(endpoint).origin;
  const header = bytesToB64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = bytesToB64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + expSeconds, sub: subject })));
  const key = await vapidKey(publicKey, privateKey);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${payload}`)));
  return `vapid t=${header}.${payload}.${bytesToB64u(sig)}, k=${publicKey}`;
}

/** Verschlüsselt die Nachricht für ein Abo (aes128gcm, ein Datensatz). */
export async function encryptPayload(sub, plaintext) {
  const uaPublic = b64uToBytes(sub.p256dh);
  const authSecret = b64uToBytes(sub.auth);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));

  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const data = concat(typeof plaintext === 'string' ? enc.encode(plaintext) : plaintext, new Uint8Array([2]));
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, data));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

/**
 * Sendet eine Push-Nachricht. Gibt { ok, status, gone, error } zurück.
 * gone = Abo existiert nicht mehr (404/410) → löschen.
 */
export async function sendPush(sub, payload, vapid, { ttl = 86400, urgency = 'high', fetchImpl = fetch } = {}) {
  try {
    const body = await encryptPayload(sub, JSON.stringify(payload));
    const res = await fetchImpl(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidHeader(sub.endpoint, vapid),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(ttl),
        Urgency: urgency,
      },
      body,
    });
    const ok = res.status >= 200 && res.status < 300;
    let error = null;
    if (!ok) error = `HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`.trim();
    return { ok, status: res.status, gone: res.status === 404 || res.status === 410, error };
  } catch (e) {
    return { ok: false, status: 0, gone: false, error: String(e?.message || e) };
  }
}
