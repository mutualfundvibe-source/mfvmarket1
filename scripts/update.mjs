// scripts/update.mjs
// Server-side updater: pulls quotes from Stooq (no key) + CoinGecko (no key)
// Writes ../bar-data.json for your Netlify bar to read.

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Stooq symbols (reliable & free):
// ^SPX = S&P 500, ^NDX = NASDAQ 100, USDINR, GC.F = Gold futures, AAPL.US, MSFT.US
const STOOQ_SYMBOLS = ["^spx", "^ndx", "usdinr", "gc.f", "aapl.us", "msft.us"];

// Crypto from CoinGecko (no key)
const COINS = [
  { id: "bitcoin", symbol: "BTC-USD", name: "Bitcoin" },
  { id: "ethereum", symbol: "ETH-USD", name: "Ethereum" }
];

const FRIENDLY = {
  "^spx": "S&P 500",
  "^ndx": "NASDAQ 100",
  "usdinr": "USD/INR",
  "gc.f": "Gold",
  "aapl.us": "Apple",
  "msft.us": "Microsoft",
  "BTC-USD": "Bitcoin",
  "ETH-USD": "Ethereum"
};

function toISTISOString(date = new Date()) {
  const ist = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  }).format(date);
  const [dmy, hms] = ist.split(", ");
  const [dd, mm, yyyy] = dmy.split("/");
  return `${yyyy}-${mm}-${dd}T${hms}+05:30`;
}

async function fetchStooq(symbols) {
  // Stooq JSON: https://stooq.com/q/l/?s=...&f=sd2t2ohlc vp &e=json
  // We request previous close (p) to compute % change.
  const f = "sd2t2ohlc vp".replace(/\s+/g, ""); // sd2t2ohlcvp
  const base = "https://stooq.com/q/l/";
  const url = `${base}?s=${encodeURIComponent(symbols.join(","))}&f=${f}&h&e=json`;
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`Stooq ${r.status} ${r.statusText}`);
  const j = await r.json();
  // Expected shape: { data: [ { symbol, name, date, time, open, high, low, close, volume, previous }, ... ] }
  const rows = j?.data || [];
  return rows
    .map((q) => {
      const sym = (q.symbol || "").toLowerCase();
      const px = q.close != null ? Number(q.close) : null;
      const prev = q.previous != null ? Number(q.previous) : null;
      const chg = px != null && prev != null ? px - prev : 0;
      const pct = px != null && prev != null && prev !== 0 ? (chg / prev) * 100 : 0;
      return {
        symbol: sym,
        name: FRIENDLY[sym] || q.name || q.symbol,
        price: px,
        change: chg,
        changePercent: pct,
        marketState: "REGULAR"
      };
    })
    .filter((x) => x.price != null);
}

async function fetchCoinGecko(coins) {
  const ids = coins.map((c) => c.id).join(",");
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(
    ids
  )}&vs_currencies=usd&include_24hr_change=true`;
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`CoinGecko ${r.status} ${r.statusText}`);
  const j = await r.json();
  return coins
    .map((c) => {
      const row = j?.[c.id];
      if (!row) return null;
      return {
        symbol: c.symbol,
        name: c.name,
        price: Number(row.usd),
        change: Number(row.usd_24h_change ?? 0),
        changePercent: Number(row.usd_24h_change ?? 0), // already percent
        marketState: "CRYPTO"
      };
    })
    .filter(Boolean);
}

async function main() {
  const [stooq, cg] = await Promise.allSettled([
    fetchStooq(STOOQ_SYMBOLS),
    fetchCoinGecko(COINS)
  ]);

  const items = [
    ...(Array.isArray(stooq.value) ? stooq.value : []),
    ...(Array.isArray(cg.value) ? cg.value : [])
  ];

  const payload = { updatedAt: toISTISOString(), items };
  const out = resolve(__dirname, "../bar-data.json");
  await writeFile(out, JSON.stringify(payload, null, 2), "utf8");
  console.log(`Wrote ${items.length} items at ${payload.updatedAt}`);
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("Non-fatal:", err.message);
    const out = resolve(__dirname, "../bar-data.json");
    const payload = { updatedAt: toISTISOString(), items: [] };
    try { await writeFile(out, JSON.stringify(payload, null, 2), "utf8"); } catch {}
    process.exit(0);
  });
