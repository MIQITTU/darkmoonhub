/* Darkmoon Hub server — site, Google sign-in, chat rooms, DMs, notifications,
   forum, marketplace, map pins, profiles and moderation. Zero dependencies. Node 18+.
   Start:  node server.js
   Environment:
     PORT              port (default 3000)
     DATABASE_URL      Postgres connection string (e.g. a free Neon database). When set, all data is kept there
     DATA_DIR          folder for db.json when DATABASE_URL is not set (default ./data)
     GOOGLE_CLIENT_ID  OAuth client ID from Google Cloud Console (required for Google sign-in)
     ADMIN_EMAILS      comma-separated emails that become admins when they sign in
     ALLOW_DEV_LOGIN   set to 1 to allow name+email sign-in without Google (testing only) */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const PORT = +process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA, 'db.json');
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
const DEV_LOGIN = process.env.ALLOW_DEV_LOGIN === '1';
const ROOM_KEEP = 3000, DM_KEEP = 2000, NOTIF_KEEP = 200;

/* ================= storage =================
   Everything lives in one in-memory object, saved shortly after each change.
   With DATABASE_URL set (e.g. a free Neon Postgres), it is saved there, so free hosts that wipe their disk lose nothing.
   Otherwise it is saved to DATA_DIR/db.json. */
const DATABASE_URL = process.env.DATABASE_URL || '';
const MAPS = ['users', 'subs', 'emails', 'tokens', 'rooms', 'messages', 'dms', 'notifs', 'threads', 'listings', 'pins'];
const dict = (o = {}) => Object.assign(Object.create(null), o);   // no prototype: "__proto__", "constructor" etc. are ordinary missing keys
const empty = () => Object.fromEntries(MAPS.map(k => [k, dict()]));
let db = empty();
function hydrate(raw) { db = { ...empty(), ...raw }; delete db.scores;   // psi-test scores from older versions are dropped
  MAPS.forEach(k => db[k] = dict(raw[k] || {})); Object.values(db.dms).forEach(d => d.read = dict(d.read || {}));
  // Older versions had psi-test achievements; their inbox notices are removed and members' achievements are re-recorded.
  const OLD = /^Achievement unlocked: (First Contact|Full Spectrum|Above the Noise|Two Sigma|Three Sigma|The Other Side|Consistent Signal|Initiate|Adept|Centurion|Remote Eye)\./;
  for (const k of Object.keys(db.notifs)) db.notifs[k] = db.notifs[k].filter(n => !(n.type === 'achievement' && OLD.test(n.text))); }
const newId = () => crypto.randomBytes(6).toString('hex');
let pool = null, saveTimer = null, firstDirty = 0, writing = null, dirty = false;
async function writeNow() {
  if (!pool) { fs.mkdirSync(DATA, { recursive: true }); const tmp = DB_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(db)); fs.renameSync(tmp, DB_FILE); return; }
  if (writing) { dirty = true; return writing; }
  writing = (async () => {
    do { dirty = false; const json = JSON.stringify(db);
      try { await pool.query('INSERT INTO darkmoon_store (k, v, at) VALUES ($1, $2, now()) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, at = now()', ['db', json]); }
      catch (e) { console.error('Database save failed, will retry:', e.message); dirty = false; setTimeout(save, 5000); break; }
    } while (dirty);
  })().finally(() => { writing = null; });
  return writing;
}
// File: save 0.3 s after the last change. Postgres: 2 s after the last change, at most 10 s after the first, to keep the free database mostly idle.
function save() {
  const now = Date.now(); if (!saveTimer) firstDirty = now; clearTimeout(saveTimer);
  const wait = pool ? Math.max(0, Math.min(2000, firstDirty + 10000 - now)) : 300;
  saveTimer = setTimeout(() => { saveTimer = null; writeNow().catch(e => console.error(e)); }, wait);
}
async function initStore() {
  if (DATABASE_URL) {
    let Pool; try { ({ Pool } = require('pg')); } catch (e) { console.error('DATABASE_URL is set but the "pg" package is missing. Run: npm install'); process.exit(1); }
    pool = new Pool({ connectionString: DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : { rejectUnauthorized: false }, max: 2, idleTimeoutMillis: 10000 });
    pool.on('error', e => console.error('Database connection error:', e.message));
    for (let i = 1; ; i++) {   // free databases can take a few seconds to wake up
      try { await pool.query('CREATE TABLE IF NOT EXISTS darkmoon_store (k text PRIMARY KEY, v text NOT NULL, at timestamptz NOT NULL DEFAULT now())'); break; }
      catch (e) { if (i >= 6) { console.error('Could not reach the database:', e.message); process.exit(1); } console.log('Waiting for the database…'); await new Promise(r => setTimeout(r, 2000 * i)); }
    }
    const r = await pool.query('SELECT v FROM darkmoon_store WHERE k = $1', ['db']);
    if (r.rows[0]) hydrate(JSON.parse(r.rows[0].v));
  } else {
    try { hydrate(JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); } catch (e) { /* first run */ }
  }
  if (!Object.keys(db.rooms).length) {
    [['General', 'Talk about anything.'], ['Sightings', 'What you saw, where and when.'], ['Experiences', 'Dreams, signs and the unexplained.']]
      .forEach(([title, desc], i) => { const id = newId(); db.rooms[id] = { id, title, desc, order: i, created: Date.now() }; db.messages[id] = []; });
  }
  await writeNow();
}
let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => {
  if (stopping) return; stopping = true; clearTimeout(saveTimer);
  try { await Promise.race([(async () => { if (writing) await writing; await writeNow(); if (pool) await pool.end(); })(), new Promise(r => setTimeout(r, 8000))]); }
  catch (e) { console.error(e); } finally { process.exit(0); }
});

/* ================= helpers ================= */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'SAMEORIGIN' };
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const fail = (code, msg) => { throw new HttpError(code, msg); };
function send(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SEC }); res.end(JSON.stringify(obj)); }
function readBody(req) {
  return new Promise((ok, bad) => {
    // Oversized bodies get a clear 413 reply; the rest of the upload is drained instead of cutting the connection.
    let s = '', over = false;
    req.on('data', c => { if (over) return; s += c; if (s.length > 20000) { over = true; s = ''; bad(new HttpError(413, 'That is too long to send.')); } });
    req.on('end', () => { if (over) return; try { ok(s ? JSON.parse(s) : {}); } catch (e) { bad(new HttpError(400, 'Malformed request.')); } });
    req.on('error', () => bad(new HttpError(400, 'The upload was interrupted.')));
  });
}
const hitLog = new Map();
function limit(key, max, ms, msg) {
  const now = Date.now(), a = (hitLog.get(key) || []).filter(t => now - t < ms); a.push(now); hitLog.set(key, a);
  if (a.length > max) fail(429, msg || 'Slow down a little.');
}
setInterval(() => { const now = Date.now(); for (const [k, a] of hitLog) if (!a.some(t => now - t < 3600e3)) hitLog.delete(k); }, 600e3).unref();
function text(v, max, { min = 0, field = 'Text', multiline = true } = {}) {
  let s = String(v ?? '').replace(/\r\n?/g, '\n').replace(multiline ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, '').trim();
  if (s.length < min) fail(400, min > 1 ? `${field} needs at least ${min} characters.` : `${field} can't be empty.`);
  if (s.length > max) fail(400, `${field} can be at most ${max} characters.`);
  return s;
}
/* ---- names ----
   Display names are unique by "look", not just by spelling: "Nyx", "nyx", "N.y.x", "Nyx_" and "Nуx" (Cyrillic у)
   all count as the same name, so nobody can pose as someone else. */
const NAME = /^[\p{L}\p{N}](?:[\p{L}\p{N}]|[ ._\-](?=[\p{L}\p{N}])){1,23}$/u, EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NAME_RULE = 'Names are 2–24 characters: letters and numbers, with single spaces, dots, dashes or underscores between them.';
const LOOKALIKE = { 'а': 'a', 'в': 'b', 'е': 'e', 'ё': 'e', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o', 'р': 'p', 'с': 'c', 'т': 't', 'у': 'y', 'х': 'x', 'і': 'i', 'ј': 'j', 'ѕ': 's', 'ԁ': 'd', 'ɡ': 'g',
  'α': 'a', 'β': 'b', 'ε': 'e', 'η': 'n', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ο': 'o', 'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x', 'ω': 'w', '0': 'o', '1': 'l', '|': 'l', 'ı': 'i', 'ł': 'l' };
const nameKey = n => String(n).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/./gu, c => LOOKALIKE[c] || c).replace(/i/g, 'l').replace(/[ ._\-]/g, '');
const RESERVED = ['admin', 'administrator', 'moderator', 'mod', 'staff', 'system', 'support', 'darkmoon', 'darkmoonhub', 'deleted', 'everyone', 'here', 'official'].map(nameKey);
const nameTaken = (name, except) => { const k = nameKey(name); return Object.values(db.users).some(u => u.uid !== except && nameKey(u.name) === k); };
// Tidies a typed name (Unicode-normalised, single spaces) and checks it. Returns the clean name or fails with a clear message.
function checkName(raw, except) {
  const name = String(raw ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!NAME.test(name)) fail(400, NAME_RULE);
  if (RESERVED.includes(nameKey(name))) fail(400, 'That name is reserved. Choose another.');
  if (nameTaken(name, except)) fail(409, 'That name is taken (or looks too much like an existing one). Choose another.');
  return name;
}
function uniqueName(base) {
  let b = String(base || 'Seer').normalize('NFKC').replace(/[^\p{L}\p{N} ._\-]/gu, '').replace(/[ ._\-]{2,}/g, ' ').replace(/^[ ._\-]+|[ ._\-]+$/g, '').slice(0, 20).replace(/[ ._\-]+$/, '');
  if (!NAME.test(b) || RESERVED.includes(nameKey(b))) b = 'Seer';
  let n = b, i = 2; while (nameTaken(n)) n = b + (i++); return n;
}
const brief = uid => { const u = db.users[uid]; return u ? { uid, name: u.name, role: u.role } : { uid, name: 'deleted', role: 'user' }; };
const pub = u => ({ uid: u.uid, name: u.name, role: u.role, bio: u.bio || '', created: u.created, banned: !!u.banned });
const meView = u => ({ ...pub(u), email: u.email, mutedUntil: u.mutedUntil || 0 });
const isAdmin = u => u && u.role === 'admin';
const canEdit = (u, ownerUid) => u && (u.uid === ownerUid || isAdmin(u));

/* ================= auth ================= */
function userFromReq(req, url) {
  const h = /^Bearer\s+([a-f0-9]{48})$/.exec(req.headers.authorization || ''), tok = h ? h[1] : url.searchParams.get('token');
  const t = tok && db.tokens[tok]; return t ? db.users[t.uid] : null;
}
function need(ctx, { post = false, admin = false } = {}) {
  const u = ctx.user;
  if (!u) fail(401, 'Sign in first.');
  if (u.banned) fail(403, 'This account has been banned.');
  if (post && u.mutedUntil > Date.now()) fail(403, `You are muted until ${new Date(u.mutedUntil).toUTCString()}.`);
  if (admin && !isAdmin(u)) fail(403, 'Admins only.');
  return u;
}
function issue(u) {
  const token = crypto.randomBytes(24).toString('hex'); db.tokens[token] = { uid: u.uid, created: Date.now() };
  if (ADMIN_EMAILS.includes(u.email)) u.role = 'admin';
  save(); return { token, user: meView(u) };
}
let jwks = { keys: [], exp: 0 };
async function googleKeys(force) {
  if (!force && Date.now() < jwks.exp) return jwks.keys;
  let r; try { r = await fetch('https://www.googleapis.com/oauth2/v3/certs'); } catch (e) { fail(502, 'Could not reach Google to check your sign-in. Try again in a moment.'); }
  if (!r.ok) fail(502, 'Could not reach Google to check your sign-in. Try again in a moment.');
  const m = /max-age=(\d+)/.exec(r.headers.get('cache-control') || ''); const j = await r.json();
  jwks = { keys: j.keys, exp: Date.now() + (m ? +m[1] : 3600) * 1000 }; return jwks.keys;
}
async function verifyGoogle(credential) {
  if (!GOOGLE_CLIENT_ID) fail(503, 'Google sign-in is not configured on this server.');
  const parts = String(credential || '').split('.'); if (parts.length !== 3) fail(400, 'Invalid Google credential.');
  const dec = s => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
  let header, payload; try { header = dec(parts[0]); payload = dec(parts[1]); } catch (e) { fail(400, 'Invalid Google credential.'); }
  if (header.alg !== 'RS256') fail(400, 'Invalid Google credential.');
  let jwk = (await googleKeys()).find(k => k.kid === header.kid); if (!jwk) jwk = (await googleKeys(true)).find(k => k.kid === header.kid);
  if (!jwk) fail(401, 'Google key not recognised.');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
  if (!ok) fail(401, 'Google signature check failed.');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss)) fail(401, 'Credential was not issued by Google.');
  if (payload.aud !== GOOGLE_CLIENT_ID) fail(401, 'Credential was issued for a different site.');
  if (payload.exp * 1000 < Date.now()) fail(401, 'Google sign-in expired. Try again.');
  if (!payload.email || payload.email_verified === false) fail(401, 'Your Google account has no verified email.');
  return payload;
}

/* ================= live events (Server-Sent Events) ================= */
const streams = new Map(); // uid -> Set(res)
function emit(uid, event, data) { const set = streams.get(uid); if (!set) return; const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; for (const r of set) r.write(msg); }
function broadcast(event, data, filter) { for (const uid of streams.keys()) if (!filter || filter(uid)) emit(uid, event, data); }
setInterval(() => { for (const set of streams.values()) for (const r of set) r.write(': ping\n\n'); }, 25000).unref();
function closeStreams(uid) { const set = streams.get(uid); if (set) for (const r of set) r.end(); streams.delete(uid); }

/* ================= notifications ================= */
const unread = uid => (db.notifs[uid] || []).filter(n => !n.read).length;
function notify(uid, { type, text: t, link, key }) {
  if (!db.users[uid]) return;
  const list = db.notifs[uid] || (db.notifs[uid] = []);
  const ex = key && list.find(n => n.key === key && !n.read);
  if (ex) { ex.text = t; ex.at = Date.now(); ex.count = (ex.count || 1) + 1; }
  else list.unshift({ id: newId(), type, text: t, link, key, at: Date.now(), read: false });
  list.sort((a, b) => b.at - a.at); if (list.length > NOTIF_KEEP) list.length = NOTIF_KEEP;
  save(); emit(uid, 'notif', { unread: unread(uid) });
}

/* ================= routing ================= */
const routes = [];
function on(method, pattern, fn) { const keys = []; const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$'); routes.push({ method, re, keys, fn }); }
const matchQ = (q, ...fields) => { const terms = String(q || '').toLowerCase().split(/\s+/).filter(Boolean); if (!terms.length) return true; const hay = fields.join(' ').toLowerCase(); return terms.every(t => hay.includes(t)); };

/* ---- health & auth ---- */
on('GET', '/api/health', () => ({ ok: true, google: GOOGLE_CLIENT_ID || null, dev: DEV_LOGIN }));
on('POST', '/api/auth/google', async ctx => {
  limit('auth:' + ctx.ip, 120, 600e3, 'Too many sign-in attempts from this network. Wait a few minutes.');
  const p = await verifyGoogle(ctx.body.credential), email = p.email.toLowerCase();
  let uid = db.subs[p.sub] || db.emails[email], u = uid && db.users[uid];
  if (!u) { uid = newId(); u = db.users[uid] = { uid, name: uniqueName(p.given_name || p.name || email.split('@')[0]), email, role: 'user', created: Date.now(), bio: '', ach: [] }; db.emails[email] = uid; }
  db.subs[p.sub] = uid; u.googleSub = p.sub;
  if (u.banned) fail(403, 'This account has been banned.');
  return issue(u);
});
on('POST', '/api/auth/dev', ctx => {
  if (!DEV_LOGIN) fail(404, 'Not found.');
  limit('auth:' + ctx.ip, 120, 600e3, 'Too many sign-in attempts from this network. Wait a few minutes.');
  const email = String(ctx.body.email || '').trim().toLowerCase();
  if (!EMAIL.test(email)) fail(400, 'Enter a valid email address.');
  let u = db.users[db.emails[email]];
  if (!u) { const name = checkName(ctx.body.name); const uid = newId(); u = db.users[uid] = { uid, name, email, role: 'user', created: Date.now(), bio: '', ach: [] }; db.emails[email] = uid; }
  if (u.banned) fail(403, 'This account has been banned.');
  return issue(u);
});
on('POST', '/api/auth/logout', ctx => { const h = /^Bearer\s+([a-f0-9]{48})$/.exec(ctx.req.headers.authorization || ''); if (h) { delete db.tokens[h[1]]; save(); } return { ok: true }; });

/* ---- me & profiles ---- */
on('GET', '/api/me', ctx => { const u = ctx.user; if (!u) fail(401, 'Sign in first.');
  if (!Array.isArray(u.ach) || (!u.ach.includes('moon') && Date.now() - u.created >= 30 * 864e5)) award(u);
  return { user: meView(u), unread: unread(u.uid) }; });
on('PATCH', '/api/me', ctx => {
  const u = need(ctx);
  if (ctx.body.name !== undefined) {
    // Saving the profile resends the current name; only an actual change is checked, so older names that predate the rules keep working.
    const typed = String(ctx.body.name ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (typed !== u.name) {
      const name = checkName(typed, u.uid), recent = (u.renames || []).filter(t => Date.now() - t < 864e5);   // kept on the member, so restarts don't reset it
      if (recent.length >= 3) fail(429, 'You can change your name at most 3 times a day.');
      u.name = name; u.renames = [...recent, Date.now()];
    }
  }
  if (ctx.body.bio !== undefined) u.bio = text(ctx.body.bio, 500, { field: 'Bio' });
  save(); return { user: meView(u) };
});
/* ---- achievements: earned through community activity ---- */
const ACH = [
  ['words', 'First Words', 'Send a message in a chat room.', c => c.chat >= 1],
  ['regular', 'Regular', 'Send 100 chat messages.', c => c.chat >= 100],
  ['voice', 'Witness', 'Start a forum thread.', c => c.threads >= 1],
  ['chronicler', 'Chronicler', 'Start 10 forum threads.', c => c.threads >= 10],
  ['reply', 'Voice in the Dark', 'Comment on a thread.', c => c.comments >= 1],
  ['counsel', 'Counsel', 'Leave 25 comments.', c => c.comments >= 25],
  ['pin', 'Cartographer', 'Place a pin on the map.', c => c.pins >= 1],
  ['surveyor', 'Surveyor', 'Place 10 pins on the map.', c => c.pins >= 10],
  ['trade', 'Merchant', 'Post a listing in the market.', c => c.listings >= 1],
  ['moon', 'Full Cycle', 'Be a member for 30 days.', c => c.days >= 30]
];
function activity(uid) {
  const u = db.users[uid] || {}, c = { chat: 0, threads: 0, comments: 0, pins: 0, listings: 0, days: (Date.now() - (u.created || Date.now())) / 864e5 };
  for (const list of Object.values(db.messages)) for (const m of list) if (m.uid === uid) c.chat++;
  for (const t of Object.values(db.threads)) { if (t.uid === uid) c.threads++; for (const m of t.comments) if (m.uid === uid) c.comments++; }
  for (const p of Object.values(db.pins)) if (p.uid === uid) c.pins++;
  for (const l of Object.values(db.listings)) if (l.uid === uid) c.listings++;
  return c;
}
// Once unlocked (recorded in u.ach), an achievement stays earned even if the content behind it is later deleted.
const achievements = uid => { const c = activity(uid), had = (db.users[uid] && db.users[uid].ach) || []; return { counts: c, list: ACH.map(([id, name, desc, ok]) => ({ id, name, desc, earned: had.includes(id) || !!ok(c) })) }; };
// Called after anything that can earn an achievement: notifies once per new achievement.
// Existing members' earlier achievements are recorded silently the first time.
function award(u) {
  const now = achievements(u.uid).list.filter(a => a.earned), first = !Array.isArray(u.ach); if (first) u.ach = [];
  for (const a of now) if (!u.ach.includes(a.id)) { u.ach.push(a.id); if (!first) notify(u.uid, { type: 'achievement', text: `Achievement unlocked: ${a.name}. ${a.desc}`, link: 'profile.html#' + u.uid }); }
  save();
}
on('GET', '/api/users/:uid', ctx => {
  const u = db.users[ctx.params.uid]; if (!u) fail(404, 'No such user.');
  const a = achievements(u.uid);
  return {
    user: pub(u), achievements: a.list, counts: { chat: a.counts.chat, threads: a.counts.threads, comments: a.counts.comments, pins: a.counts.pins, listings: a.counts.listings },
    threads: Object.values(db.threads).filter(t => t.uid === u.uid).sort((a, b) => b.at - a.at).slice(0, 20).map(t => ({ id: t.id, title: t.title, at: t.at, comments: t.comments.length })),
    listings: Object.values(db.listings).filter(l => l.uid === u.uid).sort((a, b) => b.at - a.at).slice(0, 20).map(l => ({ id: l.id, title: l.title, price: l.price, sold: !!l.sold, at: l.at })),
    pins: Object.values(db.pins).filter(p => p.uid === u.uid).map(p => ({ id: p.id, title: p.title, lat: p.lat, lng: p.lng }))
  };
});
on('GET', '/api/users', ctx => {
  need(ctx); const q = ctx.url.searchParams.get('q');
  const k = String(q || '').toLowerCase().trim();
  return { users: Object.values(db.users).filter(u => !u.banned && matchQ(q, u.name))
    .sort((a, b) => (b.name.toLowerCase().startsWith(k) - a.name.toLowerCase().startsWith(k)) || a.name.localeCompare(b.name)).slice(0, 20).map(pub) };
});

/* ---- chat rooms ---- */
const roomList = () => Object.values(db.rooms).sort((a, b) => a.order - b.order || a.created - b.created).map(r => {
  const m = db.messages[r.id] || []; return { ...r, count: m.length, lastAt: m.length ? m[m.length - 1].at : r.created };
});
const msgOut = m => ({ ...m, author: brief(m.uid), tags: (m.tags || []).map(brief) });
on('GET', '/api/rooms', ctx => { need(ctx); return { rooms: roomList() }; });
on('POST', '/api/rooms', ctx => {
  need(ctx, { admin: true }); const id = newId();
  db.rooms[id] = { id, title: text(ctx.body.title, 40, { min: 2, field: 'Room name', multiline: false }), desc: text(ctx.body.desc, 200, { field: 'Description', multiline: false }), order: Object.keys(db.rooms).length, created: Date.now() };
  db.messages[id] = []; save(); broadcast('rooms', {}); return { room: db.rooms[id] };
});
on('PATCH', '/api/rooms/:id', ctx => {
  need(ctx, { admin: true }); const r = db.rooms[ctx.params.id]; if (!r) fail(404, 'No such room.');
  if (ctx.body.title !== undefined) r.title = text(ctx.body.title, 40, { min: 2, field: 'Room name', multiline: false });
  if (ctx.body.desc !== undefined) r.desc = text(ctx.body.desc, 200, { field: 'Description', multiline: false });
  if (ctx.body.order !== undefined && Number.isFinite(+ctx.body.order)) r.order = +ctx.body.order;
  save(); broadcast('rooms', {}); return { room: r };
});
on('DELETE', '/api/rooms/:id', ctx => {
  need(ctx, { admin: true }); if (!db.rooms[ctx.params.id]) fail(404, 'No such room.');
  if (Object.keys(db.rooms).length <= 1) fail(400, 'Keep at least one room.');
  delete db.rooms[ctx.params.id]; delete db.messages[ctx.params.id]; save(); broadcast('rooms', {}); return { ok: true };
});
on('GET', '/api/rooms/:id/messages', ctx => {
  need(ctx); const m = db.messages[ctx.params.id]; if (!m) fail(404, 'No such room.');
  const before = +ctx.url.searchParams.get('before') || Infinity, list = m.filter(x => x.at < before);
  return { messages: list.slice(-60).map(msgOut), more: list.length > 60 };
});
/* ---- tags (@Name) ----
   At each "@", the longest member name that matches exactly (ignoring capitals) and ends at a word boundary wins,
   so "@Ann" never tags "Anna", and "@Nyx." at the end of a sentence still tags Nyx. */
const WORDCH = /[\p{L}\p{N}_]/u;
function findTags(t) {
  const out = []; if (!t || !t.includes('@')) return out;
  const users = Object.values(db.users).filter(u => !u.banned).map(u => [u.uid, u.name.toLowerCase()]).sort((a, b) => b[1].length - a[1].length);
  const lower = t.toLowerCase();
  for (let i = lower.indexOf('@'); i >= 0; i = lower.indexOf('@', i + 1)) {
    if (i > 0 && (WORDCH.test(t[i - 1]) || t[i - 1] === '/')) continue;   // e-mail addresses (a@b.com) and web links (x.com/@name) are not tags
    for (const [uid, n] of users) if (lower.startsWith(n, i + 1) && !WORDCH.test(t[i + 1 + n.length] || '') && !/^[.\-][\p{L}\p{N}]/u.test(t.slice(i + 1 + n.length, i + 3 + n.length))) { if (!out.includes(uid)) out.push(uid); break; }
  }
  return out.slice(0, 20);
}
// Notifies tagged members (not the author) and returns who was tagged, so it can be stored with the post.
function mentions(t, from, link, where) {
  const tags = findTags(t).filter(uid => uid !== from.uid);
  tags.forEach(uid => { notify(uid, { type: 'mention', text: `${from.name} tagged you in ${where}`, link }); });
  return tags;
}
on('POST', '/api/rooms/:id/messages', ctx => {
  const u = need(ctx, { post: true }), room = db.rooms[ctx.params.id]; if (!room) fail(404, 'No such room.');
  limit('chat:' + u.uid, 8, 10e3, 'You are sending messages too quickly.');
  const m = { id: newId(), uid: u.uid, text: text(ctx.body.text, 1000, { min: 1, field: 'Message' }), at: Date.now() };
  const list = db.messages[room.id]; list.push(m); if (list.length > ROOM_KEEP) list.splice(0, list.length - ROOM_KEEP);
  m.tags = mentions(m.text, u, 'chat.html#' + room.id, '#' + room.title); if (!m.tags.length) delete m.tags;
  save(); broadcast('msg', { rid: room.id, m: msgOut(m) }); award(u);
  return { message: msgOut(m) };
});
on('DELETE', '/api/rooms/:id/messages/:mid', ctx => {
  const u = need(ctx), list = db.messages[ctx.params.id]; if (!list) fail(404, 'No such room.');
  const i = list.findIndex(m => m.id === ctx.params.mid); if (i < 0) fail(404, 'Message not found.');
  if (!canEdit(u, list[i].uid)) fail(403, 'You can only delete your own messages.');
  list.splice(i, 1); save(); broadcast('msg-del', { rid: ctx.params.id, id: ctx.params.mid }); return { ok: true };
});

/* ---- direct messages ---- */
const dmOf = (u, id) => { const d = db.dms[id]; if (!d || !d.members.includes(u.uid)) fail(404, 'Conversation not found.'); return d; };
const dmUnread = (d, uid) => d.messages.filter(m => m.uid !== uid && m.at > ((d.read || {})[uid] || 0)).length;
on('GET', '/api/dms', ctx => {
  const u = need(ctx);
  return { dms: Object.values(db.dms).filter(d => d.members.includes(u.uid) && d.messages.length).sort((a, b) => b.lastAt - a.lastAt).map(d => {
    const other = d.members.find(x => x !== u.uid) || u.uid, last = d.messages[d.messages.length - 1];
    return { id: d.id, other: brief(other), last: last ? { text: last.text.slice(0, 120), at: last.at, mine: last.uid === u.uid } : null, unread: dmUnread(d, u.uid) };
  }) };
});
on('POST', '/api/dms', ctx => {
  const u = need(ctx), other = db.users[ctx.body.uid];
  if (!other || other.banned) fail(404, 'No such user.'); if (other.uid === u.uid) fail(400, "You can't message yourself.");
  const id = [u.uid, other.uid].sort().join('-');
  if (!db.dms[id]) { db.dms[id] = { id, members: [u.uid, other.uid], messages: [], read: dict(), lastAt: Date.now() }; save(); }
  return { id };
});
on('GET', '/api/dms/:id', ctx => {
  const u = need(ctx), d = dmOf(u, ctx.params.id), other = d.members.find(x => x !== u.uid);
  return { id: d.id, other: brief(other), messages: d.messages.slice(-200).map(msgOut) };
});
on('POST', '/api/dms/:id/messages', ctx => {
  const u = need(ctx, { post: true }), d = dmOf(u, ctx.params.id), other = d.members.find(x => x !== u.uid);
  if (db.users[other]?.banned) fail(403, 'This user is no longer available.');
  limit('dm:' + u.uid, 10, 10e3, 'You are sending messages too quickly.');
  const m = { id: newId(), uid: u.uid, text: text(ctx.body.text, 2000, { min: 1, field: 'Message' }), at: Date.now() };
  d.messages.push(m); if (d.messages.length > DM_KEEP) d.messages.splice(0, d.messages.length - DM_KEEP);
  d.lastAt = m.at; (d.read || (d.read = dict()))[u.uid] = m.at; save();
  d.members.forEach(x => emit(x, 'dm', { id: d.id, m: msgOut(m) }));
  notify(other, { type: 'dm', text: `New message from ${u.name}`, link: 'dms.html#' + d.id, key: 'dm:' + d.id });
  return { message: msgOut(m) };
});
on('DELETE', '/api/dms/:id/messages/:mid', ctx => {
  const u = need(ctx), d = dmOf(u, ctx.params.id), i = d.messages.findIndex(m => m.id === ctx.params.mid);
  if (i < 0) fail(404, 'Message not found.');
  if (d.messages[i].uid !== u.uid) fail(403, 'You can only delete your own messages.');
  d.messages.splice(i, 1); save(); d.members.forEach(x => emit(x, 'dm-del', { id: d.id, mid: ctx.params.mid })); return { ok: true };
});
on('POST', '/api/dms/:id/read', ctx => {
  const u = need(ctx), d = dmOf(u, ctx.params.id); (d.read || (d.read = dict()))[u.uid] = Date.now();
  (db.notifs[u.uid] || []).forEach(n => { if (n.key === 'dm:' + d.id) n.read = true; });
  save(); emit(u.uid, 'notif', { unread: unread(u.uid) }); return { ok: true };
});

/* ---- notifications ---- */
on('GET', '/api/notifications', ctx => { const u = need(ctx); return { notifications: (db.notifs[u.uid] || []).slice(0, 100), unread: unread(u.uid) }; });
on('POST', '/api/notifications/read', ctx => {
  const u = need(ctx), ids = Array.isArray(ctx.body.ids) ? ctx.body.ids : null;
  (db.notifs[u.uid] || []).forEach(n => { if (!ids || ids.includes(n.id)) n.read = true; });
  save(); emit(u.uid, 'notif', { unread: unread(u.uid) }); return { unread: unread(u.uid) };
});

/* ---- forum ---- */
const threadOut = (t, full) => ({ id: t.id, title: t.title, author: brief(t.uid), at: t.at, lastAt: t.lastAt, comments: full ? t.comments.map(msgOut) : t.comments.length, ...(full ? { body: t.body, tags: (t.tags || []).map(brief) } : { excerpt: t.body.slice(0, 220) }) });
on('GET', '/api/threads', ctx => {
  const q = ctx.url.searchParams.get('q');
  return { threads: Object.values(db.threads).filter(t => matchQ(q, t.title, t.body, brief(t.uid).name)).sort((a, b) => b.lastAt - a.lastAt).slice(0, 100).map(t => threadOut(t)) };
});
on('POST', '/api/threads', ctx => {
  const u = need(ctx, { post: true }); limit('thread:' + u.uid, 4, 600e3, 'You can start at most 4 threads every 10 minutes.');
  const id = newId(), now = Date.now();
  db.threads[id] = { id, uid: u.uid, title: text(ctx.body.title, 120, { min: 3, field: 'Title', multiline: false }), body: text(ctx.body.body, 10000, { min: 1, field: 'Post' }), at: now, lastAt: now, comments: [] };
  const tags = mentions(db.threads[id].body, u, 'thread.html#' + id, 'a forum thread'); if (tags.length) db.threads[id].tags = tags;
  save(); award(u); return { thread: threadOut(db.threads[id], true) };
});
on('GET', '/api/threads/:id', ctx => { const t = db.threads[ctx.params.id]; if (!t) fail(404, 'This thread no longer exists.'); return { thread: threadOut(t, true) }; });
on('DELETE', '/api/threads/:id', ctx => {
  const u = need(ctx), t = db.threads[ctx.params.id]; if (!t) fail(404, 'This thread no longer exists.');
  if (!canEdit(u, t.uid)) fail(403, 'You can only delete your own threads.'); delete db.threads[t.id]; save(); return { ok: true };
});
on('POST', '/api/threads/:id/comments', ctx => {
  const u = need(ctx, { post: true }), t = db.threads[ctx.params.id]; if (!t) fail(404, 'This thread no longer exists.');
  limit('comment:' + u.uid, 6, 60e3, 'You are commenting too quickly.');
  const c = { id: newId(), uid: u.uid, text: text(ctx.body.text, 3000, { min: 1, field: 'Comment' }), at: Date.now() };
  const tags = mentions(c.text, u, 'thread.html#' + t.id, `a comment on “${t.title}”`); if (tags.length) c.tags = tags;
  t.comments.push(c); t.lastAt = c.at; save();
  const watchers = new Set([t.uid, ...t.comments.map(x => x.uid)]); watchers.delete(u.uid); tags.forEach(x => watchers.delete(x));
  watchers.forEach(w => notify(w, { type: 'comment', text: `${u.name} commented on “${t.title}”`, link: 'thread.html#' + t.id, key: 'thread:' + t.id }));
  award(u);
  return { comment: msgOut(c) };
});
on('DELETE', '/api/threads/:id/comments/:cid', ctx => {
  const u = need(ctx), t = db.threads[ctx.params.id]; if (!t) fail(404, 'This thread no longer exists.');
  const i = t.comments.findIndex(c => c.id === ctx.params.cid); if (i < 0) fail(404, 'Comment not found.');
  if (!canEdit(u, t.comments[i].uid)) fail(403, 'You can only delete your own comments.'); t.comments.splice(i, 1); save(); return { ok: true };
});

/* ---- marketplace ---- */
const listingOut = l => ({ ...l, author: brief(l.uid) });
function listingFields(b, l) {
  if (b.title !== undefined) l.title = text(b.title, 100, { min: 3, field: 'Title', multiline: false });
  if (b.desc !== undefined) l.desc = text(b.desc, 4000, { min: 1, field: 'Description' });
  if (b.price !== undefined) l.price = text(b.price, 30, { min: 1, field: 'Price', multiline: false });
  if (b.sold !== undefined) l.sold = !!b.sold;
}
on('GET', '/api/listings', ctx => {
  const q = ctx.url.searchParams.get('q');
  return { listings: Object.values(db.listings).filter(l => matchQ(q, l.title, l.desc, l.price, brief(l.uid).name)).sort((a, b) => (a.sold - b.sold) || b.at - a.at).slice(0, 200).map(listingOut) };
});
on('POST', '/api/listings', ctx => {
  const u = need(ctx, { post: true }); limit('listing:' + u.uid, 6, 3600e3, 'You can post at most 6 listings an hour.');
  for (const f of ['title', 'desc', 'price']) if (ctx.body[f] === undefined) ctx.body[f] = '';
  const l = { id: newId(), uid: u.uid, at: Date.now(), sold: false }; listingFields(ctx.body, l); db.listings[l.id] = l; save(); award(u); return { listing: listingOut(l) };
});
on('PATCH', '/api/listings/:id', ctx => {
  const u = need(ctx, { post: true }), l = db.listings[ctx.params.id]; if (!l) fail(404, 'Listing not found.');
  if (!canEdit(u, l.uid)) fail(403, 'You can only edit your own listings.'); listingFields(ctx.body, l); save(); return { listing: listingOut(l) };
});
on('DELETE', '/api/listings/:id', ctx => {
  const u = need(ctx), l = db.listings[ctx.params.id]; if (!l) fail(404, 'Listing not found.');
  if (!canEdit(u, l.uid)) fail(403, 'You can only delete your own listings.'); delete db.listings[l.id]; save(); return { ok: true };
});

/* ---- map pins ---- */
const pinOut = p => ({ ...p, author: brief(p.uid) });
const coord = (v, max, f) => { const n = Number(v); if (!Number.isFinite(n) || Math.abs(n) > max) fail(400, `Invalid ${f}.`); return Math.round(n * 1e6) / 1e6; };
on('GET', '/api/pins', () => ({ pins: Object.values(db.pins).map(pinOut) }));
on('POST', '/api/pins', ctx => {
  const u = need(ctx, { post: true }); limit('pin:' + u.uid, 10, 600e3, 'You are adding pins too quickly.');
  if (Object.values(db.pins).filter(p => p.uid === u.uid).length >= 50) fail(400, 'You can have at most 50 pins. Delete one first.');
  const p = { id: newId(), uid: u.uid, title: text(ctx.body.title, 80, { min: 1, field: 'Title', multiline: false }), desc: text(ctx.body.desc, 1000, { field: 'Description' }),
    lat: coord(ctx.body.lat, 90, 'latitude'), lng: coord(ctx.body.lng, 180, 'longitude'), locked: true, at: Date.now() };
  db.pins[p.id] = p; save(); broadcast('pin', { action: 'add', pin: pinOut(p) }); award(u); return { pin: pinOut(p) };
});
on('PATCH', '/api/pins/:id', ctx => {
  const u = need(ctx), p = db.pins[ctx.params.id]; if (!p) fail(404, 'Pin not found.');
  if (!canEdit(u, p.uid)) fail(403, 'Only the owner or an admin can change this pin.');
  const b = ctx.body, moving = b.lat !== undefined || b.lng !== undefined;
  if (b.locked !== undefined) p.locked = !!b.locked;
  if (moving) { if (p.locked) fail(409, 'This pin is locked. Unlock it before moving it.'); p.lat = coord(b.lat, 90, 'latitude'); p.lng = coord(b.lng, 180, 'longitude'); }
  if (b.title !== undefined) p.title = text(b.title, 80, { min: 1, field: 'Title', multiline: false });
  if (b.desc !== undefined) p.desc = text(b.desc, 1000, { field: 'Description' });
  save(); broadcast('pin', { action: 'update', pin: pinOut(p) }); return { pin: pinOut(p) };
});
on('DELETE', '/api/pins/:id', ctx => {
  const u = need(ctx), p = db.pins[ctx.params.id]; if (!p) fail(404, 'Pin not found.');
  if (!canEdit(u, p.uid)) fail(403, 'Only the owner or an admin can delete this pin.');
  delete db.pins[p.id]; save(); broadcast('pin', { action: 'delete', id: p.id }); return { ok: true };
});
const geoCache = new Map(); let geoLast = 0;
on('GET', '/api/geocode', async ctx => {
  const q = text(ctx.url.searchParams.get('q'), 120, { min: 2, field: 'Search', multiline: false }).toLowerCase();
  limit('geo:' + ctx.ip, 30, 60e3, 'Too many searches. Wait a moment.');
  if (geoCache.has(q)) return { results: geoCache.get(q) };
  const wait = 1100 - (Date.now() - geoLast); if (wait > 0) await new Promise(r => setTimeout(r, wait)); geoLast = Date.now();
  let r; try { r = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=' + encodeURIComponent(q), { headers: { 'User-Agent': 'DarkmoonHub/3.6 (community map)', 'Accept-Language': 'en' }, signal: AbortSignal.timeout(8000) }); }
  catch (e) { fail(502, 'Place search is unavailable right now. You can still tap the map to pin a spot.'); }
  if (!r.ok) fail(502, 'Place search is unavailable right now.');
  const results = (await r.json()).map(x => ({ name: x.display_name, lat: +x.lat, lng: +x.lon }));
  geoCache.set(q, results); if (geoCache.size > 500) geoCache.delete(geoCache.keys().next().value); return { results };
});

/* ---- admin ---- */
on('GET', '/api/admin/users', ctx => {
  need(ctx, { admin: true }); const q = ctx.url.searchParams.get('q');
  return { users: Object.values(db.users).filter(u => matchQ(q, u.name, u.email)).sort((a, b) => b.created - a.created).slice(0, 100)
    .map(u => ({ ...meView(u), banned: !!u.banned, posts: Object.values(db.threads).filter(t => t.uid === u.uid).length })) };
});
on('POST', '/api/admin/users/:uid', ctx => {
  const me = need(ctx, { admin: true }), u = db.users[ctx.params.uid]; if (!u) fail(404, 'No such user.');
  const a = ctx.body.action; if (u.uid === me.uid && ['ban', 'mute', 'demote'].includes(a)) fail(400, "You can't do that to your own account.");
  if (a === 'mute') { const min = Math.min(43200, Math.max(1, Math.round(+ctx.body.minutes || 60))); u.mutedUntil = Date.now() + min * 60e3; notify(u.uid, { type: 'mod', text: `An admin muted you until ${new Date(u.mutedUntil).toUTCString()}.`, link: 'profile.html#' + u.uid }); }
  else if (a === 'unmute') { u.mutedUntil = 0; notify(u.uid, { type: 'mod', text: 'You are no longer muted.', link: 'chat.html' }); }
  else if (a === 'ban') { u.banned = true; for (const [t, v] of Object.entries(db.tokens)) if (v.uid === u.uid) delete db.tokens[t]; closeStreams(u.uid); }
  else if (a === 'unban') u.banned = false;
  else if (a === 'promote') u.role = 'admin';
  else if (a === 'demote') u.role = 'user';
  else fail(400, 'Unknown action.');
  save(); return { user: { ...meView(u), banned: !!u.banned } };
});

/* ================= stream, static, server ================= */
function stream(req, res, user) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(`event: hello\ndata: ${JSON.stringify({ unread: unread(user.uid) })}\n\n`);
  const set = streams.get(user.uid) || new Set(); set.add(res); streams.set(user.uid, set);
  req.on('close', () => { set.delete(res); if (!set.size) streams.delete(user.uid); });
}
/* Cache-busting: every page asks for assets/app.js?v=<fingerprint> and assets/style.css?v=<fingerprint>.
   The fingerprint is a hash of the files' contents, so after each deploy browsers fetch the new versions
   instead of mixing a new page with an old cached script. Versioned files can then be cached for a long time. */
const ASSET_V = {};
for (const f of ['app.js', 'style.css']) { try { ASSET_V[f] = crypto.createHash('sha1').update(fs.readFileSync(path.join(PUB, 'assets', f))).digest('hex').slice(0, 10); } catch (e) { ASSET_V[f] = String(Date.now()); } }
const stampHtml = html => html.replace(/(["'])assets\/(app\.js|style\.css)\1/g, (m, q, f) => `${q}assets/${f}?v=${ASSET_V[f]}${q}`);
function serveStatic(req, res, url) {
  let p; try { p = decodeURIComponent(url.pathname); } catch (e) { res.writeHead(400, SEC); return res.end(); }
  if (/[\u0000-\u001f]/.test(p)) { res.writeHead(400, SEC); return res.end('Bad request'); }
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(PUB, p));
  if (!file.startsWith(PUB + path.sep)) { res.writeHead(403, SEC); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain', ...SEC }); return res.end('Not found'); }
    const ext = path.extname(file);
    const versioned = url.searchParams.has('v');
    if (ext === '.html') data = Buffer.from(stampHtml(data.toString('utf8')));
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : versioned ? 'public, max-age=31536000, immutable' : p.startsWith('/vendor/') ? 'public, max-age=604800' : 'no-cache', ...SEC });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
      const user = userFromReq(req, url);
      if (url.pathname === '/api/stream') { if (!user || user.banned) return send(res, 401, { error: 'Sign in first.' }); return stream(req, res, user); }
      for (const r of routes) {
        if (r.method !== req.method) continue; const m = r.re.exec(url.pathname); if (!m) continue;
        const params = {}; try { r.keys.forEach((k, i) => params[k] = decodeURIComponent(m[i + 1])); } catch (e) { fail(400, 'Malformed address.'); }
        const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : {};
        return send(res, 200, await r.fn({ req, url, params, body, user, ip }));
      }
      return send(res, 404, { error: 'Not found.' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, SEC); return res.end(); }
    serveStatic(req, res, url);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.code, { error: e.message });
    console.error(e); send(res, 500, { error: 'Something went wrong on the server.' });
  }
});
initStore().then(() => server.listen(PORT, () => console.log(`Darkmoon Hub on http://localhost:${PORT}  (data: ${pool ? 'Postgres' : DB_FILE})${GOOGLE_CLIENT_ID ? '' : '  (Google sign-in not configured)'}${DEV_LOGIN ? '  [DEV LOGIN ENABLED]' : ''}`)))
  .catch(e => { console.error('Startup failed:', e); process.exit(1); });
