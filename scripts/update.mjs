// scripts/update.mjs
// Fetches market data server-side (GitHub Actions) with two sources:
// - Stooq (CSV, no API key): indices, FX, commodities, US stocks
// - CoinGecko (JSON, no API key): crypto
// Writes ../bar-data.json. Never fails the workflow.

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ====== Symbols to fetch from Stooq (CSV) ======
// Tip: Use broadly-available symbols so you always get something.
// If a symbol is unknown, it's skipped quietly.
const STOOQ_SYMBOLS = [
  "^spx",     // S&P 500
  "^ndx",     // NASDAQ 100
  "^dji",     // Dow Jones
  "gc.f",     // Gold futures
  "cl.f",     // Crude Oil (WTI) futures
  "si.f",     // Silver futures
  "aapl.us",  // Apple
  "msft.us"   // Microsoft
  // You can try "usdinr" (USD/INR), but if Stooq doesn't have it, it will be skipped.
];

// Friendly display names
const FRIENDLY = {
  "^spx": "S&P 500",
  "^ndx": "NASDAQ 100",
  "^dji": "Dow Jones",
  "gc.f": "Gold",
  "cl.f": "Crude Oil",
  "si.f": "Silver",
  "aapl.us": "Apple",
  "msft.us": "Microsoft",
  "BTC-USD": "Bitcoin",
  "ETH-USD": "Ethereum"
};

// ====== Crypto from CoinGecko ======
const COINS = [
  { id: "bitcoin", symbol: "BTC-USD", name: "Bitcoin" },
  { id: "ethereum", symbol: "ETH-USD", name: "Ethereum" }
];

function toISTISOString(date = new Date()) {
  const ist = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false
  }).format(date);
  const [dmy, hms] = ist.split(", ");
  const [dd, mm, yyyy] = dmy.split("/");
  return `${yyyy}-${mm}-${dd}T${hms}+05:30`;
}

// ---------- ST0OQ (CSV) ----------
async function fetchStooqCsv(symbols) {
  // CSV fields: s,d2,t2,o,h,l,c,v  (symbol,date,time,open,high,low,close,volume)
  const f = "sd2t2ohlcv"; // without spaces
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(symbols.join(","))}&f=${f}&h&e=csv`;

  const res = await fetch(url, { headers: { Accept: "text/csv" } });
  if (!res.ok) throw new Error(`Stooq ${res.status} ${res.statusText}`);
  const csv = await res.text();

  // Parse CSV (very small; simple parser)
  const lines = csv.trim().split(/\r?\n/);
  const header = lines.shift()?.split(",").map(h => h.trim().toLowerCase()) || [];
  const idx = (k) => header.indexOf(k);

  const out = [];
  for (const line of lines) {
    const cols = line.split(",").map(x => x.trim());
    const symRaw = (cols[idx("symbol")] || "").toLowerCase();
    const name = FRIENDLY[symRaw] || cols[idx("symbol")] || symRaw;
    const open = num(cols[idx("open")]);
    const close = num(cols[idx("close")]);

    if (close == null || isNaN(close)) continue; // skip unknowns

    // Intraday change from Open→Close (fallback because Stooq CSV doesn't include previous close)
    const chg = (open != null && open !== 0) ? (close - open) : 0;
    const pct = (open != null && open !== 0) ? (chg / open) * 100 : 0;

    out.push({
      symbol: symRaw,
      name,
      price: close,
      change: chg,
      changePercent: pct,
      marketState: "REGULAR"
    });
  }
  return out;
}

function num(x) {
  if (x == null) return null;
  const n = Number(String(x).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// ---------- COINGECKO ----------
async function fetchCoinGecko(coins) {
  const ids = coins.map(c => c.id).join(",");
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd&include_24hr_change=true`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`CoinGecko ${res.status} ${res.statusText}`);
  const j = await res.json();

  return coins.map(c => {
    const row = j?.[c.id];
    if (!row) return null;
    return {
      symbol: c.symbol,
      name: c.name,
      price: Number(row.usd),
      change: Number(row.usd_24h_change ?? 0),
      changePercent: Number(row.usd_24h_change ?? 0),
      marketState: "CRYPTO"
    };
  }).filter(Boolean);
}

// ---------- MAIN ----------
async function main() {
  const results = await Promise.allSettled([
    fetchStooqCsv(STOOQ_SYMBOLS),
    fetchCoinGecko(COINS)
  ]);

  const stooqItems = Array.isArray(results[0].value) ? results[0].value : [];
  const cgItems = Array.isArray(results[1].value) ? results[1].value : [];

  const items = [...stooqItems, ...cgItems];
  const payload = { updatedAt: toISTISOString(), items };

  const out = resolve(__dirname, "../bar-data.json");
  await writeFile(out, JSON.stringify(payload, null, 2), "utf8");
  console.log(`Wrote ${items.length} items at ${payload.updatedAt}`);
}

main().catch(async (err) => {
  console.error("Non-fatal:", err.message);
  const out = resolve(__dirname, "../bar-data.json");
  const payload = { updatedAt: toISTISOString(), items: [] };
  try { await writeFile(out, JSON.stringify(payload, null, 2), "utf8"); } catch {}
  // Do not fail the job
});
