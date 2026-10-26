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
};

try {
  const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  Object.assign(room, {
    source: saved.source || null,
    position: Number(saved.position) || 0,
    queue: Array.isArray(saved.queue) ? saved.queue : [],
    messages: Array.isArray(saved.messages) ? saved.messages.slice(-200) : [],
    reactions: { ...emptyReactions(), ...(saved.reactions || {}) },
  });
} catch { /* первый запуск */ }

let saveTimer = null;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const data = {
      source: room.source,
      position: currentPosition(),
      queue: room.queue,
      messages: room.messages,
      reactions: room.reactions,
    };
    fsp.writeFile(STATE_FILE + '.tmp', JSON.stringify(data))
      .then(() => fsp.rename(STATE_FILE + '.tmp', STATE_FILE))
      .catch((e) => console.error('Не сохранилось состояние:', e.message));
  }, 1500);
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
function broadcastPresence() {
  const online = new Set();
  for (const ws of wss.clients) if (ws.user) online.add(ws.user.login);
  broadcast({ type: 'presence', online: [...online] });
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
  room.source = { ...src, sid: newId(), by };
  room.playing = false;
  room.position = 0;
  room.updatedAt = Date.now();
  room.reactions = emptyReactions();
  room.lastAction = { by, action: 'load', position: 0, at: Date.now() };
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

  send(ws, { type: 'init', me: ws.user.login, state: snapshot(), messages: room.messages });
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

  ws.on('close', () => broadcastPresence());
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
      if (msg.action === 'play') room.playing = true;
      else if (msg.action === 'pause') room.playing = false;
      else if (msg.action !== 'seek') return;
      room.position = pos;
      room.updatedAt = Date.now();
      room.lastAction = { by, action: msg.action, position: pos, at: Date.now() };
      broadcastState();
      break;
    }

    case 'load': {
      const src = validateSource(msg.source);
      if (src) loadSource(src, by);
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

    case 'ended': {
      // оба клиента пришлют «закончилось» — переключаем один раз
      if (!room.source || msg.sid !== room.source.sid) return;
      room.playing = false;
      room.position = Number(msg.position) || room.position;
      room.updatedAt = Date.now();
      if (!playNextFromQueue(by)) broadcastState();
      break;
    }

    case 'meta': {
      if (!room.source || msg.sid !== room.source.sid || room.source.title) return;
      const t = cleanText(msg.title, 200);
      if (!t) return;
      room.source.title = t;
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
      broadcast({ type: 'reaction', by, kind: msg.kind, position: currentPosition(), counts: room.reactions });
      saveSoon();
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

server.listen(PORT, () => {
  console.log(`Кинозал запущен: http://localhost:${PORT}`);
  console.log(`Аккаунты: ${[...USERS.values()].map((u) => `${u.login} (${u.name})`).join(', ')}`);
  console.log(`YouTube через сервер: ${YTDLP_ENABLED ? 'включён' : 'выключен'}${YTDLP_PROXY ? ', с прокси' : ''}`);
  console.log(`Загрузка файлов: ${UPLOADS_ENABLED ? `включена, до ${MAX_UPLOAD_MB} МБ` : 'выключена'}`);
  cleanupMedia().catch(() => {});
});

function shutdown() {
  clearTimeout(saveTimer);
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({
      source: room.source, position: currentPosition(), queue: room.queue, messages: room.messages, reactions: room.reactions,
    }));
  } catch { /* ignore */ }
  if (ytJob) ytJob.child.kill('SIGTERM');
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
