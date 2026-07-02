# CryptoHub — Blockchain Platform (Frontend) 🌐

A modern, multi-page blockchain platform frontend built with pure **HTML5, CSS3, and Vanilla JavaScript** — no frameworks, no build tools, no dependencies. Simulates a full crypto exchange UI with wallet management, NFT gallery, live-style market data, and more.

---

## ✨ Features

- **Homepage** — Hero section, feature highlights, and live crypto ticker
- **Markets** — Crypto price table with sorting and filtering
- **Prices** — Detailed coin price charts (Chart.js)
- **NFT Gallery** — Browsable NFT collection page
- **Wallet** — Crypto wallet simulation with balance display
- **Connect Wallet** — Wallet connection flow UI
- **Dashboard** — Portfolio overview and activity feed
- **Spot / Futures Trading** — Exchange-style order book UI
- **Earn** — Staking and yield farming section
- **Blog & Community** — Content and social engagement pages
- **API Docs** — Developer API documentation page
- **Help / FAQ** — Support and FAQ page
- **Profile** — User account page
- **Legal & Privacy** — Terms, privacy policy, and careers

---

## 💻 Tech Stack

- **HTML5** — Semantic markup, no framework
- **CSS3** — Custom properties (CSS variables), Flexbox, Grid, responsive design
- **Vanilla JavaScript** — All interactivity, no jQuery or React
- **Chart.js** — Price charts (loaded via CDN)
- **Font Awesome 6** — Icons (loaded via CDN)
- **Google Fonts** — Poppins + Orbitron typefaces

---

## 📂 Project Structure

```
blockchain-platform/
├── index.html              # Homepage (entry point)
├── pages/                  # All other pages
│   ├── about.html
│   ├── api.html
│   ├── blog.html
│   ├── community.html
│   ├── connectwallet.html
│   ├── crypto_card.html
│   ├── dashboard.html
│   ├── earn.html
│   ├── futures.html
│   ├── help.html
│   ├── legal_career.html
│   ├── markets.html
│   ├── nft.html
│   ├── prices.html
│   ├── privacy_terms.html
│   ├── profile.html
│   ├── spot.html
│   └── wallet.html
├── css/                    # (for future extracted stylesheets)
├── js/                     # (for future extracted scripts)
├── images/                 # Static image assets
└── README.md
```

---

## 🚀 Getting Started

This is a 100% static site — nothing to install or build.

**Option 1: Open directly**
```bash
git clone https://github.com/alphaxt/blockchain-platform.git
cd blockchain-platform
```
Then open `index.html` in your browser.

**Option 2: Local server (recommended)**

Avoids any browser security restrictions on local files:
```bash
# Python
python -m http.server 8000

# Node (no install needed)
npx serve
```
Then visit `http://localhost:8000`.

---

## 🌐 Deployment

This site is ready to deploy as-is to any static hosting platform:

- **GitHub Pages** — Enable in Settings → Pages → deploy from `main` branch
- **Vercel** — Import repo, no build command needed, output directory is `/`
- **Netlify** — Drag and drop the folder, or connect the repo

---

## 🎯 Future Enhancements

- Web3 wallet integration (MetaMask / WalletConnect)
- Real-time crypto data via CoinGecko or Binance API
- User authentication and persistent portfolio tracking
- Extract inline CSS/JS into dedicated `css/` and `js/` files

---

## 📜 License

This project is licensed under the [MIT License](LICENSE).

---

**Developed by Muhammad Danish**
