/*
 * CryptoHub - Shared App Bootstrap
 * ------------------------------------------------------------------
 * Loaded on every page. Wires up the global "Connect Wallet" button
 * and exposes small helpers for showing a live/offline data badge and
 * toast notifications. Keep this framework-free and side-effect light.
 */
(function (global) {
  'use strict';

  const Wallet = global.CryptoHubWallet;

  function toast(message, type = 'info') {
    let host = document.getElementById('ch-toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'ch-toast-host';
      host.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:5000;display:flex;flex-direction:column;gap:10px;';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    const colors = { info: '#6c5ce7', success: '#00b894', error: '#ff7675', warning: '#fdcb6e' };
    el.textContent = message;
    el.style.cssText = `background:${colors[type] || colors.info};color:#fff;padding:12px 18px;border-radius:12px;` +
      'box-shadow:0 8px 24px rgba(0,0,0,.35);font-family:Poppins,sans-serif;font-size:.95rem;max-width:320px;' +
      'opacity:0;transform:translateY(10px);transition:all .3s ease;';
    host.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(10px)';
      setTimeout(() => el.remove(), 300);
    }, 3800);
  }

  function updateWalletButtons(walletState) {
    // Any element with [data-connect-wallet] becomes the connect/disconnect control.
    document.querySelectorAll('[data-connect-wallet]').forEach((btn) => {
      if (walletState.connected) {
        btn.textContent = Wallet.shorten(walletState.account);
        btn.title = walletState.chainName || '';
        btn.classList.add('wallet-connected');
      } else {
        btn.textContent = btn.dataset.label || 'Connect Wallet';
        btn.classList.remove('wallet-connected');
      }
    });
    // Elements that display live balance.
    document.querySelectorAll('[data-wallet-balance]').forEach((el) => {
      el.textContent = walletState.connected && walletState.balance != null
        ? walletState.balance.toFixed(4) + ' ETH'
        : '--';
    });
  }

  async function connectWalletConnect() {
    try {
      const result = await Wallet.connectWalletConnect();
      toast('Connected: ' + Wallet.shorten(result.account), 'success');
    } catch (err) {
      if (err.code === 'NO_WC_PROJECT') {
        toast('WalletConnect not configured on this site.', 'warning');
      } else if (err.code === 4001) {
        toast('Connection request rejected.', 'error');
      } else {
        toast('WalletConnect error: ' + err.message, 'error');
      }
    }
  }

  async function handleConnectClick() {
    if (!Wallet) return;
    const s = Wallet.getState();
    if (s.connected) {
      Wallet.disconnect();
      toast('Wallet disconnected', 'info');
      return;
    }
    // Prefer an injected wallet (MetaMask). If none is present, fall back
    // to WalletConnect (mobile) when it's configured; otherwise guide the
    // user to install MetaMask.
    if (Wallet.hasInjected && !Wallet.hasInjected()) {
      if (Wallet.walletConnectAvailable && Wallet.walletConnectAvailable()) {
        return connectWalletConnect();
      }
      toast('No wallet detected. Install MetaMask or scan with a mobile wallet.', 'warning');
      window.open('https://metamask.io/download/', '_blank', 'noopener');
      return;
    }
    try {
      const result = await Wallet.connect();
      toast('Connected: ' + Wallet.shorten(result.account), 'success');
    } catch (err) {
      if (err.code === 'NO_PROVIDER') {
        // No injected provider — try WalletConnect if available.
        if (Wallet.walletConnectAvailable && Wallet.walletConnectAvailable()) {
          return connectWalletConnect();
        }
        toast('No wallet detected. Install MetaMask to connect.', 'warning');
        window.open('https://metamask.io/download/', '_blank', 'noopener');
      } else if (err.code === 4001) {
        toast('Connection request rejected.', 'error');
      } else {
        toast('Wallet error: ' + err.message, 'error');
      }
    }
  }

  // Allow pages to trigger WalletConnect explicitly (e.g. a dedicated button).
  function initWalletConnectButtons() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-walletconnect]');
      if (btn) { e.preventDefault(); connectWalletConnect(); }
    });
  }

  // Make the generic "Search coins..." bars functional: pressing Enter routes
  // to the Prices page with the term as ?q=, where the live table filters.
  // Pages that own their own search (index, prices — id="searchInput") keep it.
  function pricesHref() {
    // Resolve the correct relative path whether we're at the site root or in /pages/.
    return location.pathname.includes('/pages/') ? 'prices.html' : 'pages/prices.html';
  }
  function isCoinSearchInput(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    if (el.id === 'searchInput') return false; // page-owned functional search
    const ph = (el.getAttribute('placeholder') || '').toLowerCase();
    return ph.includes('search coins');
  }
  function initGlobalSearch() {
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const el = e.target;
      if (!isCoinSearchInput(el)) return;
      const term = el.value.trim();
      if (!term) return;
      e.preventDefault();
      window.location.href = pricesHref() + '?q=' + encodeURIComponent(term);
    });
  }

  function initWallet() {
    if (!Wallet) return;
    Wallet.onChange(updateWalletButtons);
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-connect-wallet]');
      if (btn) { e.preventDefault(); handleConnectClick(); }
    });
    Wallet.restore();
    updateWalletButtons(Wallet.getState());
    initWalletConnectButtons();
  }

  function setDataBadge(live, label) {
    document.querySelectorAll('[data-live-badge]').forEach((el) => {
      el.textContent = label || (live ? '● Live' : '● Offline (cached)');
      el.style.color = live ? '#00b894' : '#fdcb6e';
    });
  }

  // Inject the flash keyframes once.
  function ensureFlashStyles() {
    if (document.getElementById('ch-flash-styles')) return;
    const style = document.createElement('style');
    style.id = 'ch-flash-styles';
    style.textContent =
      '@keyframes ch-flash-up{0%{background:rgba(0,184,148,.45)}100%{background:transparent}}' +
      '@keyframes ch-flash-down{0%{background:rgba(255,118,117,.45)}100%{background:transparent}}' +
      '.ch-up{animation:ch-flash-up .7s ease}.ch-down{animation:ch-flash-down .7s ease}' +
      '.ch-tick{transition:color .2s ease}';
    document.head.appendChild(style);
  }

  /**
   * Update a price element with a brief green/red flash based on direction.
   * @param {Element} el target element
   * @param {number} newPrice new numeric price
   * @param {string} text formatted price string to display
   */
  function flashPrice(el, newPrice, text) {
    if (!el) return;
    ensureFlashStyles();
    const prev = parseFloat(el.dataset.rawPrice);
    el.dataset.rawPrice = String(newPrice);
    el.textContent = text;
    if (!isNaN(prev) && prev !== newPrice) {
      const cls = newPrice > prev ? 'ch-up' : 'ch-down';
      el.classList.remove('ch-up', 'ch-down');
      // Force reflow so the animation restarts on rapid ticks.
      void el.offsetWidth;
      el.classList.add(cls);
    }
  }

  document.addEventListener('DOMContentLoaded', initWallet);
  // Global search routing is independent of the wallet module, so wire it
  // separately (works even on pages without the wallet loaded).
  document.addEventListener('DOMContentLoaded', initGlobalSearch);

  global.CryptoHubApp = { toast, setDataBadge, updateWalletButtons, flashPrice, connectWalletConnect };
})(window);
