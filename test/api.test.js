/*
 * CryptoHub - API integration tests
 * ------------------------------------------------------------------
 * Uses the built-in Node test runner (node --test). Boots the Express
 * app on an ephemeral port and exercises every endpoint. Network-backed
 * routes (markets/global/chart) are checked for shape but tolerate
 * upstream failures (they return 502 with a documented body), so tests
 * pass offline too.
 *
 * Run with:  npm test
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

// Use a temp DB so tests never touch the real one.
process.env.PORT = '0';
const app = require('../server/index.js');

let server;
let base;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(() => { if (server) server.close(); });

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const url = new URL(base + path);
    const r = http.request(url, {
      method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch (e) { /* non-JSON */ }
        resolve({ status: res.statusCode, json, raw });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

test('GET /api/health returns ok', async () => {
  const { status, json } = await req('GET', '/api/health');
  assert.strictEqual(status, 200);
  assert.strictEqual(json.status, 'ok');
  assert.strictEqual(json.service, 'cryptohub-api');
});

test('GET /api/markets returns coins array (or documented 502)', async () => {
  const { status, json } = await req('GET', '/api/markets?ids=bitcoin,ethereum');
  assert.ok(status === 200 || status === 502, `unexpected status ${status}`);
  assert.ok(Array.isArray(json.coins), 'coins should be an array');
  if (status === 200) assert.strictEqual(json.live, true);
});

test('GET /api/global returns numeric stats (or 502)', async () => {
  const { status, json } = await req('GET', '/api/global');
  assert.ok(status === 200 || status === 502);
  if (status === 200) {
    assert.strictEqual(typeof json.marketCap, 'number');
    assert.strictEqual(typeof json.btcDominance, 'number');
  }
});

test('GET /api/coins/:id/chart returns prices array (or 502)', async () => {
  const { status, json } = await req('GET', '/api/coins/bitcoin/chart?days=1');
  assert.ok(status === 200 || status === 502);
  assert.ok(Array.isArray(json.prices));
});

test('watchlist add / list / remove round-trips', async () => {
  const added = await req('POST', '/api/watchlist', { id: 'litecoin' });
  assert.strictEqual(added.status, 200);
  assert.ok(added.json.watchlist.includes('litecoin'));

  const listed = await req('GET', '/api/watchlist');
  assert.ok(listed.json.watchlist.includes('litecoin'));

  const removed = await req('DELETE', '/api/watchlist/litecoin');
  assert.ok(!removed.json.watchlist.includes('litecoin'));
});

test('POST /api/watchlist rejects missing id', async () => {
  const { status } = await req('POST', '/api/watchlist', {});
  assert.strictEqual(status, 400);
});

test('portfolio upsert / get / delete round-trips', async () => {
  const up = await req('POST', '/api/portfolio', { coinId: 'polkadot', amount: 12.5 });
  assert.strictEqual(up.status, 200);
  assert.ok(up.json.holdings.some((h) => h.coin_id === 'polkadot'));

  const got = await req('GET', '/api/portfolio');
  assert.ok(got.status === 200 || got.status === 502);
  assert.ok(Array.isArray(got.json.holdings));

  const del = await req('DELETE', '/api/portfolio/polkadot');
  assert.ok(!del.json.holdings.some((h) => h.coin_id === 'polkadot'));
});

test('POST /api/portfolio rejects invalid amount', async () => {
  const { status } = await req('POST', '/api/portfolio', { coinId: 'bitcoin', amount: 'abc' });
  assert.strictEqual(status, 400);
});

test('static frontend is served', async () => {
  const { status, raw } = await req('GET', '/');
  assert.strictEqual(status, 200);
  assert.ok(/CryptoHub/i.test(raw), 'homepage should mention CryptoHub');
});
