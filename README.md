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
- Shows the connected account, network name, and native ETH balance
- Reacts to account/chain changes and restores the session on reload
- Chain switching helper and toast notifications
- **Send native ETH** through the connected wallet (`eth_sendTransaction`), with precise wei conversion and a post-send balance refresh
- **Sign messages** with `personal_sign`
- **Block-explorer links** for the connected address and sent transactions, resolved per chain (Etherscan, Polygonscan, Arbiscan, and more)

**Backend API (optional)**
- `GET /api/health` — service liveness
- `GET /api/markets?ids=bitcoin,ethereum` — cached live market data
- `GET /api/global` — cached global market stats
- `GET /api/coins/:id/chart?days=7` — historical prices
- `GET|POST|DELETE /api/watchlist` — watchlist persisted in SQLite
- `GET|POST|DELETE /api/portfolio` — demo portfolio holdings persisted in SQLite, enriched with live prices and a computed USD total

**Persistence**
- Watchlist and portfolio holdings are stored in **SQLite** (`better-sqlite3`) at `server/cryptohub.db`, so they survive server restarts
- Falls back automatically to an in-memory store if the native SQLite module can't load, so the API works in any environment

---

## 💻 Tech Stack

| Layer      | Technology |
|------------|------------|
| Frontend   | HTML5, CSS3 (variables, Flexbox, Grid), Vanilla JavaScript |
| Charts     | Chart.js (CDN) |
| Icons/Fonts| Font Awesome 6, Google Fonts (Poppins + Orbitron) |
| Web3       | EIP-1193 provider (MetaMask) |
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
│   └── shared.css          # Shared design tokens + utility classes
├── js/
│   ├── api.js              # Market data service (backend → CoinGecko → fallback)
│   ├── realtime.js         # Real-time price stream (Binance WebSocket + polling fallback)
│   ├── wallet.js           # Web3 / MetaMask wallet module
│   └── app.js              # Shared bootstrap (connect button, toasts, badges, price flash)
├── server/
│   ├── index.js            # Express API + static host
│   └── db.js               # SQLite persistence (watchlist + portfolio holdings)
├── test/
│   └── api.test.js         # API integration tests (node --test)
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

The API has integration tests that boot the Express app on an ephemeral port and
exercise every endpoint. Network-backed routes tolerate upstream failures, so the
suite passes offline too.

```bash
npm test
```

---

## 🔌 API Reference

| Method | Endpoint                     | Description                       |
|--------|------------------------------|-----------------------------------|
| GET    | `/api/health`                | Service status                    |
| GET    | `/api/markets?ids=…`         | Live market data (cached 30s)     |
| GET    | `/api/global`                | Global market stats (cached 60s)  |
| GET    | `/api/coins/:id/chart?days=` | Historical prices (cached 60s)    |
| GET    | `/api/watchlist`             | Current watchlist (SQLite)        |
| POST   | `/api/watchlist`             | Add `{ "id": "bitcoin" }`         |
| DELETE | `/api/watchlist/:id`         | Remove a coin                     |
| GET    | `/api/portfolio?user=demo`   | Holdings + live prices + total    |
| POST   | `/api/portfolio`             | Upsert `{ "coinId": "…", "amount": 1.5 }` |
| DELETE | `/api/portfolio/:coinId`     | Remove a holding                  |

### Real-time data sources (browser, no key required)

| Source                | Used for                                   |
|-----------------------|--------------------------------------------|
| Binance WebSocket     | Sub-second live price ticks (`js/realtime.js`) |
| CoinGecko REST        | Market snapshots, global stats, sparklines |
| alternative.me        | Fear & Greed Index (markets page)          |

---

## 🦊 Connecting a Wallet

1. Install [MetaMask](https://metamask.io/download/).
2. Click **Connect Wallet** in the header.
3. Approve the connection. Your shortened address, network, and ETH balance appear.

No wallet installed? The app prompts you and links to the MetaMask download page.

---

## 🌐 Deployment

- **Static hosts** (GitHub Pages, Netlify, Vercel static) — deploy as-is; live
  data comes straight from CoinGecko.
- **Node hosts** (Render, Railway, Fly.io, a VPS) — run `npm start` to get the
  API + caching layer as well.

---

## 🎯 Future Enhancements

- WalletConnect support for mobile wallets
- On-chain swaps via the connected provider (native ETH sending is already supported)
- Server-side auth so portfolios are truly per-user (holdings are currently keyed by a `user` field, defaulting to `demo`)
- Extract remaining inline CSS/JS from individual pages into `css/` and `js/`

---

## 📜 License

Licensed under the [MIT License](LICENSE).

---

**Developed by Muhammad Danish**
