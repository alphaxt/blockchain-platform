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

  async function handleConnectClick() {
    if (!Wallet) return;
    const s = Wallet.getState();
    if (s.connected) {
      Wallet.disconnect();
      toast('Wallet disconnected', 'info');
      return;
    }
    try {
      const result = await Wallet.connect();
      toast('Connected: ' + Wallet.shorten(result.account), 'success');
    } catch (err) {
      if (err.code === 'NO_PROVIDER') {
        toast('No wallet detected. Install MetaMask to connect.', 'warning');
        window.open('https://metamask.io/download/', '_blank', 'noopener');
      } else if (err.code === 4001) {
        toast('Connection request rejected.', 'error');
      } else {
        toast('Wallet error: ' + err.message, 'error');
      }
    }
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
  }

  function setDataBadge(live) {
    document.querySelectorAll('[data-live-badge]').forEach((el) => {
      el.textContent = live ? '● Live' : '● Offline (cached)';
      el.style.color = live ? '#00b894' : '#fdcb6e';
    });
  }

  document.addEventListener('DOMContentLoaded', initWallet);

  global.CryptoHubApp = { toast, setDataBadge, updateWalletButtons };
})(window);
