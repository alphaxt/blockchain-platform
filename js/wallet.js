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

  // The active EIP-1193 provider. Defaults to the injected wallet
  // (MetaMask etc.); WalletConnect swaps in its own provider at runtime.
  let activeProvider = (typeof global.ethereum !== 'undefined') ? global.ethereum : null;
  let providerKind = activeProvider ? 'injected' : null; // 'injected' | 'walletconnect'

  /** The provider all requests go through. Throws if none is available. */
  function provider() {
    if (!activeProvider) throw new Error('No Web3 wallet found.');
    return activeProvider;
  }

  function hasInjected() {
    return typeof global.ethereum !== 'undefined';
  }

  function hasProvider() {
    return !!activeProvider;
  }

  // Wire the standard EIP-1193 events on whichever provider is active.
  function bindProviderEvents(p) {
    if (!p || typeof p.on !== 'function') return;
    p.on('accountsChanged', async (accounts) => {
      if (!accounts || !accounts.length) return disconnect();
      state.account = accounts[0];
      localStorage.removeItem('cryptohub_session_token'); // token is bound to the old address
      await refreshBalance();
      emit();
    });
    p.on('chainChanged', async () => {
      await syncChain();
      await refreshBalance();
      emit();
    });
    p.on('disconnect', () => disconnect());
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
      const balance = await provider().request({
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
      const chainId = await provider().request({ method: 'eth_chainId' });
      state.chainId = chainId;
      state.chainName = CHAINS[chainId] || ('Chain ' + parseInt(chainId, 16));
    } catch (e) { /* ignore */ }
  }

  /**
   * Connect to the injected wallet (MetaMask etc.). Prompts the user to
   * select an account.
   * @returns {Promise<object>} the resulting wallet state.
   */
  async function connect() {
    if (!hasInjected()) {
      const err = new Error('No Web3 wallet found. Please install MetaMask.');
      err.code = 'NO_PROVIDER';
      throw err;
    }
    // Ensure the injected provider is the active one (in case WC was used before).
    activeProvider = global.ethereum;
    providerKind = 'injected';
    bindProviderEvents(activeProvider);

    const accounts = await provider().request({ method: 'eth_requestAccounts' });
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
    // Tear down a WalletConnect session if one is active.
    if (providerKind === 'walletconnect' && activeProvider && typeof activeProvider.disconnect === 'function') {
      try { activeProvider.disconnect(); } catch (e) { /* ignore */ }
    }
    // Reset the active provider back to the injected one (if present).
    activeProvider = hasInjected() ? global.ethereum : null;
    providerKind = activeProvider ? 'injected' : null;
    state = { connected: false, account: null, chainId: null, chainName: null, balance: null };
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('cryptohub_session_token'); // end backend session too
    emit();
  }

  /** Attempt to silently restore a prior injected connection on page load. */
  async function restore() {
    if (!hasInjected() || localStorage.getItem(STORAGE_KEY) !== '1') return;
    try {
      activeProvider = global.ethereum;
      providerKind = 'injected';
      const accounts = await provider().request({ method: 'eth_accounts' });
      if (accounts && accounts.length) {
        bindProviderEvents(activeProvider);
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
    await provider().request({
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

    const txHash = await provider().request({
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
    return provider().request({ method: 'personal_sign', params: [hex, state.account] });
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
      const hex = await provider().request({ method: 'eth_getTransactionCount', params: [state.account, 'latest'] });
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
    const txHash = await provider().request({
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
    const txHash = await provider().request({
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
      const hex = await provider().request({
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

  // --- DEX swap: native ETH -> ERC-20 token (Uniswap V2 router) --------
  // A real token-for-token swap through the connected provider, no API key
  // or SDK. We quote with router.getAmountsOut (eth_call) then execute
  // router.swapExactETHForTokens with a slippage-protected minimum out.
  // Selling tokens back needs an ERC-20 approve first, so this first cut
  // covers the ETH -> token direction (no approval required).
  const DEX_ROUTERS = {
    '0x1':    '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // Uniswap V2 (Ethereum)
    '0xaa36a7':'0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008', // Uniswap V2 (Sepolia)
    '0x89':   '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff', // QuickSwap (Polygon)
    '0x38':   '0x10ED43C718714eb63d5aA57B78B54704E256024E', // PancakeSwap (BSC)
    '0xa4b1': '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24'  // Uniswap V2 (Arbitrum)
  };
  const DEX_SELECTORS = {
    swapExactETHForTokens: '7ff36ab5', // (uint256 amountOutMin, address[] path, address to, uint256 deadline)
    getAmountsOut:         'd06ca61f'  // (uint256 amountIn, address[] path)
  };

  function dexRouter() {
    const addr = DEX_ROUTERS[state.chainId];
    if (!addr) throw new Error('Token swaps are not supported on this network.');
    return addr;
  }

  /** Whether ETH -> token DEX swaps are available on the current chain. */
  function dexSwapSupported() {
    return !!DEX_ROUTERS[state.chainId];
  }

  function uintHex32(nBig) {
    return nBig.toString(16).padStart(64, '0');
  }
  function addrHex32(a) {
    return a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  }
  function encodeAddressArray(addrs) {
    let out = uintHex32(BigInt(addrs.length));
    for (const a of addrs) out += addrHex32(a);
    return out;
  }

  /**
   * Quote how many output-token base units you'd receive for `amountEth`.
   * Uses router.getAmountsOut via eth_call (read-only, no gas).
   * @param {string} tokenOut ERC-20 address to receive
   * @param {string|number} amountEth ETH to spend
   * @returns {Promise<bigint>} output amount in the token's base units
   */
  async function getSwapQuote(tokenOut, amountEth) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(tokenOut)) throw new Error('Invalid token address.');
    const path = [wethAddress(), tokenOut];
    const amountInWei = BigInt(ethToWeiHex(amountEth));
    // getAmountsOut(amountIn, path): head = [amountIn][offset=0x40], then path.
    const data = '0x' + DEX_SELECTORS.getAmountsOut +
      uintHex32(amountInWei) + uintHex32(64n) + encodeAddressArray(path);
    const hex = await provider().request({
      method: 'eth_call',
      params: [{ to: dexRouter(), data }, 'latest']
    });
    // Returns uint256[] : [offset][length][amounts...]. Take the last amount.
    const body = hex.replace(/^0x/, '');
    const len = Number(BigInt('0x' + body.slice(64, 128)));
    if (!len) throw new Error('No liquidity route for this pair.');
    const lastStart = 128 + (len - 1) * 64;
    return BigInt('0x' + body.slice(lastStart, lastStart + 64));
  }

  /**
   * Swap native ETH for an ERC-20 token via the DEX router.
   * @param {string} tokenOut ERC-20 address to receive
   * @param {string|number} amountEth ETH to spend
   * @param {number} [slippagePct] max slippage tolerance (default 1%)
   * @returns {Promise<string>} transaction hash
   */
  async function swapEthForToken(tokenOut, amountEth, slippagePct = 1) {
    if (!hasProvider()) throw new Error('No Web3 wallet found.');
    if (!state.account) throw new Error('Connect a wallet first.');
    if (!/^0x[a-fA-F0-9]{40}$/.test(tokenOut)) throw new Error('Invalid token address.');
    const amt = Number(amountEth);
    if (isNaN(amt) || amt <= 0) throw new Error('Enter a valid amount.');

    // Quote, then apply slippage tolerance for amountOutMin.
    const quoted = await getSwapQuote(tokenOut, amountEth);
    const bps = BigInt(Math.round((100 - slippagePct) * 100)); // e.g. 1% -> 9900
    const amountOutMin = quoted * bps / 10000n;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60); // 20 min
    const path = [wethAddress(), tokenOut];

    // swapExactETHForTokens(amountOutMin, path, to, deadline): 4 head slots
    // (path is dynamic -> its slot holds offset 0x80), then path data.
    const data = '0x' + DEX_SELECTORS.swapExactETHForTokens +
      uintHex32(amountOutMin) +
      uintHex32(128n) +
      addrHex32(state.account) +
      uintHex32(deadline) +
      encodeAddressArray(path);

    const txHash = await provider().request({
      method: 'eth_sendTransaction',
      params: [{ from: state.account, to: dexRouter(), value: ethToWeiHex(amountEth), data }]
    });
    setTimeout(() => refreshBalance().then(emit), 3000);
    return txHash;
  }

  // --- WalletConnect (mobile wallets via QR / deep link) -------------
  // Build-free integration: the @walletconnect/ethereum-provider SDK is
  // lazy-loaded from a CDN as an ES module only when the user chooses
  // WalletConnect, so the rest of the app stays dependency-free. Needs a
  // free projectId from https://cloud.reown.com (formerly WalletConnect
  // Cloud); set it via window.CRYPTOHUB_WC_PROJECT_ID or the <meta> tag
  //   <meta name="walletconnect-project-id" content="...">
  const WC_PROVIDER_URL = 'https://esm.sh/@walletconnect/ethereum-provider@2.21.8';
  let wcProvider = null;

  function walletConnectProjectId() {
    if (global.CRYPTOHUB_WC_PROJECT_ID) return global.CRYPTOHUB_WC_PROJECT_ID;
    const meta = document.querySelector('meta[name="walletconnect-project-id"]');
    return (meta && meta.content) || '';
  }

  /** Whether WalletConnect can be offered (a projectId is configured). */
  function walletConnectAvailable() {
    return !!walletConnectProjectId();
  }

  /**
   * Connect via WalletConnect. Opens the QR modal so a mobile wallet can
   * scan and pair. Returns the resulting wallet state.
   */
  async function connectWalletConnect() {
    if (!location.protocol.startsWith('http')) {
      throw new Error('WalletConnect requires the site to be served over http(s).');
    }
    const projectId = walletConnectProjectId();
    if (!projectId) {
      const err = new Error('WalletConnect is not configured. Set a project id (see docs).');
      err.code = 'NO_WC_PROJECT';
      throw err;
    }
    // Lazy-load the SDK once.
    if (!wcProvider) {
      const mod = await import(/* webpackIgnore: true */ WC_PROVIDER_URL);
      const EthereumProvider = mod.EthereumProvider || (mod.default && mod.default.EthereumProvider) || mod.default;
      wcProvider = await EthereumProvider.init({
        projectId,
        showQrModal: true,
        // Chains we support switching to (mainnet + the L2s in CHAINS).
        optionalChains: [1, 5, 11155111, 137, 56, 42161, 10],
        metadata: {
          name: 'CryptoHub',
          description: 'CryptoHub — cryptocurrency platform',
          url: location.origin,
          icons: [location.origin + '/favicon.ico']
        }
      });
    }
    // Opens the QR modal and resolves once a wallet pairs.
    const accounts = await wcProvider.enable();
    if (!accounts || !accounts.length) throw new Error('No accounts authorized.');

    activeProvider = wcProvider;
    providerKind = 'walletconnect';
    bindProviderEvents(activeProvider);

    state.connected = true;
    state.account = accounts[0];
    await syncChain();
    await refreshBalance();
    localStorage.setItem(STORAGE_KEY, '1');
    emit();
    return Object.assign({}, state);
  }

  /** Which kind of provider is currently connected ('injected'|'walletconnect'|null). */
  function connectionKind() {
    return state.connected ? providerKind : null;
  }

  // React to events on the initially-injected provider (if present).
  bindProviderEvents(activeProvider);

  global.CryptoHubWallet = {
    connect,
    connectWalletConnect,
    walletConnectAvailable,
    connectionKind,
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
    swapEthForToken,
    getSwapQuote,
    dexSwapSupported,
    explorerAddressUrl,
    explorerTxUrl,
    onChange,
    hasProvider,
    hasInjected,
    shorten,
    getState: () => Object.assign({}, state),
    CHAINS,
    EXPLORERS
  };
})(window);
