/*
 * CryptoHub - SQLite persistence layer
 * ------------------------------------------------------------------
 * Uses better-sqlite3 (synchronous, zero-config). Stores the watchlist
 * and per-user portfolio holdings so they survive server restarts.
 * The DB file lives at server/cryptohub.db (gitignored).
 */
'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, 'cryptohub.db'));
db.pragma('journal_mode = WAL');

// --- Schema ----------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS watchlist (
    user TEXT NOT NULL DEFAULT 'demo',
    coin_id TEXT NOT NULL,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (user, coin_id)
  );

  CREATE TABLE IF NOT EXISTS holdings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user TEXT NOT NULL DEFAULT 'demo',
    coin_id TEXT NOT NULL,
    amount REAL NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(user, coin_id)
  );

  CREATE TABLE IF NOT EXISTS auth_nonces (
    address TEXT PRIMARY KEY,
    nonce TEXT NOT NULL,
    expires INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Migration: earlier versions had a watchlist keyed only by coin_id (no
// user column). If we detect that shape, rebuild the table under 'demo'.
try {
  const cols = db.prepare("PRAGMA table_info(watchlist)").all();
  if (!cols.some((c) => c.name === 'user')) {
    const now = Date.now();
    const old = db.prepare('SELECT coin_id, added_at FROM watchlist').all();
    db.exec('ALTER TABLE watchlist RENAME TO watchlist_old;');
    db.exec(`CREATE TABLE watchlist (
      user TEXT NOT NULL DEFAULT 'demo', coin_id TEXT NOT NULL,
      added_at INTEGER NOT NULL, PRIMARY KEY (user, coin_id));`);
    const ins = db.prepare('INSERT OR IGNORE INTO watchlist (user, coin_id, added_at) VALUES (?, ?, ?)');
    old.forEach((r) => ins.run('demo', r.coin_id, r.added_at || now));
    db.exec('DROP TABLE watchlist_old;');
  }
} catch (e) { /* fresh DB already has the new shape */ }

// Seed a sensible default watchlist + demo portfolio once (for the shared
// 'demo' scope used when a request is unauthenticated).
const wlCount = db.prepare("SELECT COUNT(*) AS n FROM watchlist WHERE user = 'demo'").get().n;
if (wlCount === 0) {
  const now = Date.now();
  const ins = db.prepare('INSERT OR IGNORE INTO watchlist (user, coin_id, added_at) VALUES (?, ?, ?)');
  ['bitcoin', 'ethereum', 'solana'].forEach((id) => ins.run('demo', id, now));
}
const hCount = db.prepare('SELECT COUNT(*) AS n FROM holdings').get().n;
if (hCount === 0) {
  const now = Date.now();
  const ins = db.prepare('INSERT INTO holdings (user, coin_id, amount, updated_at) VALUES (?, ?, ?, ?)');
  [['bitcoin', 0.3542], ['ethereum', 4.82], ['solana', 45.0], ['cardano', 5200]]
    .forEach(([id, amt]) => ins.run('demo', id, amt, now));
}

// --- Watchlist -------------------------------------------------------
const Watchlist = {
  list(user = 'demo') {
    return db.prepare('SELECT coin_id FROM watchlist WHERE user = ? ORDER BY added_at').all(user).map((r) => r.coin_id);
  },
  add(user, coinId) {
    db.prepare('INSERT OR IGNORE INTO watchlist (user, coin_id, added_at) VALUES (?, ?, ?)').run(user, coinId, Date.now());
    return this.list(user);
  },
  remove(user, coinId) {
    db.prepare('DELETE FROM watchlist WHERE user = ? AND coin_id = ?').run(user, coinId);
    return this.list(user);
  }
};

// --- Holdings / Portfolio -------------------------------------------
const Holdings = {
  list(user = 'demo') {
    return db.prepare('SELECT coin_id, amount FROM holdings WHERE user = ? ORDER BY coin_id').all(user);
  },
  upsert(user, coinId, amount) {
    db.prepare(
      `INSERT INTO holdings (user, coin_id, amount, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user, coin_id) DO UPDATE SET amount = excluded.amount, updated_at = excluded.updated_at`
    ).run(user, coinId, amount, Date.now());
    return this.list(user);
  },
  remove(user, coinId) {
    db.prepare('DELETE FROM holdings WHERE user = ? AND coin_id = ?').run(user, coinId);
    return this.list(user);
  }
};

// --- Auth nonces (persisted, so sign-in survives restarts / scales) --
const Nonces = {
  put(address, nonce, expires) {
    db.prepare(
      `INSERT INTO auth_nonces (address, nonce, expires) VALUES (?, ?, ?)
       ON CONFLICT(address) DO UPDATE SET nonce = excluded.nonce, expires = excluded.expires`
    ).run(address, nonce, expires);
  },
  get(address) {
    return db.prepare('SELECT nonce, expires FROM auth_nonces WHERE address = ?').get(address) || null;
  },
  remove(address) {
    db.prepare('DELETE FROM auth_nonces WHERE address = ?').run(address);
  },
  // Opportunistically drop expired rows so the table doesn't grow.
  cleanup(now = Date.now()) {
    db.prepare('DELETE FROM auth_nonces WHERE expires < ?').run(now);
  }
};

// --- Key/value settings (e.g. a durable token-signing secret) --------
const Settings = {
  get(key) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
  },
  set(key, value) {
    db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(key, value);
    return value;
  }
};

module.exports = { db, Watchlist, Holdings, Nonces, Settings };
