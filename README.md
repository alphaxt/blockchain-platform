# CryptoHub — Full-Stack Blockchain Platform 🌐

A modern, multi-page cryptocurrency platform. It started as a pure static
frontend and now ships with **live market data**, **real Web3 wallet
integration**, and a **lightweight Node/Express backend API** — while staying
100% dependency-free on the frontend (no build step, no framework).

You can run it two ways:

- **Static** — open `index.html` directly; it fetches live prices from CoinGecko
  and falls back to a cached snapshot if offline.
- **Full-stack** — run the Express server, which serves the site and exposes a
  cached JSON API that proxies market data (avoids browser CORS/rate limits).

---

## ✨ Features

**Frontend UI**
- **Homepage** — hero section, trending coins with live prices, portfolio + allocation charts
- **Markets / Prices** — price tables and Chart.js visualizations
- **NFT Gallery**, **Wallet**, **Dashboard**, **Spot / Futures**, **Earn**
- **Blog & Community**, **API Docs**, **Help / FAQ**, **Profile**, **Legal & Privacy**
- Responsive design, dark theme, accessible helpers

**Live & real-time data**
- **Real-time price streaming** via Binance's public WebSocket (no API key) — sub-second ticks with green/red flash animation on the homepage and markets table
- REST market data (price, 24h change, market cap, volume, supply, ATH) from CoinGecko
- Live **global market stats** (total market cap, 24h volume, BTC dominance) and the **Fear & Greed Index**
- Real **7-day sparkline** charts per coin
- A live/offline status badge that reflects streaming vs. polling vs. cached mode
- Automatic fallback chain: WebSocket → REST polling → static snapshot, so the UI never breaks

**Web3 wallet**
- Real MetaMask / EIP-1193 connection (`eth_requestAccounts`)
- **WalletConnect** support for mobile wallets — scan a QR to pair (see setup below); the wallet module works against a pluggable provider, so injected and WalletConnect flows share the same code
- Shows the connected account, network name, and native ETH balance
- Reacts to account/chain changes and restores the session on reload
- Chain switching helper and toast notifications
- **Send native ETH** through the connected wallet (`eth_sendTransaction`), with precise wei conversion and a post-send balance refresh
- **On-chain swaps** — two real, key-less swap paths through the connected provider:
  - Wrap / unwrap native ETH ↔ WETH via the canonical WETH9 contract (`deposit()` / `withdraw(uint256)`), on 7 chains
  - Buy any ERC-20 with ETH via a Uniswap V2-style router (`getAmountsOut` quote → `swapExactETHForTokens` with a 1% slippage floor and a 20-minute deadline), on Ethereum, Sepolia, Polygon, BSC, and Arbitrum
  - Sell an ERC-20 back for ETH — checks the router allowance and sends an `approve` first when needed, then `swapExactTokensForETH`
  - An in-page **swap panel** (on the Wallet page) drives all of the above: pick a direction, enter a token + amount, choose slippage, and see a live quote with the minimum received before executing
- **Sign messages** with `personal_sign`
- **Block-explorer links** for the connected address and sent transactions, resolved per chain (Etherscan, Polygonscan, Arbiscan, and more)

**Wallet-based sign-in (Sign-In With Ethereum)**
- Prove control of an address by signing a server-issued nonce (`personal_sign`) — no passwords
- The server recovers the signer from the signature (secp256k1 + keccak256 via the audited `@noble/*` libraries) and issues an HMAC-signed session token
- Nonces are single-use and persisted in SQLite (with automatic expiry cleanup), and the token-signing secret is durable, so sign-in survives server restarts
- Signed-in users get their **own** persisted portfolio and watchlist; unauthenticated requests fall back to a shared `demo` scope

**Backend API (optional)**
- `GET /api/health` — service liveness
- `GET /api/markets?ids=bitcoin,ethereum` — cached live market data
- `GET /api/global` — cached global market stats
- `GET /api/coins/:id/chart?days=7` — historical prices
- `GET /api/auth/nonce` · `POST /api/auth/verify` · `GET /api/auth/me` · `POST /api/auth/refresh` — wallet sign-in and session refresh
- `GET|POST|DELETE /api/watchlist` — per-user watchlist persisted in SQLite
- `GET|POST|DELETE /api/portfolio` — per-user portfolio holdings persisted in SQLite, enriched with live prices and a computed USD total

**Persistence**
- Watchlist and portfolio holdings are stored in **SQLite** (`better-sqlite3`) at `server/cryptohub.db`, keyed by user, so they survive server restarts
- Falls back automatically to an in-memory store if the native SQLite module can't load, so the API works in any environment

---

## 💻 Tech Stack

| Layer      | Technology |
|------------|------------|
| Frontend   | HTML5, CSS3 (variables, Flexbox, Grid), Vanilla JavaScript |
| Charts     | Chart.js (CDN) |
| Icons/Fonts| Font Awesome 6, Google Fonts (Poppins + Orbitron) |
| Web3       | EIP-1193 provider (MetaMask) + WalletConnect (mobile) |
| Auth       | Sign-In With Ethereum (secp256k1 recovery via `@noble/curves` + `@noble/hashes`), HMAC session tokens |
| Market data| CoinGecko public API |
| Backend    | Node.js 18+, Express |
| Persistence| SQLite via better-sqlite3 (in-memory fallback) |
| Tests      | Built-in Node test runner (`node --test`) |

---

## 📂 Project Structure

```
blockchain-platform/
├── index.html              # Homepage (entry point)
├── pages/                  # All other pages (markets, wallet, nft, ...)
├── css/
│   ├── shared.css          # Shared tokens + site chrome (header/nav/footer/buttons)
│   └── <page>.css          # Per-page styles (index.css, dashboard.css, wallet.css, ...)
├── js/
│   ├── api.js              # Market data service (backend → CoinGecko → fallback)
│   ├── realtime.js         # Real-time price stream (Binance WebSocket + polling fallback)
│   ├── wallet.js           # Web3 / MetaMask wallet module
│   └── app.js              # Shared bootstrap (connect button, toasts, badges, price flash)
├── server/
│   ├── index.js            # Express API + static host
│   ├── db.js               # SQLite persistence (watchlist + portfolio holdings)
│   └── auth.js             # Wallet sign-in: signature recovery + session tokens
├── test/
│   ├── api.test.js         # API integration tests (node --test)
│   └── client.test.js      # Browser module tests (wallet.js, api.js)
├── package.json            # Scripts + dependencies
└── README.md
```

---

## 🚀 Getting Started

### Option 1 — Static (no install)

Open `index.html` in your browser, or serve the folder:

```bash
python -m http.server 8000   # then visit http://localhost:8000
```

Live prices load from CoinGecko directly; if unreachable, a cached snapshot is used.

### Option 2 — Full-stack (recommended)

Requires **Node.js 18+**.

```bash
npm install
npm start                    # serves site + API at http://localhost:3000
```

Development mode with auto-restart:

```bash
npm run dev
```

Then visit `http://localhost:3000`. The frontend automatically prefers the local
`/api/markets` endpoint when served over http(s).

### Running tests

Two suites run under the built-in Node test runner:
- **API integration** (`test/api.test.js`) — boots the Express app on an ephemeral
  port and exercises every endpoint, including the wallet sign-in flow and per-user
  data isolation. Network-backed routes tolerate upstream failures, so it passes offline too.
- **Browser modules** (`test/client.test.js`) — loads `js/wallet.js` and `js/api.js`
  into a fabricated browser global with stubbed `fetch` / `localStorage` / provider,
  covering wei & WETH calldata encoding, the provider abstraction, and the market-data
  fallback chain — no browser required.

```bash
npm test
```

Both suites run automatically on every push and pull request via GitHub Actions
(`.github/workflows/ci.yml`) on Node 18 and 20.

---

## 🔌 API Reference

| Method | Endpoint                     | Description                       |
|--------|------------------------------|-----------------------------------|
| GET    | `/api/health`                | Service status                    |
| GET    | `/api/markets?ids=…`         | Live market data (cached 30s)     |
| GET    | `/api/global`                | Global market stats (cached 60s)  |
| GET    | `/api/coins/:id/chart?days=` | Historical prices (cached 60s)    |
| GET    | `/api/auth/nonce?address=…`  | Issue a nonce + message to sign   |
| POST   | `/api/auth/verify`           | `{ address, signature }` → session token |
| GET    | `/api/auth/me`               | Who the `Bearer` token authenticates as |
| POST   | `/api/auth/refresh`          | Exchange a valid `Bearer` token for a fresh one |
| GET    | `/api/watchlist`             | Current watchlist (per-user)      |
| POST   | `/api/watchlist`             | Add `{ "id": "bitcoin" }`         |
| DELETE | `/api/watchlist/:id`         | Remove a coin                     |
| GET    | `/api/portfolio`             | Holdings + live prices + total    |
| POST   | `/api/portfolio`             | Upsert `{ "coinId": "…", "amount": 1.5 }` |
| DELETE | `/api/portfolio/:coinId`     | Remove a holding                  |

Watchlist and portfolio requests are scoped to the authenticated wallet when an
`Authorization: Bearer <token>` header is present; otherwise they operate on a
shared `demo` scope. Send `Content-Type: application/json` for the POST bodies.

### Real-time data sources (browser, no key required)

| Source                | Used for                                   |
|-----------------------|--------------------------------------------|
| Binance WebSocket     | Sub-second live price ticks (`js/realtime.js`) |
| CoinGecko REST        | Market snapshots, global stats, sparklines |
| alternative.me        | Fear & Greed Index (markets page)          |

---

## 🦊 Connecting a Wallet

1. Install [MetaMask](https://metamask.io/download/) (or use a mobile wallet via WalletConnect).
2. Click **Connect Wallet** in the header.
3. Approve the connection. Your shortened address, network, and ETH balance appear.

No injected wallet detected? The app falls back to WalletConnect when it's
configured, or links you to the MetaMask download page.

### Signing in (optional)

On the Wallet page, click **Sign in** to prove ownership of your address. This
signs a nonce (no gas, no transaction) and scopes your portfolio and watchlist
to your wallet on the backend. **Sign out** returns to the shared demo view.

### Enabling WalletConnect

WalletConnect needs a free project id from
[Reown Cloud](https://cloud.reown.com) (formerly WalletConnect Cloud). Provide it
in either of two ways before loading the page:

```html
<!-- in a page <head> -->
<meta name="walletconnect-project-id" content="YOUR_PROJECT_ID">
```

```js
// or set it globally before wallet.js runs
window.CRYPTOHUB_WC_PROJECT_ID = 'YOUR_PROJECT_ID';
```

Without a project id the WalletConnect option stays visible but shows a hint to
configure it — everything else keeps working.

## ⚙️ Configuration

| Variable | Purpose | Default |
|----------|---------|---------|
| `PORT` | Server port | `3000` |
| `AUTH_SECRET` | HMAC secret for signing session tokens | when unset, a random secret is generated and **persisted in SQLite** (`settings` table) so tokens survive restarts on a single instance; set it explicitly for multi-instance deploys |
| `walletconnect-project-id` / `window.CRYPTOHUB_WC_PROJECT_ID` | Enables WalletConnect (client-side) | unset |

---

## 🌐 Deployment

- **Static hosts** (GitHub Pages, Netlify, Vercel static) — deploy as-is; live
  data comes straight from CoinGecko.
- **Node hosts** (Render, Railway, Fly.io, a VPS) — run `npm start` to get the
  API + caching layer as well.

---

## 🎯 Future Enhancements

- Token → token swaps (routing through an intermediate pair); ETH ↔ token is supported in both directions today
- Price-impact percentage in the swap panel (live quote and configurable slippage are in place)

Each page now loads shared chrome from `css/shared.css` plus its own `css/<page>.css`;
only page-specific `:root` token overrides remain inline in the HTML.

---

## 📜 License

Licensed under the [MIT License](LICENSE).

---

**Developed by Muhammad Danish**
