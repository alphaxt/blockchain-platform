/*
 * CryptoHub - Web3 Wallet Module
 * ------------------------------------------------------------------
 * Real MetaMask / EIP-1193 wallet integration. Handles connecting,
 * reading the account + native balance, chain switching, and reacts
 * to account/chain changes. Persists the "connected" intent so the
 * UI can restore state on reload.
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'cryptohub_wallet_connected';

  const CHAINS = {
    '0x1':      'Ethereum Mainnet',
    '0x5':      'Goerli Testnet',
    '0xaa36a7': 'Sepolia Testnet',
    '0x89':     'Polygon',
    '0x38':     'BNB Smart Chain',
    '0xa4b1':   'Arbitrum One',
    '0xa':      'Optimism'
  };

  const listeners = [];
  let state = { connected: false, account: null, chainId: null, chainName: null, balance: null };

  function hasProvider() {
    return typeof global.ethereum !== 'undefined';
  }

  function emit() {
    listeners.forEach((fn) => {
      try { fn(Object.assign({}, state)); } catch (e) { /* ignore listener errors */ }
    });
  }

  function shorten(address) {
    if (!address) return '';
    return address.slice(0, 6) + '...' + address.slice(-4);
  }

  function weiToEth(hexWei) {
    if (!hexWei) return 0;
    return parseInt(hexWei, 16) / 1e18;
  }

  async function refreshBalance() {
    if (!hasProvider() || !state.account) return;
    try {
      const balance = await global.ethereum.request({
        method: 'eth_getBalance',
        params: [state.account, 'latest']
      });
      state.balance = weiToEth(balance);
    } catch (e) {
      state.balance = null;
    }
  }

  async function syncChain() {
    if (!hasProvider()) return;
    try {
      const chainId = await global.ethereum.request({ method: 'eth_chainId' });
      state.chainId = chainId;
      state.chainName = CHAINS[chainId] || ('Chain ' + parseInt(chainId, 16));
    } catch (e) { /* ignore */ }
  }

  /**
   * Connect to the injected wallet. Prompts the user to select an account.
   * @returns {Promise<object>} the resulting wallet state.
   */
  async function connect() {
    if (!hasProvider()) {
      const err = new Error('No Web3 wallet found. Please install MetaMask.');
      err.code = 'NO_PROVIDER';
      throw err;
    }
    const accounts = await global.ethereum.request({ method: 'eth_requestAccounts' });
    if (!accounts || !accounts.length) throw new Error('No accounts authorized.');

    state.connected = true;
    state.account = accounts[0];
    await syncChain();
    await refreshBalance();
    localStorage.setItem(STORAGE_KEY, '1');
    emit();
    return Object.assign({}, state);
  }

  function disconnect() {
    state = { connected: false, account: null, chainId: null, chainName: null, balance: null };
    localStorage.removeItem(STORAGE_KEY);
    emit();
  }

  /** Attempt to silently restore a prior connection on page load. */
  async function restore() {
    if (!hasProvider() || localStorage.getItem(STORAGE_KEY) !== '1') return;
    try {
      const accounts = await global.ethereum.request({ method: 'eth_accounts' });
      if (accounts && accounts.length) {
        state.connected = true;
        state.account = accounts[0];
        await syncChain();
        await refreshBalance();
        emit();
      }
    } catch (e) { /* ignore */ }
  }

  /** Request the wallet switch to a given chain (adds if unknown). */
  async function switchChain(chainId) {
    if (!hasProvider()) throw new Error('No Web3 wallet found.');
    await global.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId }]
    });
    await syncChain();
    await refreshBalance();
    emit();
  }

  function onChange(fn) {
    if (typeof fn === 'function') listeners.push(fn);
    return () => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  // React to wallet-level events.
  if (hasProvider()) {
    global.ethereum.on('accountsChanged', async (accounts) => {
      if (!accounts.length) return disconnect();
      state.account = accounts[0];
      await refreshBalance();
      emit();
    });
    global.ethereum.on('chainChanged', async () => {
      await syncChain();
      await refreshBalance();
      emit();
    });
  }

  global.CryptoHubWallet = {
    connect,
    disconnect,
    restore,
    switchChain,
    onChange,
    hasProvider,
    shorten,
    getState: () => Object.assign({}, state),
    CHAINS
  };
})(window);
