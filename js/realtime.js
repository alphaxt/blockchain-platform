/*
 * CryptoHub - Real-time Price Stream
 * ------------------------------------------------------------------
 * Streams sub-second live prices from Binance's free public WebSocket
 * (no API key required). Subscribers register by coin id and receive
 * { id, symbol, price, changePercent } updates as ticks arrive.
 *
 * If WebSockets are unavailable/blocked, it transparently falls back to
 * polling the REST market endpoint every few seconds so the UI still
 * updates "live".
 */
(function (global) {
  'use strict';

  // Our internal coin id -> Binance stream symbol (USDT pairs).
  const BINANCE_SYMBOLS = {
    bitcoin: 'btcusdt',
    ethereum: 'ethusdt',
    binancecoin: 'bnbusdt',
    solana: 'solusdt',
    cardano: 'adausdt',
    ripple: 'xrpusdt',
    dogecoin: 'dogeusdt',
    polkadot: 'dotusdt',
    litecoin: 'ltcusdt',
    tron: 'trxusdt',
    chainlink: 'linkusdt',
    'avalanche-2': 'avaxusdt',
    'matic-network': 'maticusdt',
    polygon: 'maticusdt'
  };
  // Reverse map: binance symbol (upper, e.g. BTCUSDT) -> coin id.
  const SYMBOL_TO_ID = {};
  Object.keys(BINANCE_SYMBOLS).forEach((id) => {
    SYMBOL_TO_ID[BINANCE_SYMBOLS[id].toUpperCase()] = id;
  });

  const subscribers = new Set();     // fns receiving every tick
  const latest = new Map();          // coin id -> last tick
  let ws = null;
  let pollTimer = null;
  let activeIds = [];
  let usingFallback = false;

  function notify(tick) {
    latest.set(tick.id, tick);
    subscribers.forEach((fn) => {
      try { fn(tick); } catch (e) { /* ignore listener error */ }
    });
  }

  function openSocket(ids) {
    const streams = ids
      .map((id) => BINANCE_SYMBOLS[id])
      .filter(Boolean)
      .map((sym) => sym + '@ticker');
    if (!streams.length) return startFallback(ids);

    const url = 'wss://stream.binance.com:9443/stream?streams=' + streams.join('/');
    try {
      ws = new WebSocket(url);
    } catch (e) {
      return startFallback(ids);
    }

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        const d = msg.data;
        if (!d || !d.s) return;
        const id = SYMBOL_TO_ID[d.s];
        if (!id) return;
        notify({
          id,
          symbol: d.s.replace('USDT', ''),
          price: parseFloat(d.c),        // last price
          changePercent: parseFloat(d.P) // 24h percent change
        });
      } catch (e) { /* ignore malformed frame */ }
    };

    ws.onerror = () => { if (!usingFallback) startFallback(ids); };
    ws.onclose = () => {
      // Attempt one reconnect after a short delay, else fall back.
      if (!usingFallback && activeIds.length) {
        setTimeout(() => { if (ws && ws.readyState === WebSocket.CLOSED) startFallback(activeIds); }, 3000);
      }
    };
  }

  // REST polling fallback using the shared market API.
  function startFallback(ids) {
    usingFallback = true;
    if (ws) { try { ws.close(); } catch (e) {} ws = null; }
    if (pollTimer) clearInterval(pollTimer);

    async function poll() {
      if (!global.CryptoHubAPI) return;
      try {
        const { coins } = await global.CryptoHubAPI.getMarkets(ids);
        coins.forEach((c) => notify({
          id: c.id,
          symbol: c.symbol,
          price: c.price,
          changePercent: c.change24h
        }));
      } catch (e) { /* ignore */ }
    }
    poll();
    pollTimer = setInterval(poll, 5000);
  }

  /**
   * Begin streaming prices for the given coin ids.
   * @param {string[]} ids internal coin ids (bitcoin, ethereum, ...)
   */
  function start(ids) {
    activeIds = ids.slice();
    usingFallback = false;
    if (typeof WebSocket === 'undefined') return startFallback(ids);
    openSocket(ids);
  }

  function stop() {
    activeIds = [];
    if (ws) { try { ws.close(); } catch (e) {} ws = null; }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  /** Subscribe to every tick. Returns an unsubscribe fn. */
  function subscribe(fn) {
    if (typeof fn === 'function') {
      subscribers.add(fn);
      // Replay latest known values immediately.
      latest.forEach((tick) => { try { fn(tick); } catch (e) {} });
    }
    return () => subscribers.delete(fn);
  }

  function isFallback() { return usingFallback; }
  function supported(id) { return !!BINANCE_SYMBOLS[id]; }

  global.CryptoHubRealtime = { start, stop, subscribe, isFallback, supported, BINANCE_SYMBOLS };
})(window);
