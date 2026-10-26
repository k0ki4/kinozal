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
