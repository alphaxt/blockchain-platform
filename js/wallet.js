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
    localStorage.removeItem('cryptohub_session_token'); // end backend session too
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

  // --- Backend session (Sign-In With Ethereum) -----------------------
  const TOKEN_KEY = 'cryptohub_session_token';

  /** The stored bearer token for the current session, if any. */
  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || null;
  }

  function isLoggedIn() {
    return !!getToken();
  }

  /**
   * Prove control of the connected address to the backend: fetch a nonce,
   * personal_sign it, and exchange the signature for a session token that
   * scopes the watchlist/portfolio APIs to this wallet.
   * Only works when served over http(s) (needs the backend).
   * @returns {Promise<{address:string, token:string, expires:number}>}
   */
  async function login() {
    if (!location.protocol.startsWith('http')) throw new Error('Sign-in requires the backend server.');
    if (!state.account) throw new Error('Connect a wallet first.');
    const nonceRes = await fetch('/api/auth/nonce?address=' + encodeURIComponent(state.account));
    if (!nonceRes.ok) throw new Error('Could not start sign-in.');
    const { message } = await nonceRes.json();
    const signature = await signMessage(message);
    const verifyRes = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: state.account, signature })
    });
    const data = await verifyRes.json();
    if (!verifyRes.ok) throw new Error(data.error || 'Sign-in failed.');
    localStorage.setItem(TOKEN_KEY, data.token);
    emit();
    return data;
  }

  /** Clear the backend session (does not disconnect the wallet). */
  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    emit();
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

  // --- On-chain swap: native ETH <-> Wrapped ETH (WETH) ----------------
  // A real, key-less swap that works through any EIP-1193 provider by
  // calling the canonical WETH9 contract directly. Wrapping ETH->WETH is
  // deposit() (payable); unwrapping WETH->ETH is withdraw(uint256).
  // Canonical WETH (or wrapped-native) contract per chain.
  const WETH_ADDRESSES = {
    '0x1':      '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // Ethereum WETH9
    '0xaa36a7': '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14', // Sepolia WETH
    '0x5':      '0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6', // Goerli WETH
    '0x89':     '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // Polygon WMATIC
    '0x38':     '0xBB4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // BSC WBNB
    '0xa4b1':   '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // Arbitrum WETH
    '0xa':      '0x4200000000000000000000000000000000000006'  // Optimism WETH
  };
  // Wrapped-native symbol per chain (for accurate UI labels).
  const WRAPPED_SYMBOL = { '0x89': 'WMATIC', '0x38': 'WBNB' };

  const WETH_SELECTORS = {
    deposit:   '0xd0e30db0',                                           // deposit()
    withdraw:  '0x2e1a7d4d',                                           // withdraw(uint256)
    balanceOf: '0x70a08231'                                            // balanceOf(address)
  };

  function wethAddress() {
    const addr = WETH_ADDRESSES[state.chainId];
    if (!addr) throw new Error('Swaps are not supported on this network.');
    return addr;
  }

  /** Symbol shown for the wrapped token on the current chain (WETH by default). */
  function wrappedSymbol() {
    return WRAPPED_SYMBOL[state.chainId] || 'WETH';
  }

  function pad32(hexNo0x) {
    return hexNo0x.padStart(64, '0');
  }

  /**
   * Wrap native ETH into WETH by calling WETH9.deposit() with value.
   * @param {string|number} amountEth amount of ETH to wrap
   * @returns {Promise<string>} transaction hash
   */
  async function wrapEth(amountEth) {
    if (!hasProvider()) throw new Error('No Web3 wallet found.');
    if (!state.account) throw new Error('Connect a wallet first.');
    const amt = Number(amountEth);
    if (isNaN(amt) || amt <= 0) throw new Error('Enter a valid amount.');
    const txHash = await global.ethereum.request({
      method: 'eth_sendTransaction',
      params: [{ from: state.account, to: wethAddress(), value: ethToWeiHex(amountEth), data: WETH_SELECTORS.deposit }]
    });
    setTimeout(() => refreshBalance().then(emit), 3000);
    return txHash;
  }

  /**
   * Unwrap WETH back into native ETH by calling WETH9.withdraw(amount).
   * @param {string|number} amountEth amount of WETH to unwrap
   * @returns {Promise<string>} transaction hash
   */
  async function unwrapEth(amountEth) {
    if (!hasProvider()) throw new Error('No Web3 wallet found.');
    if (!state.account) throw new Error('Connect a wallet first.');
    const amt = Number(amountEth);
    if (isNaN(amt) || amt <= 0) throw new Error('Enter a valid amount.');
    const amountWeiHex = ethToWeiHex(amountEth).slice(2); // strip 0x
    const data = WETH_SELECTORS.withdraw + pad32(amountWeiHex);
    const txHash = await global.ethereum.request({
      method: 'eth_sendTransaction',
      params: [{ from: state.account, to: wethAddress(), data }]
    });
    setTimeout(() => refreshBalance().then(emit), 3000);
    return txHash;
  }

  /**
   * Read the connected account's WETH balance via eth_call (no tx, no gas).
   * @returns {Promise<number>} WETH balance in ether units
   */
  async function getWethBalance() {
    if (!hasProvider() || !state.account) return 0;
    try {
      const data = WETH_SELECTORS.balanceOf + pad32(state.account.toLowerCase().replace(/^0x/, ''));
      const hex = await global.ethereum.request({
        method: 'eth_call',
        params: [{ to: wethAddress(), data }, 'latest']
      });
      return weiToEth(hex);
    } catch (e) { return 0; }
  }

  /** Whether native<->wrapped swaps are available on the current chain. */
  function swapSupported() {
    return !!WETH_ADDRESSES[state.chainId];
  }

  /**
   * Convenience wrapper: swap in a direction with a single call.
   * @param {'wrap'|'unwrap'} direction
   * @param {string|number} amount
   */
  async function swap(direction, amount) {
    if (direction === 'wrap') return wrapEth(amount);
    if (direction === 'unwrap') return unwrapEth(amount);
    throw new Error('Unknown swap direction: ' + direction);
  }

  // React to wallet-level events.
  if (hasProvider()) {
    global.ethereum.on('accountsChanged', async (accounts) => {
      if (!accounts.length) return disconnect();
      state.account = accounts[0];
      localStorage.removeItem('cryptohub_session_token'); // token is bound to the old address
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
    login,
    logout,
    isLoggedIn,
    getToken,
    getTxCount,
    wrapEth,
    unwrapEth,
    swap,
    getWethBalance,
    swapSupported,
    wrappedSymbol,
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
