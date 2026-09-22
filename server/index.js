/*
 * CryptoHub - Backend API + static host
 * ------------------------------------------------------------------
 * A lightweight Express server that:
 *   1. Serves the static frontend (index.html + /pages + /css + /js).
 *   2. Exposes a small JSON API that proxies and caches live market
 *      data from CoinGecko. Proxying server-side avoids browser CORS
 *      and rate-limit issues and gives the app a real full-stack surface.
 *   3. Provides an in-memory watchlist demo endpoint.
 *
 * Requires Node.js 18+ (uses the built-in global `fetch`).
 */
'use strict';

const path = require('path');
const express = require('express');

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

// --- Demo watchlist (in-memory; resets on restart) -------------------
let watchlist = ['bitcoin', 'ethereum'];

app.get('/api/watchlist', (_req, res) => res.json({ watchlist }));

app.post('/api/watchlist', (req, res) => {
  const id = (req.body && req.body.id || '').toString().trim().toLowerCase();
  if (!id) return res.status(400).json({ error: 'Missing coin id' });
  if (!watchlist.includes(id)) watchlist.push(id);
  res.json({ watchlist });
});

app.delete('/api/watchlist/:id', (req, res) => {
  watchlist = watchlist.filter((c) => c !== req.params.id.toLowerCase());
  res.json({ watchlist });
});

// --- Static frontend -------------------------------------------------
app.use(express.static(ROOT, { extensions: ['html'] }));

// SPA-ish fallback to the homepage for unknown non-API routes.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(ROOT, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`CryptoHub running at http://localhost:${PORT}`);
  console.log(`API health:        http://localhost:${PORT}/api/health`);
});

module.exports = app;
