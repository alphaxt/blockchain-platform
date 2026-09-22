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

**Live data**
- Real-time prices, 24h change, market cap, volume, supply, and ATH from the CoinGecko API
- Auto-refresh every 60s with a live/offline status badge
- Graceful fallback to a static snapshot so the UI never breaks

**Web3 wallet**
- Real MetaMask / EIP-1193 connection (`eth_requestAccounts`)
- Shows the connected account, network name, and native ETH balance
- Reacts to account/chain changes and restores the session on reload
- Chain switching helper and toast notifications

**Backend API (optional)**
- `GET /api/health` — service liveness
- `GET /api/markets?ids=bitcoin,ethereum` — cached live market data
- `GET /api/coins/:id/chart?days=7` — historical prices
- `GET|POST|DELETE /api/watchlist` — in-memory demo watchlist

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
│   ├── wallet.js           # Web3 / MetaMask wallet module
│   └── app.js              # Shared bootstrap (connect button, toasts, badges)
├── server/
│   └── index.js            # Express API + static host
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

---

## 🔌 API Reference

| Method | Endpoint                     | Description                       |
|--------|------------------------------|-----------------------------------|
| GET    | `/api/health`                | Service status                    |
| GET    | `/api/markets?ids=…`         | Live market data (cached 30s)     |
| GET    | `/api/coins/:id/chart?days=` | Historical prices (cached 60s)    |
| GET    | `/api/watchlist`             | Current watchlist                 |
| POST   | `/api/watchlist`             | Add `{ "id": "bitcoin" }`         |
| DELETE | `/api/watchlist/:id`         | Remove a coin                     |

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

- Persist the watchlist/portfolio to a real database
- WalletConnect support for mobile wallets
- On-chain transaction sending (send/swap) via the connected provider
- Server-side auth and per-user portfolios
- Extract remaining inline CSS/JS from individual pages into `css/` and `js/`

---

## 📜 License

Licensed under the [MIT License](LICENSE).

---

**Developed by Muhammad Danish**
