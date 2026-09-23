/*
 * CryptoHub - Browser module tests (js/wallet.js, js/api.js)
 * ------------------------------------------------------------------
 * These modules are browser IIFEs that attach an API to `window` and use
 * fetch / localStorage / window.ethereum. We load them into a fabricated
 * browser-like global with stubbable primitives, then exercise the pure
 * logic (encoding, formatting, fallback chains) and the request routing
 * (via a recording provider / stubbed fetch) — all under `node --test`,
 * no browser or extra deps required.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const WALLET_SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'wallet.js'), 'utf8');
const API_SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'api.js'), 'utf8');

// A minimal localStorage.
function makeStorage() {
  const s = {};
  return {
    getItem: (k) => (k in s ? s[k] : null),
    setItem: (k, v) => { s[k] = String(v); },
    removeItem: (k) => { delete s[k]; },
    _dump: () => Object.assign({}, s)
  };
}

// Build a browser-like sandbox and evaluate a module source in it.
// `overrides` can supply ethereum, fetch, location, etc.
function loadModule(src, overrides = {}) {
  const storage = overrides.localStorage || makeStorage();
  const win = {
    localStorage: storage,
    location: overrides.location || { protocol: 'https:', origin: 'https://cryptohub.test', host: 'cryptohub.test' },
    document: overrides.document || { querySelector: () => null, addEventListener: () => {}, createElement: () => ({ style: {} }) },
    navigator: { userAgent: 'node-test' },
    console,
    setTimeout, clearTimeout,
    AbortController,
    TextEncoder,
    fetch: overrides.fetch || (async () => { throw new Error('network disabled'); }),
    open: () => {},
    requestAnimationFrame: (fn) => setTimeout(fn, 0)
  };
  if ('ethereum' in overrides) win.ethereum = overrides.ethereum;
  win.window = win;
  // Preload any globals the module reads off `window` (e.g. api.js reads window.CryptoHubWallet).
  Object.assign(win, overrides.preload || {});

  const sandbox = Object.assign({ window: win, globalThis: win }, win);
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'module.js' });
  return { win, storage };
}

// A provider stub that records the requests it receives and returns scripted replies.
function recordingProvider(replies = {}) {
  const calls = [];
  return {
    calls,
    on() {},
    removeListener() {},
    async request({ method, params }) {
      calls.push({ method, params });
      if (method in replies) {
        const r = replies[method];
        return typeof r === 'function' ? r(params) : r;
      }
      // Sensible defaults.
      if (method === 'eth_chainId') return '0x1';
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return ['0xabc0000000000000000000000000000000000001'];
      if (method === 'eth_getBalance') return '0xde0b6b3a7640000'; // 1 ETH
      if (method === 'eth_getTransactionCount') return '0x5';
      if (method === 'eth_sendTransaction') return '0x' + 'ab'.repeat(32);
      if (method === 'eth_call') return '0x0000000000000000000000000000000000000000000000001bc16d674ec80000'; // 2e18
      if (method === 'personal_sign') return '0xsig';
      return null;
    }
  };
}

// =====================================================================
// wallet.js
// =====================================================================

test('wallet: shorten formats an address', () => {
  const { win } = loadModule(WALLET_SRC, { ethereum: recordingProvider() });
  const W = win.CryptoHubWallet;
  assert.strictEqual(W.shorten('0x1234567890abcdef1234567890abcdef12345678'), '0x1234...5678');
  assert.strictEqual(W.shorten(''), '');
});

test('wallet: hasInjected reflects presence of window.ethereum', () => {
  const withEth = loadModule(WALLET_SRC, { ethereum: recordingProvider() });
  assert.strictEqual(withEth.win.CryptoHubWallet.hasInjected(), true);
  const noEth = loadModule(WALLET_SRC, {}); // no ethereum key
  assert.strictEqual(noEth.win.CryptoHubWallet.hasInjected(), false);
  assert.strictEqual(noEth.win.CryptoHubWallet.hasProvider(), false);
});

test('wallet: swapSupported and wrappedSymbol vary by chain', async () => {
  const provider = recordingProvider({ eth_chainId: '0x89' }); // Polygon
  const { win } = loadModule(WALLET_SRC, { ethereum: provider });
  const W = win.CryptoHubWallet;
  await W.connect();
  assert.strictEqual(W.swapSupported(), true, 'Polygon is supported');
  assert.strictEqual(W.wrappedSymbol(), 'WMATIC', 'Polygon wrapped symbol');
  assert.deepStrictEqual(W.getState().chainId, '0x89');
});

test('wallet: unsupported chain reports no swap support', async () => {
  const provider = recordingProvider({ eth_chainId: '0x270f' }); // some random chain
  const { win } = loadModule(WALLET_SRC, { ethereum: provider });
  await win.CryptoHubWallet.connect();
  assert.strictEqual(win.CryptoHubWallet.swapSupported(), false);
});

test('wallet: connect populates state from the provider', async () => {
  const provider = recordingProvider({
    eth_requestAccounts: ['0xDEAD000000000000000000000000000000000001'],
    eth_chainId: '0x1',
    eth_getBalance: '0x1bc16d674ec80000' // 2 ETH
  });
  const { win, storage } = loadModule(WALLET_SRC, { ethereum: provider });
  const W = win.CryptoHubWallet;
  const s = await W.connect();
  assert.strictEqual(s.connected, true);
  assert.strictEqual(s.account, '0xDEAD000000000000000000000000000000000001');
  assert.strictEqual(s.chainName, 'Ethereum Mainnet');
  assert.strictEqual(s.balance, 2);
  assert.strictEqual(storage._dump().cryptohub_wallet_connected, '1');
});

test('wallet: sendEth routes eth_sendTransaction with correct wei value', async () => {
  const provider = recordingProvider();
  const { win } = loadModule(WALLET_SRC, { ethereum: provider });
  const W = win.CryptoHubWallet;
  await W.connect();
  const to = '0x' + '11'.repeat(20);
  await W.sendEth(to, '1.5');
  const tx = provider.calls.find((c) => c.method === 'eth_sendTransaction');
  assert.ok(tx, 'should send a transaction');
  assert.strictEqual(tx.params[0].to, to);
  // 1.5 ETH = 0x14d1120d7b160000 wei
  assert.strictEqual(BigInt(tx.params[0].value), 1500000000000000000n);
});

test('wallet: sendEth rejects a bad recipient address', async () => {
  const { win } = loadModule(WALLET_SRC, { ethereum: recordingProvider() });
  const W = win.CryptoHubWallet;
  await W.connect();
  await assert.rejects(() => W.sendEth('not-an-address', '1'), /Invalid recipient/);
});

test('wallet: wrapEth calls WETH deposit() with the ETH value', async () => {
  const provider = recordingProvider({ eth_chainId: '0x1' });
  const { win } = loadModule(WALLET_SRC, { ethereum: provider });
  const W = win.CryptoHubWallet;
  await W.connect();
  await W.wrapEth('0.25');
  const tx = provider.calls.find((c) => c.method === 'eth_sendTransaction');
  assert.strictEqual(tx.params[0].to, '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'); // Ethereum WETH9
  assert.strictEqual(tx.params[0].data, '0xd0e30db0'); // deposit()
  assert.strictEqual(BigInt(tx.params[0].value), 250000000000000000n); // 0.25e18
});

test('wallet: unwrapEth encodes withdraw(uint256) calldata correctly', async () => {
  const provider = recordingProvider({ eth_chainId: '0x1' });
  const { win } = loadModule(WALLET_SRC, { ethereum: provider });
  const W = win.CryptoHubWallet;
  await W.connect();
  await W.unwrapEth('1');
  const tx = provider.calls.find((c) => c.method === 'eth_sendTransaction');
  // withdraw selector + 32-byte amount (1e18)
  const expected = '0x2e1a7d4d' + (10n ** 18n).toString(16).padStart(64, '0');
  assert.strictEqual(tx.params[0].data, expected);
  assert.strictEqual(tx.params[0].value, undefined, 'withdraw carries no ETH value');
});

test('wallet: swap dispatches to wrap/unwrap and rejects unknown direction', async () => {
  const provider = recordingProvider({ eth_chainId: '0x1' });
  const { win } = loadModule(WALLET_SRC, { ethereum: provider });
  const W = win.CryptoHubWallet;
  await W.connect();
  await W.swap('wrap', '0.1');
  assert.ok(provider.calls.some((c) => c.method === 'eth_sendTransaction'));
  await assert.rejects(() => W.swap('sideways', '1'), /Unknown swap direction/);
});

test('wallet: disconnect clears state and the session token', async () => {
  const provider = recordingProvider();
  const { win, storage } = loadModule(WALLET_SRC, { ethereum: provider });
  const W = win.CryptoHubWallet;
  await W.connect();
  storage.setItem('cryptohub_session_token', 'tok.mac');
  W.disconnect();
  assert.strictEqual(W.getState().connected, false);
  assert.strictEqual(W.getState().account, null);
  assert.strictEqual(storage._dump().cryptohub_session_token, undefined, 'token cleared');
  assert.strictEqual(storage._dump().cryptohub_wallet_connected, undefined);
});

test('wallet: getToken / isLoggedIn reflect stored token', () => {
  const storage = makeStorage();
  const { win } = loadModule(WALLET_SRC, { ethereum: recordingProvider(), localStorage: storage });
  const W = win.CryptoHubWallet;
  assert.strictEqual(W.isLoggedIn(), false);
  storage.setItem('cryptohub_session_token', 'abc.def');
  assert.strictEqual(W.getToken(), 'abc.def');
  assert.strictEqual(W.isLoggedIn(), true);
});

test('wallet: walletConnectAvailable reads the configured project id', () => {
  const noId = loadModule(WALLET_SRC, { ethereum: recordingProvider() });
  assert.strictEqual(noId.win.CryptoHubWallet.walletConnectAvailable(), false);
  const withId = loadModule(WALLET_SRC, { ethereum: recordingProvider(), preload: { CRYPTOHUB_WC_PROJECT_ID: 'pid123' } });
  assert.strictEqual(withId.win.CryptoHubWallet.walletConnectAvailable(), true);
});

test('wallet: dexSwapSupported reflects the chain', async () => {
  const on = loadModule(WALLET_SRC, { ethereum: recordingProvider({ eth_chainId: '0x1' }) });
  await on.win.CryptoHubWallet.connect();
  assert.strictEqual(on.win.CryptoHubWallet.dexSwapSupported(), true);
  const off = loadModule(WALLET_SRC, { ethereum: recordingProvider({ eth_chainId: '0xa' }) }); // Optimism: no router configured
  await off.win.CryptoHubWallet.connect();
  assert.strictEqual(off.win.CryptoHubWallet.dexSwapSupported(), false);
});

// Encode a uint256[] eth_call return for a quote whose last element is `out`.
function quoteReturn(out) {
  const u = (n) => BigInt(n).toString(16).padStart(64, '0');
  return '0x' + u(2) + u(2) + u(1) + u(out); // offset, length=2, amounts[0], amounts[1]=out
}

test('wallet: getSwapQuote parses the router getAmountsOut result', async () => {
  const provider = recordingProvider({ eth_chainId: '0x1', eth_call: quoteReturn(2500000) });
  const { win } = loadModule(WALLET_SRC, { ethereum: provider });
  const W = win.CryptoHubWallet;
  await W.connect();
  const q = await W.getSwapQuote('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', '1');
  assert.strictEqual(q, 2500000n);
});

test('wallet: swapEthForToken builds a correct router tx with slippage', async () => {
  const provider = recordingProvider({ eth_chainId: '0x1', eth_call: quoteReturn(2000000) });
  const { win } = loadModule(WALLET_SRC, { ethereum: provider });
  const W = win.CryptoHubWallet;
  await W.connect();
  const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  await W.swapEthForToken(USDC, '1', 1); // 1% slippage
  const tx = provider.calls.find((c) => c.method === 'eth_sendTransaction');
  assert.strictEqual(tx.params[0].to, '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'); // Uniswap V2 router
  assert.strictEqual(BigInt(tx.params[0].value), 1000000000000000000n); // 1 ETH
  assert.ok(tx.params[0].data.startsWith('0x7ff36ab5'), 'swapExactETHForTokens selector');
  const body = tx.params[0].data.slice(10);
  const amountOutMin = BigInt('0x' + body.slice(0, 64));
  assert.strictEqual(amountOutMin, 1980000n, '2,000,000 minus 1% slippage');
  assert.strictEqual(BigInt('0x' + body.slice(64, 128)), 128n, 'path offset 0x80');
  assert.ok(tx.params[0].data.toLowerCase().includes(USDC.slice(2).toLowerCase()), 'path includes token');
});

test('wallet: swapEthForToken rejects a bad token address', async () => {
  const { win } = loadModule(WALLET_SRC, { ethereum: recordingProvider({ eth_chainId: '0x1' }) });
  const W = win.CryptoHubWallet;
  await W.connect();
  await assert.rejects(() => W.swapEthForToken('nope', '1'), /Invalid token address/);
});

test('wallet: explorer URLs resolve per chain', async () => {
  const provider = recordingProvider({ eth_chainId: '0x89' });
  const { win } = loadModule(WALLET_SRC, { ethereum: provider });
  const W = win.CryptoHubWallet;
  await W.connect();
  assert.ok(W.explorerTxUrl('0xhash').startsWith('https://polygonscan.com/tx/'));
  assert.ok(W.explorerAddressUrl('0xabc').startsWith('https://polygonscan.com/address/'));
});

// =====================================================================
// api.js
// =====================================================================

// Load api.js with a given fetch stub and optional wallet token.
function loadApi(fetchStub, opts = {}) {
  const preload = {};
  if (opts.token) preload.CryptoHubWallet = { getToken: () => opts.token };
  const { win } = loadModule(API_SRC, {
    fetch: fetchStub,
    location: opts.location || { protocol: 'https:', origin: 'https://cryptohub.test' },
    preload
  });
  return win.CryptoHubAPI;
}

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

test('api: format.usd formats large and small numbers', () => {
  const API = loadApi(async () => jsonResponse({}));
  assert.strictEqual(API.format.usd(1234.5), '$1,234.5');
  assert.strictEqual(API.format.usd(0.0004321), '$0.000432');
  assert.strictEqual(API.format.usd(null), '--');
  assert.strictEqual(API.format.usd(NaN), '--');
});

test('api: format.compact abbreviates magnitudes', () => {
  const API = loadApi(async () => jsonResponse({}));
  assert.strictEqual(API.format.compact(2.36e12), '$2.36 T');
  assert.strictEqual(API.format.compact(9.85e9), '$9.85 B');
  assert.strictEqual(API.format.compact(500), '$500.00');
});

test('api: format.percent signs and rounds', () => {
  const API = loadApi(async () => jsonResponse({}));
  assert.strictEqual(API.format.percent(3.2), '+3.20%');
  assert.strictEqual(API.format.percent(-1.5), '-1.50%');
  assert.strictEqual(API.format.percent(null), '--');
});

test('api: getMarkets uses the backend when it returns coins', async () => {
  const calls = [];
  const fetchStub = async (url) => {
    calls.push(String(url));
    if (String(url).startsWith('/api/markets')) {
      return jsonResponse({ live: true, coins: [{ id: 'bitcoin', name: 'Bitcoin', current_price: 42, price_change_percentage_24h: 1 }] });
    }
    throw new Error('should not reach coingecko');
  };
  const API = loadApi(fetchStub);
  const { coins, live } = await API.getMarkets(['bitcoin']);
  assert.strictEqual(live, true);
  assert.strictEqual(coins[0].id, 'bitcoin');
  assert.strictEqual(coins[0].price, 42);
  assert.strictEqual(coins[0].symbol, 'BTC', 'withMeta adds the symbol');
  assert.ok(calls[0].startsWith('/api/markets'), 'backend hit first');
});

test('api: getMarkets falls back to CoinGecko when backend fails', async () => {
  const calls = [];
  const fetchStub = async (url) => {
    calls.push(String(url));
    if (String(url).startsWith('/api/markets')) return jsonResponse({}, false, 502);
    // CoinGecko direct
    return jsonResponse([{ id: 'ethereum', name: 'Ethereum', current_price: 3000, price_change_percentage_24h: -2 }]);
  };
  const API = loadApi(fetchStub);
  const { coins, live } = await API.getMarkets(['ethereum']);
  assert.strictEqual(live, true);
  assert.strictEqual(coins[0].id, 'ethereum');
  assert.ok(calls.some((u) => u.includes('coingecko')), 'CoinGecko was called');
});

test('api: getMarkets uses the static snapshot when everything fails', async () => {
  const fetchStub = async () => { throw new Error('offline'); };
  const API = loadApi(fetchStub);
  const { coins, live } = await API.getMarkets(['bitcoin']);
  assert.strictEqual(live, false, 'snapshot is not live');
  assert.ok(coins.length > 0, 'snapshot has coins');
  assert.ok(coins.every((c) => c.symbol), 'snapshot coins carry meta');
});

test('api: getMarkets skips the backend when not served over http', async () => {
  const calls = [];
  const fetchStub = async (url) => {
    calls.push(String(url));
    return jsonResponse([{ id: 'bitcoin', name: 'Bitcoin', current_price: 1, price_change_percentage_24h: 0 }]);
  };
  const API = loadApi(fetchStub, { location: { protocol: 'file:', origin: 'null' } });
  await API.getMarkets(['bitcoin']);
  assert.ok(!calls.some((u) => u.startsWith('/api/markets')), 'backend not called on file://');
  assert.ok(calls.some((u) => u.includes('coingecko')));
});

test('api: requests attach the wallet Bearer token when signed in', async () => {
  let seenHeaders = null;
  const fetchStub = async (url, opts) => {
    seenHeaders = (opts && opts.headers) || {};
    return jsonResponse({ live: true, coins: [{ id: 'bitcoin', name: 'Bitcoin', current_price: 1, price_change_percentage_24h: 0 }] });
  };
  const API = loadApi(fetchStub, { token: 'session.token.abc' });
  await API.getMarkets(['bitcoin']);
  assert.strictEqual(seenHeaders.Authorization, 'Bearer session.token.abc');
});

test('api: requests omit Authorization when not signed in', async () => {
  let seenHeaders = null;
  const fetchStub = async (url, opts) => {
    seenHeaders = (opts && opts.headers) || {};
    return jsonResponse({ live: true, coins: [{ id: 'bitcoin', name: 'Bitcoin', current_price: 1, price_change_percentage_24h: 0 }] });
  };
  const API = loadApi(fetchStub); // no token
  await API.getMarkets(['bitcoin']);
  assert.ok(!('Authorization' in seenHeaders), 'no auth header when anonymous');
});

test('api: getPortfolio returns null on non-http (static file) context', async () => {
  const API = loadApi(async () => jsonResponse({}), { location: { protocol: 'file:', origin: 'null' } });
  const result = await API.getPortfolio('demo');
  assert.strictEqual(result, null);
});
