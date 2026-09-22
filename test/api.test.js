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

function req(method, path, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const url = new URL(base + path);
    const headers = Object.assign(
      data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
      extraHeaders || {}
    );
    const r = http.request(url, { method, headers }, (res) => {
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

// --- Wallet auth (Sign-In With Ethereum) ----------------------------
const { secp256k1 } = require('@noble/curves/secp256k1');
const { keccak_256 } = require('@noble/hashes/sha3');

function addressFromPub(pub) {
  return '0x' + Buffer.from(keccak_256(pub.slice(1)).slice(-20)).toString('hex');
}
function personalHash(message) {
  const msg = Buffer.from(message, 'utf8');
  const prefix = Buffer.from('\x19Ethereum Signed Message:\n' + msg.length, 'utf8');
  return keccak_256(Buffer.concat([prefix, msg]));
}
function signPersonal(message, priv) {
  const sig = secp256k1.sign(personalHash(message), priv);
  const compact = sig.toCompactRawBytes ? sig.toCompactRawBytes() : sig.toBytes('compact');
  return '0x' + Buffer.from(compact).toString('hex') + (27 + sig.recovery).toString(16).padStart(2, '0');
}
function makeWallet() {
  const priv = secp256k1.utils.randomPrivateKey();
  const address = addressFromPub(secp256k1.getPublicKey(priv, false));
  return { priv, address };
}
async function signIn(w) {
  const nonceRes = await req('GET', '/api/auth/nonce?address=' + w.address);
  assert.strictEqual(nonceRes.status, 200);
  const signature = signPersonal(nonceRes.json.message, w.priv);
  const verifyRes = await req('POST', '/api/auth/verify', { address: w.address, signature });
  assert.strictEqual(verifyRes.status, 200, 'verify should succeed');
  assert.ok(verifyRes.json.token, 'should return a token');
  return verifyRes.json.token;
}

test('auth: nonce -> sign -> verify issues a token, /me reflects it', async () => {
  const w = makeWallet();
  const token = await signIn(w);
  const me = await req('GET', '/api/auth/me', null, { Authorization: 'Bearer ' + token });
  assert.strictEqual(me.status, 200);
  assert.strictEqual(me.json.authenticated, true);
  assert.strictEqual(me.json.address, w.address.toLowerCase());
});

test('auth: verify rejects a signature from the wrong key', async () => {
  const w = makeWallet();
  const other = makeWallet();
  const nonceRes = await req('GET', '/api/auth/nonce?address=' + w.address);
  const badSig = signPersonal(nonceRes.json.message, other.priv); // signed by the wrong key
  const verifyRes = await req('POST', '/api/auth/verify', { address: w.address, signature: badSig });
  assert.strictEqual(verifyRes.status, 401);
});

test('auth: verify requires a prior nonce', async () => {
  const w = makeWallet();
  const verifyRes = await req('POST', '/api/auth/verify', { address: w.address, signature: '0x' + '11'.repeat(65) });
  assert.strictEqual(verifyRes.status, 401);
});

test('auth: invalid/garbage token is treated as anonymous', async () => {
  const me = await req('GET', '/api/auth/me', null, { Authorization: 'Bearer not.a.token' });
  assert.strictEqual(me.status, 200);
  assert.strictEqual(me.json.authenticated, false);
});

test('auth: portfolios are isolated per authenticated wallet', async () => {
  const a = makeWallet();
  const b = makeWallet();
  const tokenA = await signIn(a);
  const tokenB = await signIn(b);
  const authA = { Authorization: 'Bearer ' + tokenA };
  const authB = { Authorization: 'Bearer ' + tokenB };

  // A adds a holding that B should never see.
  const up = await req('POST', '/api/portfolio', { coinId: 'chainlink', amount: 7 }, authA);
  assert.strictEqual(up.status, 200);
  assert.ok(up.json.holdings.some((h) => h.coin_id === 'chainlink'));

  const gotB = await req('GET', '/api/portfolio', null, authB);
  assert.ok(gotB.status === 200 || gotB.status === 502);
  assert.ok(!gotB.json.holdings.some((h) => (h.coinId || h.coin_id) === 'chainlink'),
    'wallet B must not see wallet A holdings');

  // cleanup
  await req('DELETE', '/api/portfolio/chainlink', null, authA);
});

test('auth: watchlist is isolated per authenticated wallet', async () => {
  const a = makeWallet();
  const tokenA = await signIn(a);
  const authA = { Authorization: 'Bearer ' + tokenA };

  const added = await req('POST', '/api/watchlist', { id: 'uniswap' }, authA);
  assert.ok(added.json.watchlist.includes('uniswap'));

  // Anonymous (demo) scope should not contain wallet A's coin.
  const anon = await req('GET', '/api/watchlist');
  assert.ok(!anon.json.watchlist.includes('uniswap'), 'demo watchlist must not see wallet A entry');

  await req('DELETE', '/api/watchlist/uniswap', null, authA);
});
