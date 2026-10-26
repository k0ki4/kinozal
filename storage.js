'use strict';
// Хранилище данных сайта: чат, очередь, дневник, хотелки, статистика.
// Если задан DATABASE_URL — всё лежит в Postgres (например, бесплатный Neon) и не пропадает,
// когда бесплатный хостинг засыпает. Иначе — в файлах в папке data/.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

class FileStore {
  constructor(dir) {
    this.dir = dir;
    this.kind = 'файлы';
  }
  async init() {
    await fsp.mkdir(this.dir, { recursive: true });
  }
  file(key) {
    return path.join(this.dir, `${key}.json`);
  }
  async get(key) {
    try {
      return JSON.parse(await fsp.readFile(this.file(key), 'utf8'));
    } catch {
      return null;
    }
  }
  async set(key, value) {
    const f = this.file(key);
    await fsp.writeFile(f + '.tmp', JSON.stringify(value));
    await fsp.rename(f + '.tmp', f);
  }
  setSync(key, value) {
    fs.writeFileSync(this.file(key), JSON.stringify(value));
  }

  // ── переписка ──
  async loadMessages() {
    if (this.msgs) return this.msgs;
    const saved = await this.get('messages');
    this.msgs = Array.isArray(saved) ? saved : [];
    return this.msgs;
  }
  saveMessagesSoon() {
    clearTimeout(this.msgTimer);
    this.msgTimer = setTimeout(() => this.set('messages', this.msgs).catch((e) => console.error('Не сохранился чат:', e.message)), 1500);
  }
  async flushMessages() {
    clearTimeout(this.msgTimer);
    if (this.msgs) await this.set('messages', this.msgs);
  }
  async messageCount() {
    return (await this.loadMessages()).length;
  }
  async addMessage(m) {
    (await this.loadMessages()).push(m);
    this.saveMessagesSoon();
  }
  async addMessages(list) {
    (await this.loadMessages()).push(...list);
    this.saveMessagesSoon();
  }
  async recentMessages(limit) {
    const all = await this.loadMessages();
    return { messages: all.slice(-limit), hasMore: all.length > limit };
  }
  async olderMessages(beforeId, limit) {
    const all = await this.loadMessages();
    const i = all.findIndex((m) => m.id === beforeId);
    if (i <= 0) return { messages: [], hasMore: false };
    return { messages: all.slice(Math.max(0, i - limit), i), hasMore: i - limit > 0 };
  }
  async clearMessages() {
    this.msgs = [];
    await this.set('messages', []);
  }
}

class PgStore {
  constructor(url) {
    // eslint-disable-next-line global-require
    const { Pool } = require('pg');
    const needsSsl = !/sslmode=disable/.test(url) && !/@(localhost|127\.0\.0\.1)[:/]/.test(url);
    this.pool = new Pool({
      connectionString: url,
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000,
      ssl: needsSsl ? { rejectUnauthorized: true } : false,
    });
    this.pool.on('error', (e) => console.error('База данных:', e.message));
    this.kind = 'база данных';
  }
  async init() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS kz_kv (
      key text PRIMARY KEY,
      value jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    // вся переписка: seq задаёт порядок, по нему же подгружаем старые сообщения
    await this.pool.query(`CREATE TABLE IF NOT EXISTS kz_messages (
      seq bigserial PRIMARY KEY,
      id text UNIQUE NOT NULL,
      by_login text NOT NULL,
      text text NOT NULL,
      at bigint NOT NULL
    )`);
  }

  // ── переписка ──
  static row(r) {
    return { id: r.id, by: r.by_login, text: r.text, at: Number(r.at) };
  }
  async messageCount() {
    const r = await this.pool.query('SELECT count(*)::int AS n FROM kz_messages');
    return r.rows[0].n;
  }
  addMessage(m) {
    // строго по очереди: иначе параллельные запросы могут записать сообщения не в том порядке
    const run = () => this.pool.query(
      'INSERT INTO kz_messages (id, by_login, text, at) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING',
      [m.id, m.by, m.text, m.at]);
    this.msgChain = (this.msgChain || Promise.resolve()).then(run, run);
    return this.msgChain;
  }
  async addMessages(list) {
    for (const m of list) await this.addMessage(m);
  }
  async recentMessages(limit) {
    const r = await this.pool.query('SELECT * FROM kz_messages ORDER BY seq DESC LIMIT $1', [limit + 1]);
    const rows = r.rows.slice(0, limit).reverse().map(PgStore.row);
    return { messages: rows, hasMore: r.rows.length > limit };
  }
  async olderMessages(beforeId, limit) {
    const r = await this.pool.query(
      `SELECT * FROM kz_messages
       WHERE seq < (SELECT seq FROM kz_messages WHERE id = $1)
       ORDER BY seq DESC LIMIT $2`, [beforeId, limit + 1]);
    const rows = r.rows.slice(0, limit).reverse().map(PgStore.row);
    return { messages: rows, hasMore: r.rows.length > limit };
  }
  async flushMessages() {
    // дождаться сообщений, которые ещё пишутся
    if (this.msgChain) await this.msgChain.catch(() => {});
  }
  async clearMessages() {
    await this.pool.query('DELETE FROM kz_messages');
  }
  async get(key) {
    const r = await this.pool.query('SELECT value FROM kz_kv WHERE key = $1', [key]);
    return r.rows.length ? r.rows[0].value : null;
  }
  async set(key, value) {
    await this.pool.query(
      `INSERT INTO kz_kv (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(value)],
    );
  }
}

function createStore({ databaseUrl, dataDir }) {
  return databaseUrl ? new PgStore(databaseUrl) : new FileStore(dataDir);
}

module.exports = { createStore };
