'use strict';
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const express = require('express');
const multer = require('multer');
const { WebSocketServer, WebSocket } = require('ws');
const { createStore } = require('./storage');

// ───────────────────────── Настройки ─────────────────────────

const PORT = Number(process.env.PORT) || 3000;
const SECRET = process.env.SESSION_SECRET || '';
const SESSION_DAYS = Number(process.env.SESSION_DAYS) || 30;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const YT_DIR = path.join(DATA_DIR, 'yt');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

const UPLOADS_ENABLED = (process.env.UPLOADS || 'on') === 'on';
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 4096;

const YTDLP_ENABLED = process.env.YTDLP === 'on';
const YTDLP_BIN = process.env.YTDLP_BIN || 'yt-dlp';
const YTDLP_PROXY = process.env.YTDLP_PROXY || '';
const YTDLP_COOKIES = process.env.YTDLP_COOKIES || '';
const YTDLP_JS_RUNTIME = process.env.YTDLP_JS_RUNTIME || '';
const YTDLP_FORMAT = process.env.YTDLP_FORMAT || 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b';
const YTDLP_FORMAT_OTHER = process.env.YTDLP_FORMAT_OTHER || 'bv*[height<=1080]+ba/b[height<=1080]/b';
// Язык звука, если у ролика несколько дорожек (ru, en, ja…). Пусто — оригинальная дорожка.
const YTDLP_AUDIO_LANG = /^[a-z]{2,3}(-[A-Za-z0-9]{1,8})?$/.test(process.env.YTDLP_AUDIO_LANG || '') ? process.env.YTDLP_AUDIO_LANG : '';
function formatFor(kind) {
  if (!YTDLP_AUDIO_LANG) return kind === 'proxy' ? YTDLP_FORMAT : YTDLP_FORMAT_OTHER;
  const l = YTDLP_AUDIO_LANG;
  return kind === 'proxy'
    ? `bv*[height<=1080][ext=mp4]+ba[ext=m4a][language^=${l}]/bv*[height<=1080]+ba[language^=${l}]/${YTDLP_FORMAT}`
    : `bv*[height<=1080]+ba[language^=${l}]/${YTDLP_FORMAT_OTHER}`;
}
const CACHE_MAX_BYTES = (Number(process.env.CACHE_MAX_GB) || 20) * 1024 ** 3;

if (SECRET.length < 32) {
  console.error('SESSION_SECRET не задан или слишком короткий (нужно 32+ символа). Сгенерируй: npm run secret');
  process.exit(1);
}

function loadUsers() {
  const users = new Map();
  for (let i = 1; i <= 10; i++) {
    const raw = process.env[`USER_${i}`];
    if (!raw) continue;
    const sep = raw.indexOf(':');
    const login = raw.slice(0, sep).trim().toLowerCase();
    const hash = raw.slice(sep + 1).trim();
    if (sep < 1 || !/^[a-z0-9_.-]{1,32}$/.test(login) || !hash.startsWith('scrypt.')) {
      console.error(`USER_${i} записан неправильно. Нужно: логин:scrypt.соль.хэш`);
      process.exit(1);
    }
    users.set(login, {
      login,
      name: (process.env[`USER_${i}_NAME`] || login).slice(0, 24),
      hash,
      // меняется при смене пароля — старые входы сразу перестают работать
      pv: crypto.createHash('sha256').update(hash).digest('hex').slice(0, 12),
    });
  }
  if (users.size === 0) {
    console.error('Не задано ни одного аккаунта (USER_1, USER_2 в .env).');
    process.exit(1);
  }
  return users;
}
const USERS = loadUsers();

for (const dir of [DATA_DIR, UPLOAD_DIR, YT_DIR]) fs.mkdirSync(dir, { recursive: true });

// ───────────────────────── Пароли и сессии ─────────────────────────

function scryptAsync(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

async function checkPassword(user, password) {
  const [, salt, hex] = user.hash.split('.');
  if (!salt || !hex) return false;
  const expected = Buffer.from(hex, 'hex');
  const actual = await scryptAsync(password, salt);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// Хэш-заглушка, чтобы проверка несуществующего логина занимала столько же времени
const DUMMY_USER = { hash: 'scrypt.' + '0'.repeat(32) + '.' + '0'.repeat(128) };

const COOKIE = 'kz_session';

function sign(data) {
  return crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
}

function makeToken(user) {
  const payload = Buffer.from(JSON.stringify({
    u: user.login,
    pv: user.pv,
    exp: Date.now() + SESSION_DAYS * 864e5,
  })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function readToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const user = USERS.get(data.u);
    if (!user || user.pv !== data.pv || Date.now() > data.exp) return null;
    return user;
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function userFromReq(req) {
  return readToken(parseCookies(req.headers.cookie)[COOKIE]);
}

// ───────────────────────── Защита от подбора пароля ─────────────────────────

const LOCK_MS = 15 * 60 * 1000;
const failsByIp = new Map(); // ip -> { count, until }
let globalFails = [];        // время неудачных попыток со всех адресов
let globalLockUntil = 0;

function loginBlocked(ip) {
  const now = Date.now();
  if (globalLockUntil > now) return true;
  const rec = failsByIp.get(ip);
  return !!(rec && rec.until > now);
}

function registerFail(ip) {
  const now = Date.now();
  const rec = failsByIp.get(ip) || { count: 0, until: 0 };
  rec.count += 1;
  if (rec.count >= 5) {
    rec.until = now + LOCK_MS;
    rec.count = 0;
  }
  failsByIp.set(ip, rec);
  globalFails = globalFails.filter((t) => now - t < LOCK_MS);
  globalFails.push(now);
  if (globalFails.length >= 30) {
    globalLockUntil = now + LOCK_MS;
    console.warn('Слишком много неудачных входов — вход временно закрыт для всех на 15 минут.');
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of failsByIp) if (rec.until < now && rec.count === 0) failsByIp.delete(ip);
}, LOCK_MS).unref();

// ───────────────────────── HTTP ─────────────────────────

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' https://www.youtube.com https://s.ytimg.com",
    "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
    "img-src 'self' data: https://i.ytimg.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    // прямые ссылки на видео грузятся браузером с чужих сайтов
    "media-src 'self' blob: https: http:",
    "connect-src 'self' ws: wss: https:",
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; '));
  next();
});

const PUBLIC_DIR = path.join(__dirname, 'public');

app.get('/robots.txt', (req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /\n'));
// браузеры сами ищут /favicon.ico — отдаём наш значок без входа
app.get('/favicon.ico', (req, res) => res.redirect(301, '/assets/favicon-32.png'));
app.use('/assets', express.static(path.join(PUBLIC_DIR, 'assets'), { maxAge: '1h' }));

app.get('/login', (req, res) => {
  if (userFromReq(req)) return res.redirect('/');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

app.post('/login', express.urlencoded({ extended: false, limit: '4kb' }), async (req, res) => {
  const ip = req.ip || 'unknown';
  if (loginBlocked(ip)) return res.redirect(303, '/login?e=locked');

  const login = String(req.body.login || '').trim().toLowerCase().slice(0, 64);
  const password = String(req.body.password || '').slice(0, 256);
  const user = USERS.get(login);
  const ok = await checkPassword(user || DUMMY_USER, password).catch(() => false);

  if (!user || !ok) {
    registerFail(ip);
    await new Promise((r) => setTimeout(r, 600 + Math.random() * 400));
    return res.redirect(303, '/login?e=1');
  }

  failsByIp.delete(ip);
  res.cookie(COOKIE, makeToken(user), {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    maxAge: SESSION_DAYS * 864e5,
    path: '/',
  });
  res.redirect(303, '/');
});

app.post('/logout', (req, res) => {
  res.clearCookie(COOKIE, { path: '/' });
  res.redirect(303, '/login');
});

// Всё, что ниже, — только после входа
app.use((req, res, next) => {
  const user = userFromReq(req);
  if (!user) {
    if (req.method === 'GET' && req.accepts('html') && !req.path.startsWith('/api') && !req.path.startsWith('/media')) {
      return res.redirect('/login');
    }
    return res.status(401).json({ error: 'unauthorized' });
  }
  req.user = user;
  next();
});

app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(PUBLIC_DIR, 'app.html'));
});
app.use('/app', express.static(path.join(PUBLIC_DIR, 'app'), { maxAge: 0 }));

app.get('/api/me', (req, res) => {
  res.json({
    me: req.user.login,
    users: [...USERS.values()].map((u) => ({ login: u.login, name: u.name })),
    features: { ytdlp: YTDLP_ENABLED, uploads: UPLOADS_ENABLED, maxUploadMb: MAX_UPLOAD_MB },
  });
});

// ── Загрузка файлов ──

const VIDEO_EXT = new Set(['.mp4', '.webm', '.mkv', '.m4v', '.mov', '.ogv']);

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      cb(null, crypto.randomBytes(12).toString('hex') + ext);
    },
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    cb(null, VIDEO_EXT.has(path.extname(file.originalname || '').toLowerCase()));
  },
});

app.post('/api/upload', (req, res) => {
  if (!UPLOADS_ENABLED) return res.status(403).json({ error: 'Загрузка файлов выключена на сервере' });
  upload.single('file')(req, res, async (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? `Файл больше ${MAX_UPLOAD_MB} МБ` : 'Не получилось загрузить файл';
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'Нужен видеофайл: mp4, webm, mkv, mov' });
    const name = Buffer.from(req.file.originalname, 'latin1').toString('utf8').slice(0, 200);
    res.json({ file: req.file.filename, name, size: req.file.size });
    cleanupMedia().catch(() => {});
  });
});

// ── Отдача видео (с поддержкой перемотки) ──

const MEDIA_RE = /^[A-Za-z0-9_-]{11,24}\.(mp4|webm|mkv|m4v|mov|ogv)$/;

function sendMedia(dir) {
  return (req, res) => {
    const name = req.params.file;
    if (!MEDIA_RE.test(name)) return res.status(404).end();
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(path.join(dir, name), { dotfiles: 'deny' }, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  };
}
app.get('/media/upload/:file', sendMedia(UPLOAD_DIR));
app.get('/media/yt/:file', sendMedia(YT_DIR));

app.use((req, res) => res.status(404).json({ error: 'not found' }));

// ───────────────────────── Комната ─────────────────────────

const REACTIONS = ['heart', 'fire', 'laugh', 'star', 'cry'];
const emptyReactions = () => Object.fromEntries(REACTIONS.map((k) => [k, 0]));

const room = {
  source: null,        // { sid, kind, ref, title, name?, size?, by }
  playing: false,
  position: 0,         // секунда видео на момент updatedAt
  updatedAt: Date.now(),
  queue: [],
  messages: [],
  reactions: emptyReactions(),
  lastAction: null,    // { by, action, position, at }
  preparing: null,     // { key, source, label, title, percent, stage, error, by }
  settings: { waitForBuffer: true },
  waiting: null,       // { since } — пауза «подожди меня»
  session: null,       // текущий просмотр для дневника
};

// Дневник, хотелки и общая статистика
let diary = [];      // [{ id, kind, ref, title, startedAt, endedAt, together, reactions, notes: { login: текст }, by }]
let wishlist = [];   // [{ id, source, note, by, at }]
let stats = { together: 0, videos: 0, reactions: emptyReactions(), firstAt: null };

const DIARY_MAX = 2000;
const WISH_MAX = 300;
const DIARY_SEND = 300; // сколько последних записей отдавать при входе

const store = createStore({ databaseUrl: process.env.DATABASE_URL || '', dataDir: DATA_DIR });

function roomForSave() {
  return {
    source: room.source,
    position: currentPosition(),
    queue: room.queue,
    messages: room.messages,
    reactions: room.reactions,
    settings: room.settings,
    session: room.session,
  };
}

async function loadAll() {
  await store.init();
  let saved = await store.get('room');
  if (!saved && store.kind === 'файлы') {
    // старый файл состояния из прошлых версий
    try { saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { /* нет */ }
  }
  if (saved) {
    Object.assign(room, {
      source: saved.source || null,
      position: Number(saved.position) || 0,
      queue: Array.isArray(saved.queue) ? saved.queue : [],
      messages: Array.isArray(saved.messages) ? saved.messages.slice(-200) : [],
      reactions: { ...emptyReactions(), ...(saved.reactions || {}) },
      settings: { waitForBuffer: true, ...(saved.settings || {}) },
      session: saved.session || null,
    });
  }
  const d = await store.get('diary');
  if (Array.isArray(d)) diary = d;
  const w = await store.get('wishlist');
  if (Array.isArray(w)) wishlist = w;
  const st = await store.get('stats');
  if (st && typeof st === 'object') stats = { ...stats, ...st, reactions: { ...emptyReactions(), ...(st.reactions || {}) } };
}

// Сохранение с задержкой: частые изменения копятся и пишутся одним разом
const saveTimers = new Map(); // key -> { at, t }
const SAVERS = { room: roomForSave, diary: () => diary, wishlist: () => wishlist, stats: () => stats };

function saveSoon(key = 'room', delay = 1500) {
  const at = Date.now() + delay;
  const cur = saveTimers.get(key);
  if (cur && cur.at <= at) return;
  if (cur) clearTimeout(cur.t);
  const t = setTimeout(() => {
    saveTimers.delete(key);
    store.set(key, SAVERS[key]()).catch((e) => {
      console.error(`Не сохранилось (${key}):`, e.message);
      saveSoon(key, 15000); // попробуем позже
    });
  }, delay);
  saveTimers.set(key, { at, t });
}

async function flushAll() {
  for (const { t } of saveTimers.values()) clearTimeout(t);
  saveTimers.clear();
  await Promise.all(Object.entries(SAVERS).map(([k, fn]) => store.set(k, fn()).catch(() => {})));
}

function currentPosition() {
  return room.playing ? room.position + (Date.now() - room.updatedAt) / 1000 : room.position;
}

function snapshot() {
  return {
    source: room.source,
    playing: room.playing,
    position: room.position,
    updatedAt: room.updatedAt,
    queue: room.queue,
    reactions: room.reactions,
    lastAction: room.lastAction,
    preparing: room.preparing,
    settings: room.settings,
    waiting: room.waiting ? { since: room.waiting.since, users: [...bufferingUsers] } : null,
    serverNow: Date.now(),
  };
}

function send(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
function broadcast(msg, except) {
  const data = JSON.stringify(msg);
  for (const ws of wss.clients) if (ws !== except && ws.readyState === WebSocket.OPEN) ws.send(data);
}
function broadcastState() {
  broadcast({ type: 'state', state: snapshot() });
  saveSoon();
}
function onlineLogins() {
  const online = new Set();
  for (const ws of wss.clients) if (ws.user) online.add(ws.user.login);
  return online;
}
function broadcastPresence() {
  const online = onlineLogins();
  broadcast({ type: 'presence', online: [...online] });
  // все ушли — закрываем запись в дневнике (если вернутся к тому же видео, она продолжится)
  if (online.size === 0) finalizeSession();
}

const newId = () => crypto.randomBytes(8).toString('hex');
const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const cleanText = (s, max) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

// Ссылка http(s), не длиннее 2048 символов
function parseHttpUrl(raw) {
  const s = String(raw || '').trim();
  if (!s || s.length > 2048) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    return u;
  } catch {
    return null;
  }
}

// Сервер не должен качать с адресов внутри своей сети
function isPublicHost(hostname) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return false;
  if (/^\d+$/.test(h)) return false; // адрес одним числом
  const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }
  if (h.includes(':')) {
    if (h === '::1' || h === '::' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith('::ffff:')) return false;
  }
  return true;
}

const siteKey = (url) => 's' + crypto.createHash('sha1').update(url).digest('hex').slice(0, 15);

// Проверка и нормализация источника видео от клиента
function validateSource(src) {
  if (!src || typeof src !== 'object') return null;
  const title = cleanText(src.title, 200) || null;
  switch (src.kind) {
    case 'youtube':
      if (!YT_ID_RE.test(src.ref)) return null;
      return { kind: 'youtube', ref: src.ref, title };
    case 'proxy':
      if (!YTDLP_ENABLED || !YT_ID_RE.test(src.ref)) return null;
      return { kind: 'proxy', ref: src.ref, title, file: null };
    case 'upload':
      if (!UPLOADS_ENABLED || !MEDIA_RE.test(src.ref) || !fs.existsSync(path.join(UPLOAD_DIR, src.ref))) return null;
      return { kind: 'upload', ref: src.ref, title: title || cleanText(src.name, 200) };
    case 'local': {
      const name = cleanText(src.name, 200);
      const size = Number(src.size);
      if (!name || !Number.isFinite(size) || size <= 0) return null;
      return { kind: 'local', ref: name, name, size, title: name };
    }
    case 'url': {
      // прямая ссылка на видео — браузеры грузят её сами, сервер её не трогает
      const u = parseHttpUrl(src.ref);
      if (!u) return null;
      return { kind: 'url', ref: u.href, title };
    }
    case 'site': {
      // страница любого сайта — видео достаёт сервер через yt-dlp
      if (!YTDLP_ENABLED) return null;
      const u = parseHttpUrl(src.ref);
      if (!u || !isPublicHost(u.hostname)) return null;
      return { kind: 'site', ref: u.href, key: siteKey(u.href), title, file: null };
    }
    default:
      return null;
  }
}

function setSource(src, by) {
  finalizeSession();
  clearWaiting();
  room.source = { ...src, sid: newId(), by };
  room.playing = false;
  room.position = 0;
  room.updatedAt = Date.now();
  room.reactions = emptyReactions();
  room.lastAction = { by, action: 'load', position: 0, at: Date.now() };
}

// ───────────────────────── Дневник просмотров и статистика ─────────────────────────

const DIARY_MIN_SECONDS = 60;          // меньше минуты вместе — в дневник не пишем
const DIARY_MERGE_MS = 6 * 3600 * 1000; // вернулись к тому же видео в течение 6 часов — та же запись

// Каждые 5 секунд: если видео играет и вы оба на сайте — копим совместное время
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(now - lastTick, 15000) / 1000;
  lastTick = now;
  // долго ждали того, у кого грузится, — продолжаем без него
  if (room.waiting && now - room.waiting.since > WAIT_MAX_MS) {
    bufferingUsers.clear();
    if (maybeResume(null)) broadcastState();
  }
  if (!room.source || !room.playing) return;
  ensureSession();
  if (onlineLogins().size >= 2) {
    room.session.together += dt;
    stats.together += dt;
    if (!stats.firstAt) stats.firstAt = now;
    saveSoon('room', 30000);
    saveSoon('stats', 30000);
  }
}, 5000).unref();

const WAIT_MAX_MS = 30000;

// Запись о текущем просмотре (создаётся при первом плее или реакции)
function ensureSession() {
  if (!room.source) return null;
  if (room.session && room.session.sid === room.source.sid) return room.session;
  finalizeSession();
  room.session = {
    sid: room.source.sid, kind: room.source.kind, ref: room.source.ref,
    title: room.source.title || null, file: room.source.file || null, name: room.source.name || null,
    size: room.source.size || null, by: room.source.by,
    startedAt: Date.now(), together: 0, reactions: emptyReactions(),
  };
  return room.session;
}

function diaryRewatchable(e) {
  if (e.kind === 'local') return false;
  if (e.kind === 'upload') return UPLOADS_ENABLED && MEDIA_RE.test(e.ref) && fs.existsSync(path.join(UPLOAD_DIR, e.ref));
  if (e.kind === 'proxy' || e.kind === 'site') return YTDLP_ENABLED;
  return true;
}
const diaryOut = (e) => ({ ...e, together: Math.round(e.together), rewatch: diaryRewatchable(e) });

function finalizeSession() {
  const s = room.session;
  room.session = null;
  if (!s || s.together < DIARY_MIN_SECONDS) return;
  const now = Date.now();
  if (room.source && room.source.sid === s.sid && room.source.title) s.title = room.source.title;

  const last = diary[diary.length - 1];
  let entry;
  if (last && last.kind === s.kind && last.ref === s.ref && s.startedAt - last.endedAt < DIARY_MERGE_MS) {
    entry = last;
    entry.together += s.together;
    entry.endedAt = now;
    for (const k of REACTIONS) entry.reactions[k] = (entry.reactions[k] || 0) + (s.reactions[k] || 0);
    if (!entry.title && s.title) entry.title = s.title;
  } else {
    entry = {
      id: newId(), kind: s.kind, ref: s.ref, title: s.title, name: s.name, size: s.size,
      startedAt: s.startedAt, endedAt: now, together: s.together,
      reactions: { ...s.reactions }, notes: {}, by: s.by,
    };
    diary.push(entry);
    if (diary.length > DIARY_MAX) diary.splice(0, diary.length - DIARY_MAX);
    stats.videos += 1;
  }
  broadcast({ type: 'diary_upsert', entry: diaryOut(entry), stats: statsOut() });
  saveSoon('diary');
  saveSoon('stats');
}

function statsOut() {
  // «самое смешное» и «самое любимое» — по записям дневника
  let funniest = null;
  let loved = null;
  for (const e of diary) {
    if ((e.reactions.laugh || 0) > 0 && (!funniest || e.reactions.laugh > funniest.reactions.laugh)) funniest = e;
    if ((e.reactions.heart || 0) > 0 && (!loved || e.reactions.heart > loved.reactions.heart)) loved = e;
  }
  const pick = (e, k) => (e ? { id: e.id, title: e.title, kind: e.kind, ref: e.ref, count: e.reactions[k] } : null);
  return {
    together: Math.round(stats.together),
    videos: stats.videos,
    reactions: stats.reactions,
    firstAt: stats.firstAt,
    funniest: pick(funniest, 'laugh'),
    loved: pick(loved, 'heart'),
  };
}

// ───────────────────────── Хотелки и названия роликов ─────────────────────────

// Название ролика YouTube — через открытый oEmbed (сервер стоит за границей, ему YouTube доступен)
async function fetchYoutubeTitle(id) {
  if (!YT_ID_RE.test(id)) return null;
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return cleanText(j.title, 200) || null;
  } catch {
    return null;
  }
}

// Подставить название, если его нет, и сообщить об этом всем
async function fillTitle(src, onDone) {
  if (src.title || (src.kind !== 'youtube' && src.kind !== 'proxy')) return;
  const t = await fetchYoutubeTitle(src.ref);
  if (!t) return;
  src.title = t;
  onDone();
}

function broadcastWishlist() {
  broadcast({ type: 'wishlist', items: wishlist });
  saveSoon('wishlist');
}

// ───────────────────────── «Подожди меня» ─────────────────────────
// Если у кого-то видео грузится, ставим паузу обоим и продолжаем, когда догрузится.

const bufferingUsers = new Set();

function clearWaiting() {
  bufferingUsers.clear();
  room.waiting = null;
}

function startWaiting(by) {
  if (!room.playing) return;
  room.position = currentPosition();
  room.playing = false;
  room.updatedAt = Date.now();
  room.waiting = { since: Date.now() };
  room.lastAction = { by, action: 'wait', position: room.position, at: Date.now() };
}

function maybeResume(by) {
  if (!room.waiting || bufferingUsers.size > 0) return false;
  room.waiting = null;
  room.playing = true;
  room.updatedAt = Date.now();
  room.lastAction = { by, action: 'resume', position: room.position, at: Date.now() };
  return true;
}

// Включить источник: для режима «через сервер» сначала скачать
function loadSource(src, by) {
  if (src.kind === 'proxy' || src.kind === 'site') {
    const key = dlKey(src);
    const file = findYtFile(key);
    if (file) {
      touch(path.join(YT_DIR, file));
      setSource({ ...src, file, title: src.title || ytTitles.get(key) || null }, by);
      broadcastState();
    } else {
      prepareDownload(src, by);
    }
    return;
  }
  // включили другое видео — скачивание для «через сервер» больше не нужно
  if (ytJob) { const j = ytJob; ytJob = null; j.child.kill('SIGTERM'); }
  room.preparing = null;
  setSource(src, by);
  broadcastState();
}

function playNextFromQueue(by) {
  const next = room.queue.shift();
  if (!next) return false;
  loadSource(next.source, by);
  return true;
}

// ───────────────────────── YouTube через сервер (yt-dlp) ─────────────────────────

let ytJob = null;            // { key, child } — текущее скачивание
const ytTitles = new Map();  // ключ -> название

function findYtFile(key) {
  try {
    return fs.readdirSync(YT_DIR).find((f) => f.startsWith(key + '.') && MEDIA_RE.test(f)) || null;
  } catch {
    return null;
  }
}

function touch(file) {
  const now = new Date();
  fs.utimes(file, now, now, () => {});
}

// Ключ файла в кэше: id ролика YouTube или хэш ссылки другого сайта
const dlKey = (src) => (src.kind === 'proxy' ? src.ref : src.key);
const dlUrl = (src) => (src.kind === 'proxy' ? `https://www.youtube.com/watch?v=${src.ref}` : src.ref);
const dlLabel = (src) => {
  if (src.kind === 'proxy') return `YouTube · ${src.ref}`;
  try { return new URL(src.ref).hostname.replace(/^www\./, ''); } catch { return 'Видео'; }
};

function prepareDownload(src, by) {
  const key = dlKey(src);
  if (ytJob && ytJob.key === key) return;
  if (ytJob) { const j = ytJob; ytJob = null; j.child.kill('SIGTERM'); }

  room.preparing = { key, source: src, label: dlLabel(src), title: src.title || null, percent: 0, stage: 'start', error: null, by };
  broadcastState();

  const args = [
    '--no-playlist', '--newline', '--no-mtime',
    '-f', formatFor(src.kind),
    '--merge-output-format', 'mp4',
    '-o', path.join(YT_DIR, `${key}.%(ext)s`),
    '--print', 'before_dl:KZTITLE %(title)s',
    '--progress', '--no-simulate',
    '--progress-template', 'download:KZPROG %(progress._percent_str)s',
  ];
  if (YTDLP_PROXY) args.push('--proxy', YTDLP_PROXY);
  if (YTDLP_COOKIES && src.kind === 'proxy') args.push('--cookies', YTDLP_COOKIES);
  if (YTDLP_JS_RUNTIME) args.push('--js-runtimes', YTDLP_JS_RUNTIME);
  args.push('--', dlUrl(src));

  let child;
  try {
    child = spawn(YTDLP_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    return failDownload(src, 'yt-dlp не запустился: ' + e.message);
  }
  const job = { key, child, phase: 0, last: 0, errors: [] };
  ytJob = job;

  const killTimer = setTimeout(() => child.kill('SIGTERM'), 90 * 60 * 1000);
  let lastSent = 0;
  const mine = () => room.preparing && room.preparing.key === key;

  const onLine = (line) => {
    line = line.replace(/\x1b\[[0-9;]*m/g, '').trim();
    if (!line) return;
    if (line.startsWith('KZTITLE ')) {
      const t = cleanText(line.slice(8), 200);
      if (t && t !== 'NA') ytTitles.set(key, t);
      if (mine() && t && t !== 'NA') {
        room.preparing.title = t;
        broadcastState();
      }
      return;
    }
    const m = line.match(/KZPROG\s+([\d.]+)%/);
    if (m) {
      const p = parseFloat(m[1]);
      if (job.last > 90 && p < 10) job.phase += 1; // видео скачалось, пошёл звук
      job.last = p;
      const overall = job.phase === 0 ? p * 0.9 : 90 + p * 0.09;
      if (mine() && Date.now() - lastSent > 700) {
        lastSent = Date.now();
        room.preparing.percent = Math.min(99, Math.round(overall));
        room.preparing.stage = 'download';
        broadcast({ type: 'state', state: snapshot() });
      }
      return;
    }
    if ((line.includes('[Merger]') || line.includes('[FixupM3u8]')) && mine()) {
      room.preparing.percent = 99;
      room.preparing.stage = 'merge';
      broadcast({ type: 'state', state: snapshot() });
    }
    if (/^ERROR:/i.test(line)) job.errors.push(line.replace(/^ERROR:\s*/i, ''));
  };

  const lineReader = (stream) => {
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk.toString();
      let i;
      while ((i = buf.search(/[\r\n]/)) >= 0) {
        onLine(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    });
  };
  lineReader(child.stdout);
  lineReader(child.stderr);

  child.on('error', (e) => {
    clearTimeout(killTimer);
    if (ytJob !== job) return;
    ytJob = null;
    failDownload(src, e.code === 'ENOENT' ? 'yt-dlp не найден на сервере' : e.message);
  });

  child.on('close', (code, signal) => {
    clearTimeout(killTimer);
    if (ytJob !== job) return; // задачу отменили или заменили другой
    ytJob = null;
    const file = findYtFile(key);
    if (code === 0 && file) {
      const t = ytTitles.get(key) || src.title || null;
      const by2 = room.preparing ? room.preparing.by : by;
      room.preparing = null;
      setSource({ ...src, title: t, file }, by2);
      broadcastState();
      cleanupMedia().catch(() => {});
    } else {
      const err = job.errors.pop() || (signal ? 'Скачивание прервано' : `yt-dlp завершился с кодом ${code}`);
      failDownload(src, err);
    }
  });
}

function failDownload(src, error) {
  const key = dlKey(src);
  console.warn(`yt-dlp (${key}):`, error);
  let hint = '';
  if (/sign in|not a bot|confirm you/i.test(error)) hint = 'YouTube просит подтвердить, что это не бот. Поможет прокси (YTDLP_PROXY) или cookies (YTDLP_COOKIES).';
  else if (/unsupported url/i.test(error)) hint = 'yt-dlp не умеет доставать видео с этого сайта. Попробуй найти прямую ссылку на видео.';
  else if (/drm/i.test(error)) hint = 'Видео защищено (DRM) — его нельзя скачать.';
  else if (/private|unavailable|removed|404/i.test(error)) hint = 'Видео недоступно: удалено, приватное или ссылка неверная.';
  else if (/geo|country|region/i.test(error)) hint = 'Видео недоступно в стране, где стоит сервер. Поможет прокси из нужной страны.';
  room.preparing = {
    key, source: src, label: dlLabel(src), title: ytTitles.get(key) || src.title || null,
    percent: 0, stage: 'error', error: cleanText(error, 300), hint, by: null,
  };
  broadcastState();
}

async function cleanupMedia() {
  const keep = new Set();
  const addKeep = (s) => { if (s && s.kind === 'upload') keep.add(s.ref); if (s && s.file) keep.add(s.file); };
  addKeep(room.source);
  for (const q of room.queue) addKeep(q.source);
  for (const w of wishlist) addKeep(w.source);

  const files = [];
  for (const dir of [YT_DIR, UPLOAD_DIR]) {
    for (const name of await fsp.readdir(dir)) {
      const full = path.join(dir, name);
      const st = await fsp.stat(full).catch(() => null);
      if (!st || !st.isFile()) continue;
      if (name.endsWith('.part') || name.endsWith('.ytdl')) {
        if (Date.now() - st.mtimeMs > 6 * 3600e3) await fsp.unlink(full).catch(() => {});
        continue;
      }
      files.push({ full, name, size: st.size, mtime: st.mtimeMs });
    }
  }
  let total = files.reduce((s, f) => s + f.size, 0);
  files.sort((a, b) => a.mtime - b.mtime);
  for (const f of files) {
    if (total <= CACHE_MAX_BYTES) break;
    if (keep.has(f.name)) continue;
    await fsp.unlink(f.full).catch(() => {});
    total -= f.size;
  }
}

// ───────────────────────── WebSocket ─────────────────────────

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const reject = (code, text) => {
    socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };
  let pathname;
  try { pathname = new URL(req.url, 'http://x').pathname; } catch { return reject(400, 'Bad Request'); }
  if (pathname !== '/ws') return reject(404, 'Not Found');

  // Защита от подключения со сторонних сайтов
  const origin = req.headers.origin;
  if (origin) {
    let originHost;
    try { originHost = new URL(origin).host; } catch { return reject(403, 'Forbidden'); }
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    if (originHost !== host) return reject(403, 'Forbidden');
  }

  const user = userFromReq(req);
  if (!user) return reject(401, 'Unauthorized');

  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.user = user;
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.reactTimes = [];
  ws.on('pong', () => { ws.isAlive = true; });

  send(ws, {
    type: 'init', me: ws.user.login, state: snapshot(), messages: room.messages,
    diary: diary.slice(-DIARY_SEND).map(diaryOut), diaryTotal: diary.length,
    wishlist, stats: statsOut(),
  });
  broadcastPresence();

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;
    try {
      handleMessage(ws, msg);
    } catch (e) {
      console.error('Ошибка обработки сообщения:', e);
    }
  });

  ws.on('close', () => {
    // ушёл тот, кого ждали, — продолжаем без него (если других его вкладок нет)
    const login = ws.user.login;
    const stillHere = [...wss.clients].some((c) => c !== ws && c.user && c.user.login === login);
    if (!stillHere && bufferingUsers.delete(login) && maybeResume(login)) broadcastState();
    broadcastPresence();
  });
});

// Проверка «живых» соединений
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 25000).unref();

function handleMessage(ws, msg) {
  const by = ws.user.login;
  switch (msg.type) {
    case 'ping':
      send(ws, { type: 'pong', t: msg.t, s: Date.now() });
      break;

    case 'control': {
      if (!room.source) return;
      if (msg.sid && msg.sid !== room.source.sid) return;
      const pos = Number(msg.position);
      if (!Number.isFinite(pos) || pos < 0 || pos > 60 * 60 * 24) return;
      if (msg.action === 'play') { room.playing = true; ensureSession(); } else if (msg.action === 'pause') room.playing = false;
      else if (msg.action !== 'seek') return;
      // нажали плей или паузу сами — ждать больше не нужно
      if (msg.action !== 'seek' && room.waiting) clearWaiting();
      room.position = pos;
      room.updatedAt = Date.now();
      room.lastAction = { by, action: msg.action, position: pos, at: Date.now() };
      broadcastState();
      break;
    }

    case 'buffering': {
      if (!room.source || msg.sid !== room.source.sid) return;
      if (msg.on) {
        if (!room.settings.waitForBuffer) return;
        if (!room.playing && !room.waiting) return; // и так на паузе
        bufferingUsers.add(by);
        if (room.playing) startWaiting(by);
        broadcastState();
      } else if (bufferingUsers.delete(by)) {
        maybeResume(by);
        broadcastState();
      }
      break;
    }

    case 'settings': {
      if (typeof msg.waitForBuffer === 'boolean') {
        room.settings.waitForBuffer = msg.waitForBuffer;
        if (!msg.waitForBuffer && room.waiting) { bufferingUsers.clear(); maybeResume(by); }
        room.lastAction = { by, action: msg.waitForBuffer ? 'wait_on' : 'wait_off', position: currentPosition(), at: Date.now() };
      }
      broadcastState();
      break;
    }

    case 'load': {
      const src = validateSource(msg.source);
      if (!src) return;
      loadSource(src, by);
      fillTitle(src, () => {
        if (room.source && room.source.ref === src.ref && !room.source.title) { room.source.title = src.title; broadcastState(); }
      });
      break;
    }

    case 'retry': {
      if (room.preparing && room.preparing.stage === 'error') prepareDownload(room.preparing.source, by);
      break;
    }

    case 'cancel_prepare': {
      if (ytJob) { const j = ytJob; ytJob = null; j.child.kill('SIGTERM'); }
      room.preparing = null;
      broadcastState();
      break;
    }

    case 'queue_add': {
      if (room.queue.length >= 100) return;
      const src = validateSource(msg.source);
      if (!src || src.kind === 'local') return;
      room.queue.push({ id: newId(), source: src, by, at: Date.now() });
      broadcastState();
      fillTitle(src, broadcastState);
      break;
    }

    case 'queue_remove': {
      room.queue = room.queue.filter((q) => q.id !== msg.id);
      broadcastState();
      break;
    }

    case 'queue_play': {
      const i = room.queue.findIndex((q) => q.id === msg.id);
      if (i < 0) return;
      const [item] = room.queue.splice(i, 1);
      loadSource(item.source, by);
      broadcastState();
      break;
    }

    case 'queue_move': {
      const i = room.queue.findIndex((q) => q.id === msg.id);
      const j = i + (msg.dir === 'up' ? -1 : 1);
      if (i < 0 || j < 0 || j >= room.queue.length) return;
      [room.queue[i], room.queue[j]] = [room.queue[j], room.queue[i]];
      broadcastState();
      break;
    }

    // ── хотелки ──
    case 'wish_add': {
      if (wishlist.length >= WISH_MAX) return;
      const src = validateSource(msg.source);
      if (!src || src.kind === 'local') return;
      const item = { id: newId(), source: src, note: cleanText(msg.note, 300), by, at: Date.now() };
      wishlist.unshift(item);
      broadcastWishlist();
      fillTitle(src, broadcastWishlist);
      break;
    }

    case 'wish_remove': {
      wishlist = wishlist.filter((w) => w.id !== msg.id);
      broadcastWishlist();
      break;
    }

    case 'wish_queue':
    case 'wish_play': {
      const i = wishlist.findIndex((w) => w.id === msg.id);
      if (i < 0) return;
      const item = wishlist[i];
      const src = validateSource(item.source);
      if (!src) return;
      if (src.title == null && item.source.title) src.title = item.source.title;
      wishlist.splice(i, 1);
      if (msg.type === 'wish_play') {
        loadSource(src, by);
      } else {
        if (room.queue.length >= 100) return;
        room.queue.push({ id: newId(), source: src, by, at: Date.now() });
        broadcastState();
      }
      broadcastWishlist();
      break;
    }

    // ── дневник ──
    case 'diary_note': {
      const e = diary.find((x) => x.id === msg.id);
      if (!e) return;
      const text = cleanText(msg.text, 500);
      if (text) e.notes[by] = text; else delete e.notes[by];
      broadcast({ type: 'diary_upsert', entry: diaryOut(e), stats: statsOut() });
      saveSoon('diary');
      break;
    }

    case 'diary_delete': {
      const before = diary.length;
      diary = diary.filter((x) => x.id !== msg.id);
      if (diary.length === before) return;
      broadcast({ type: 'diary_remove', id: msg.id, stats: statsOut() });
      saveSoon('diary');
      break;
    }

    case 'diary_rewatch': {
      const e = diary.find((x) => x.id === msg.id);
      if (!e || !diaryRewatchable(e)) return;
      const src = validateSource({ kind: e.kind, ref: e.ref, title: e.title });
      if (src) loadSource(src, by);
      break;
    }

    case 'diary_more': {
      // показать записи постарше
      const i = diary.findIndex((x) => x.id === msg.before);
      if (i <= 0) return;
      send(ws, { type: 'diary_older', entries: diary.slice(Math.max(0, i - DIARY_SEND), i).map(diaryOut), hasMore: i - DIARY_SEND > 0 });
      break;
    }

    case 'ended': {
      // оба клиента пришлют «закончилось» — переключаем один раз
      if (!room.source || msg.sid !== room.source.sid) return;
      room.playing = false;
      room.position = Number(msg.position) || room.position;
      room.updatedAt = Date.now();
      clearWaiting();
      finalizeSession();
      if (!playNextFromQueue(by)) broadcastState();
      break;
    }

    case 'meta': {
      if (!room.source || msg.sid !== room.source.sid || room.source.title) return;
      const t = cleanText(msg.title, 200);
      if (!t) return;
      room.source.title = t;
      if (room.session && room.session.sid === room.source.sid) room.session.title = t;
      broadcastState();
      break;
    }

    case 'chat': {
      const text = cleanText(msg.text, 1000);
      if (!text) return;
      const m = { id: newId(), by, text, at: Date.now() };
      room.messages.push(m);
      if (room.messages.length > 200) room.messages.splice(0, room.messages.length - 200);
      broadcast({ type: 'chat', message: m });
      saveSoon();
      break;
    }

    case 'typing':
      broadcast({ type: 'typing', by }, ws);
      break;

    case 'react': {
      if (!REACTIONS.includes(msg.kind)) return;
      const now = Date.now();
      ws.reactTimes = ws.reactTimes.filter((t) => now - t < 2000);
      if (ws.reactTimes.length >= 8) return;
      ws.reactTimes.push(now);
      room.reactions[msg.kind] += 1;
      stats.reactions[msg.kind] = (stats.reactions[msg.kind] || 0) + 1;
      if (room.source) ensureSession().reactions[msg.kind] += 1;
      broadcast({ type: 'reaction', by, kind: msg.kind, position: currentPosition(), counts: room.reactions });
      saveSoon();
      saveSoon('stats', 10000);
      break;
    }

    case 'clear_chat': {
      room.messages = [];
      broadcast({ type: 'chat_cleared', by });
      saveSoon();
      break;
    }
  }
}

// ───────────────────────── Запуск ─────────────────────────

loadAll()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Кинозал запущен: http://localhost:${PORT}`);
      console.log(`Аккаунты: ${[...USERS.values()].map((u) => `${u.login} (${u.name})`).join(', ')}`);
      console.log(`Хранилище: ${store.kind}${store.kind === 'файлы' ? ` (${DATA_DIR})` : ''}`);
      console.log(`Дневник: ${diary.length} записей, хотелок: ${wishlist.length}`);
      console.log(`YouTube через сервер: ${YTDLP_ENABLED ? 'включён' : 'выключен'}${YTDLP_PROXY ? ', с прокси' : ''}`);
      console.log(`Загрузка файлов: ${UPLOADS_ENABLED ? `включена, до ${MAX_UPLOAD_MB} МБ` : 'выключена'}`);
      cleanupMedia().catch(() => {});
    });
  })
  .catch((e) => {
    console.error('Не удалось открыть хранилище:', e.message);
    if (process.env.DATABASE_URL) console.error('Проверь DATABASE_URL — строку подключения к базе (Neon → Connection string).');
    process.exit(1);
  });

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (ytJob) ytJob.child.kill('SIGTERM');
  finalizeSession();
  const timeout = new Promise((r) => setTimeout(r, 5000));
  await Promise.race([flushAll(), timeout]);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
