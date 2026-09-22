/*
 * CryptoHub - Backend API + static host
 * ------------------------------------------------------------------
 * A lightweight Express server that:
 *   1. Serves the static frontend (index.html + /pages + /css + /js).
 *   2. Exposes a small JSON API that proxies and caches live market
 *      data from CoinGecko. Proxying server-side avoids browser CORS
 *      and rate-limit issues and gives the app a real full-stack surface.
 *   3. Persists the watchlist and portfolio holdings in SQLite (with an
 *      in-memory fallback if the native SQLite module isn't available).
 *
 * Requires Node.js 18+ (uses the built-in global `fetch`).
 */
'use strict';

const path = require('path');
const express = require('express');

// Persistence layer. Fall back to a memory store if better-sqlite3 can't load
// (e.g. no native build toolchain), so the API still works everywhere.
let store;
try {
  store = require('./db');
  console.log('CryptoHub: using SQLite persistence (server/cryptohub.db)');
} catch (err) {
  console.warn('CryptoHub: SQLite unavailable, using in-memory store —', err.message);
  const mem = { watchlist: ['bitcoin', 'ethereum', 'solana'], holdings: [
    { coin_id: 'bitcoin', amount: 0.3542 }, { coin_id: 'ethereum', amount: 4.82 },
    { coin_id: 'solana', amount: 45 }, { coin_id: 'cardano', amount: 5200 }
  ] };
  store = {
    Watchlist: {
      list: () => mem.watchlist.slice(),
      add: (id) => { if (!mem.watchlist.includes(id)) mem.watchlist.push(id); return mem.watchlist.slice(); },
      remove: (id) => { mem.watchlist = mem.watchlist.filter((c) => c !== id); return mem.watchlist.slice(); }
    },
    Holdings: {
      list: () => mem.holdings.slice(),
      upsert: (_u, id, amt) => { const h = mem.holdings.find((x) => x.coin_id === id); if (h) h.amount = amt; else mem.holdings.push({ coin_id: id, amount: amt }); return mem.holdings.slice(); },
      remove: (_u, id) => { mem.holdings = mem.holdings.filter((x) => x.coin_id !== id); return mem.holdings.slice(); }
    }
  };
}
const { Watchlist, Holdings } = store;

const app = express();
const PORT = process.env.PORT || 3000;
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const ROOT = path.resolve(__dirname, '..');

app.use(express.json());

// --- Simple in-memory cache to respect upstream rate limits ----------
const cache = new Map();
function cached(key, ttlMs, producer) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < ttlMs) return Promise.resolve(hit.value);
  return Promise.resolve(producer()).then((value) => {
    cache.set(key, { value, time: Date.now() });
    return value;
  });
}

const DEFAULT_IDS = [
  'bitcoin', 'ethereum', 'cardano', 'solana',
  'ripple', 'dogecoin', 'polkadot', 'litecoin'
];

// --- API routes ------------------------------------------------------

// GET /api/health -> service liveness
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'cryptohub-api', time: new Date().toISOString() });
});

// GET /api/markets?ids=bitcoin,ethereum -> live market data (cached 30s)
app.get('/api/markets', async (req, res) => {
  const ids = (req.query.ids ? String(req.query.ids).split(',') : DEFAULT_IDS)
    .map((s) => s.trim()).filter(Boolean);
  const key = 'markets:' + ids.join(',');
  try {
    const data = await cached(key, 30000, async () => {
      const url = `${COINGECKO_BASE}/coins/markets?vs_currency=usd&ids=${ids.join(',')}` +
        '&order=market_cap_desc&sparkline=false&price_change_percentage=24h';
      const r = await fetch(url);
      if (!r.ok) throw new Error('Upstream ' + r.status);
      return r.json();
    });
    res.json({ live: true, coins: data });
  } catch (err) {
    res.status(502).json({ live: false, error: err.message, coins: [] });
  }
});

// GET /api/global -> global market stats (cached 60s)
app.get('/api/global', async (_req, res) => {
  try {
    const data = await cached('global', 60000, async () => {
      const r = await fetch(`${COINGECKO_BASE}/global`);
      if (!r.ok) throw new Error('Upstream ' + r.status);
      return r.json();
    });
    const g = data.data;
    res.json({
      marketCap: g.total_market_cap.usd,
      volume: g.total_volume.usd,
      btcDominance: g.market_cap_percentage.btc,
      marketCapChange: g.market_cap_change_percentage_24h_usd
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/coins/:id/chart?days=7 -> historical prices (cached 60s)
app.get('/api/coins/:id/chart', async (req, res) => {
  const id = req.params.id;
  const days = Number(req.query.days) || 7;
  try {
    const data = await cached(`chart:${id}:${days}`, 60000, async () => {
      const url = `${COINGECKO_BASE}/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error('Upstream ' + r.status);
      return r.json();
    });
    res.json({ id, days, prices: (data.prices || []).map((p) => p[1]) });
  } catch (err) {
    res.status(502).json({ error: err.message, prices: [] });
  }
});

// --- Watchlist (persisted) -------------------------------------------
app.get('/api/watchlist', (_req, res) => res.json({ watchlist: Watchlist.list() }));

app.post('/api/watchlist', (req, res) => {
  const id = (req.body && req.body.id || '').toString().trim().toLowerCase();
  if (!id) return res.status(400).json({ error: 'Missing coin id' });
  res.json({ watchlist: Watchlist.add(id) });
});

app.delete('/api/watchlist/:id', (req, res) => {
  res.json({ watchlist: Watchlist.remove(req.params.id.toLowerCase()) });
});

// --- Portfolio (persisted) -------------------------------------------
// Returns holdings enriched with live prices + computed USD value.
app.get('/api/portfolio', async (req, res) => {
  const user = (req.query.user || 'demo').toString();
  const holdings = Holdings.list(user);
  if (!holdings.length) return res.json({ user, holdings: [], totalValue: 0, live: false });

  const ids = holdings.map((h) => h.coin_id);
  try {
    const data = await cached('markets:' + ids.join(','), 30000, async () => {
      const url = `${COINGECKO_BASE}/coins/markets?vs_currency=usd&ids=${ids.join(',')}` +
        '&order=market_cap_desc&sparkline=false&price_change_percentage=24h';
      const r = await fetch(url);
      if (!r.ok) throw new Error('Upstream ' + r.status);
      return r.json();
    });
    const priceById = {};
    data.forEach((c) => { priceById[c.id] = c; });
    let totalValue = 0;
    const enriched = holdings.map((h) => {
      const m = priceById[h.coin_id] || {};
      const price = m.current_price || 0;
      const value = price * h.amount;
      totalValue += value;
      return {
        coinId: h.coin_id, name: m.name || h.coin_id, symbol: (m.symbol || '').toUpperCase(),
        amount: h.amount, price, value, change24h: m.price_change_percentage_24h || 0
      };
    });
    res.json({ user, holdings: enriched, totalValue, live: true });
  } catch (err) {
    res.status(502).json({ user, holdings: holdings.map((h) => ({ coinId: h.coin_id, amount: h.amount })), totalValue: 0, live: false, error: err.message });
  }
});

app.post('/api/portfolio', (req, res) => {
  const user = (req.body && req.body.user || 'demo').toString();
  const coinId = (req.body && req.body.coinId || '').toString().trim().toLowerCase();
  const amount = Number(req.body && req.body.amount);
  if (!coinId || isNaN(amount)) return res.status(400).json({ error: 'coinId and numeric amount required' });
  res.json({ holdings: Holdings.upsert(user, coinId, amount) });
});

app.delete('/api/portfolio/:coinId', (req, res) => {
  const user = (req.query.user || 'demo').toString();
  res.json({ holdings: Holdings.remove(user, req.params.coinId.toLowerCase()) });
});

// --- Static frontend -------------------------------------------------
app.use(express.static(ROOT, { extensions: ['html'] }));

// SPA-ish fallback to the homepage for unknown non-API routes.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(ROOT, 'index.html'));
});

// Only start listening when run directly (`node server/index.js`), so tests
// can import the app and manage their own ephemeral listener.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`CryptoHub running at http://localhost:${PORT}`);
    console.log(`API health:        http://localhost:${PORT}/api/health`);
  });
}

module.exports = app;
