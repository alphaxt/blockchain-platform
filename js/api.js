/*
 * CryptoHub - Market Data Service
 * ------------------------------------------------------------------
 * Fetches live cryptocurrency prices from the CoinGecko public API.
 * Falls back to a static snapshot when the network is unavailable so
 * the UI never breaks (e.g. when opened directly from the filesystem).
 */
(function (global) {
  'use strict';

  const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

  // Maps our internal coin ids to CoinGecko ids + display metadata.
  const COIN_META = {
    bitcoin:  { symbol: 'BTC',  icon: 'fab fa-bitcoin' },
    ethereum: { symbol: 'ETH',  icon: 'fab fa-ethereum' },
    cardano:  { symbol: 'ADA',  icon: 'fas fa-chart-line' },
    solana:   { symbol: 'SOL',  icon: 'fas fa-bolt' },
    ripple:   { symbol: 'XRP',  icon: 'fas fa-water' },
    dogecoin: { symbol: 'DOGE', icon: 'fas fa-dog' },
    polkadot: { symbol: 'DOT',  icon: 'fas fa-circle-nodes' },
    litecoin: { symbol: 'LTC',  icon: 'fas fa-coins' }
  };

  // Static fallback snapshot (used when the API can't be reached).
  const FALLBACK = [
    { id: 'bitcoin',  name: 'Bitcoin',  price: 61842.75, change24h: 3.2,  marketCap: 1.2e12, volume: 4.25e10, supply: 19.6e6,  ath: 69044.77 },
    { id: 'ethereum', name: 'Ethereum', price: 3412.56,  change24h: 1.8,  marketCap: 4.087e11, volume: 1.83e10, supply: 122.4e6, ath: 4891.70 },
    { id: 'cardano',  name: 'Cardano',  price: 0.4621,   change24h: -0.7, marketCap: 1.64e10, volume: 3.4e8,   supply: 35.5e9,  ath: 3.10 },
    { id: 'solana',   name: 'Solana',   price: 142.35,   change24h: 5.6,  marketCap: 6.32e10, volume: 2.8e9,   supply: 444.1e6, ath: 260.06 },
    { id: 'ripple',   name: 'Ripple',   price: 0.5328,   change24h: 0.9,  marketCap: 2.93e10, volume: 1.2e9,   supply: 55.0e9,  ath: 3.84 },
    { id: 'dogecoin', name: 'Dogecoin', price: 0.1285,   change24h: 2.4,  marketCap: 1.85e10, volume: 8.9e8,   supply: 144.2e9, ath: 0.7376 },
    { id: 'polkadot', name: 'Polkadot', price: 6.89,     change24h: -1.2, marketCap: 9.8e9,   volume: 2.4e8,   supply: 1.4e9,   ath: 55.00 },
    { id: 'litecoin', name: 'Litecoin', price: 78.42,    change24h: 0.4,  marketCap: 5.8e9,   volume: 4.2e8,   supply: 74.3e6,  ath: 412.96 }
  ];

  const DEFAULT_IDS = Object.keys(COIN_META);

  function withMeta(coin) {
    const meta = COIN_META[coin.id] || { symbol: coin.id.toUpperCase().slice(0, 4), icon: 'fas fa-coins' };
    return Object.assign({}, meta, coin);
  }

  /**
   * Fetch live market data for the given coin ids.
   * @param {string[]} [ids] CoinGecko coin ids.
   * @returns {Promise<{coins: object[], live: boolean}>}
   */
  function normalize(rows) {
    return rows.map((c) => withMeta({
      id: c.id,
      name: c.name,
      price: c.current_price,
      change24h: c.price_change_percentage_24h,
      marketCap: c.market_cap,
      volume: c.total_volume,
      supply: c.circulating_supply,
      ath: c.ath
    }));
  }

  async function fetchJson(url, ms = 8000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ms);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async function getMarkets(ids = DEFAULT_IDS) {
    // 1) Prefer our own backend when the app is served over http(s).
    if (location.protocol.startsWith('http')) {
      try {
        const data = await fetchJson(`/api/markets?ids=${ids.join(',')}`);
        if (data && Array.isArray(data.coins) && data.coins.length) {
          return { coins: normalize(data.coins), live: !!data.live };
        }
      } catch (e) { /* fall through to direct API */ }
    }

    // 2) Fall back to calling CoinGecko directly from the browser.
    try {
      const url = `${COINGECKO_BASE}/coins/markets?vs_currency=usd&ids=${ids.join(',')}` +
        '&order=market_cap_desc&sparkline=false&price_change_percentage=24h';
      const data = await fetchJson(url);
      return { coins: normalize(data), live: true };
    } catch (err) {
      // 3) Last resort: static snapshot so the UI still renders.
      console.warn('[CryptoHub] Live market data unavailable, using fallback snapshot:', err.message);
      return { coins: FALLBACK.map(withMeta), live: false };
    }
  }

  /**
   * Fetch historical prices for a single coin (for charts).
   * @param {string} id CoinGecko coin id.
   * @param {number} [days] Number of days of history.
   * @returns {Promise<number[]>}
   */
  async function getSparkline(id, days = 7) {
    const url = `${COINGECKO_BASE}/coins/${id}/market_chart?vs_currency=usd&days=${days}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return (data.prices || []).map((p) => p[1]);
    } catch (err) {
      // Generate a plausible random series as fallback.
      const base = (FALLBACK.find((c) => c.id === id) || {}).price || 100;
      return Array.from({ length: 24 }, () => base * (0.95 + Math.random() * 0.1));
    }
  }

  // Formatting helpers shared across pages.
  const format = {
    usd(n) {
      if (n == null || isNaN(n)) return '--';
      if (n >= 1) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
      return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 6 });
    },
    compact(n) {
      if (n == null || isNaN(n)) return '--';
      const units = [['T', 1e12], ['B', 1e9], ['M', 1e6], ['K', 1e3]];
      for (const [suffix, value] of units) {
        if (Math.abs(n) >= value) return '$' + (n / value).toFixed(2) + ' ' + suffix;
      }
      return '$' + n.toFixed(2);
    },
    percent(n) {
      if (n == null || isNaN(n)) return '--';
      return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
    }
  };

  /**
   * Fetch global market stats (total market cap, 24h volume, BTC dominance).
   * Prefers the local backend, then CoinGecko directly, then a fallback.
   * @returns {Promise<{marketCap:number, volume:number, btcDominance:number, marketCapChange:number, live:boolean}>}
   */
  async function getGlobal() {
    if (location.protocol.startsWith('http')) {
      try {
        const data = await fetchJson('/api/global');
        if (data && data.marketCap) return Object.assign({ live: true }, data);
      } catch (e) { /* fall through */ }
    }
    try {
      const data = await fetchJson(`${COINGECKO_BASE}/global`);
      const g = data.data;
      return {
        marketCap: g.total_market_cap.usd,
        volume: g.total_volume.usd,
        btcDominance: g.market_cap_percentage.btc,
        marketCapChange: g.market_cap_change_percentage_24h_usd,
        live: true
      };
    } catch (err) {
      return { marketCap: 2.36e12, volume: 9.85e10, btcDominance: 48.3, marketCapChange: 2.4, live: false };
    }
  }

  global.CryptoHubAPI = { getMarkets, getSparkline, getGlobal, format, COIN_META, FALLBACK };
})(window);
