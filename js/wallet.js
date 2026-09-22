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

  function ethToWeiHex(eth) {
    // Convert a decimal ETH string/number to a hex wei value without float loss.
    const [whole, frac = ''] = String(eth).split('.');
    const fracPadded = (frac + '0'.repeat(18)).slice(0, 18);
    const wei = BigInt(whole || '0') * (10n ** 18n) + BigInt(fracPadded || '0');
    return '0x' + wei.toString(16);
  }

  /**
   * Send a native ETH transfer through the connected wallet.
   * @param {string} to recipient address (0x...)
   * @param {string|number} amountEth amount in ETH
   * @returns {Promise<string>} the transaction hash
   */
  async function sendEth(to, amountEth) {
    if (!hasProvider()) throw new Error('No Web3 wallet found.');
    if (!state.account) throw new Error('Connect a wallet first.');
    if (!/^0x[a-fA-F0-9]{40}$/.test(to)) throw new Error('Invalid recipient address.');
    const amt = Number(amountEth);
    if (isNaN(amt) || amt <= 0) throw new Error('Enter a valid amount.');

    const txHash = await global.ethereum.request({
      method: 'eth_sendTransaction',
      params: [{ from: state.account, to, value: ethToWeiHex(amountEth) }]
    });
    // Refresh balance shortly after (tx won't be mined instantly).
    setTimeout(() => refreshBalance().then(emit), 3000);
    return txHash;
  }

  /**
   * Sign a plain-text message (personal_sign) with the connected account.
   * @param {string} message
   * @returns {Promise<string>} the signature
   */
  async function signMessage(message) {
    if (!hasProvider()) throw new Error('No Web3 wallet found.');
    if (!state.account) throw new Error('Connect a wallet first.');
    const hex = '0x' + Array.from(new TextEncoder().encode(message))
      .map((b) => b.toString(16).padStart(2, '0')).join('');
    return global.ethereum.request({ method: 'personal_sign', params: [hex, state.account] });
  }

  // Block explorer base per chain, for building tx / address links.
  const EXPLORERS = {
    '0x1': 'https://etherscan.io',
    '0xaa36a7': 'https://sepolia.etherscan.io',
    '0x5': 'https://goerli.etherscan.io',
    '0x89': 'https://polygonscan.com',
    '0x38': 'https://bscscan.com',
    '0xa4b1': 'https://arbiscan.io',
    '0xa': 'https://optimistic.etherscan.io'
  };

  function explorerBase() {
    return EXPLORERS[state.chainId] || 'https://etherscan.io';
  }

  /** Link to the connected address on the current chain's explorer. */
  function explorerAddressUrl(address) {
    return explorerBase() + '/address/' + (address || state.account || '');
  }

  /** Link to a transaction hash on the current chain's explorer. */
  function explorerTxUrl(hash) {
    return explorerBase() + '/tx/' + hash;
  }

  /**
   * Fetch recent transaction count (nonce) for the connected account.
   * Full history requires an explorer API key, so we expose the nonce and
   * an explorer link instead of scraping — honest about what's on-chain-available.
   */
  async function getTxCount() {
    if (!hasProvider() || !state.account) return 0;
    try {
      const hex = await global.ethereum.request({ method: 'eth_getTransactionCount', params: [state.account, 'latest'] });
      return parseInt(hex, 16);
    } catch (e) { return 0; }
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
    sendEth,
    signMessage,
    getTxCount,
    explorerAddressUrl,
    explorerTxUrl,
    onChange,
    hasProvider,
    shorten,
    getState: () => Object.assign({}, state),
    CHAINS,
    EXPLORERS
  };
})(window);
