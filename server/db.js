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
    coin_id TEXT PRIMARY KEY,
    added_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS holdings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user TEXT NOT NULL DEFAULT 'demo',
    coin_id TEXT NOT NULL,
    amount REAL NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(user, coin_id)
  );
`);

// Seed a sensible default watchlist + demo portfolio once.
const wlCount = db.prepare('SELECT COUNT(*) AS n FROM watchlist').get().n;
if (wlCount === 0) {
  const now = Date.now();
  const ins = db.prepare('INSERT INTO watchlist (coin_id, added_at) VALUES (?, ?)');
  ['bitcoin', 'ethereum', 'solana'].forEach((id) => ins.run(id, now));
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
  list() {
    return db.prepare('SELECT coin_id FROM watchlist ORDER BY added_at').all().map((r) => r.coin_id);
  },
  add(coinId) {
    db.prepare('INSERT OR IGNORE INTO watchlist (coin_id, added_at) VALUES (?, ?)').run(coinId, Date.now());
    return this.list();
  },
  remove(coinId) {
    db.prepare('DELETE FROM watchlist WHERE coin_id = ?').run(coinId);
    return this.list();
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

module.exports = { db, Watchlist, Holdings };
