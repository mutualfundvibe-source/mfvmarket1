// scripts/update.mjs
// Daily-stable updater:
// - Stooq per-symbol daily CSV (no key): last two closes -> change & %
// - CoinGecko (no key): BTC, ETH
// Writes ../bar-data.json. Never fails the workflow.

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------- Configure your instruments here ----------
const STOOQ_SYMBOLS = [
  "^spx",     // S&P 500
  "^ndx",     // NASDAQ 100
  "^dji",     // Dow Jones
  "gc.f",     // Gold
  "cl.f",     // Crude Oil (WTI)
  "si.f",     // Silver
  "aapl.us",  // Apple
  "msft.us"   // Microsoft
  // You can try "usdinr" too; if Stooq doesn't have it, it will just be skipped.
];

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

const COINS = [
  { id: "bitcoin",  symbol: "BTC-USD", name: "Bitcoin" },
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

// ---- Helpers ----
function safeNum(x) {
  if (x == null) return null;
  const n = Number(String(x).trim());
  return Number.isFinite(n) ? n : null;
}

async function fetchStooqDaily(symbol) {
  // Daily history CSV: Date,Open,High,Low,Close,Volume
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=d`;
  const r = await fetch(url, { headers: { "Accept": "text/csv" } });
  if (!r.ok) throw new Error(`Stooq ${symbol} ${r.status}`);
  const text = await r.text();
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error(`Stooq ${symbol} empty`);
  // Remove header
  const rows = lines.slice(1).map(line => line.split(","));
  if (rows.length === 0) throw new Error(`Stooq ${symbol} no rows`);

  const last = rows[rows.length - 1];       // latest day
  const prev = rows[rows.length - 2] || []; // previous day (may not exist)

  const close = safeNum(last[4]); // Close column
  const prevClose = safeNum(prev[4]);

  if (close == null) throw new Error(`Stooq ${symbol} no close`);

  const change = (prevClose != null) ? (close - prevClose) : 0;
  const changePercent = (prevClose != null && prevClose !== 0) ? (change / prevClose) * 100 : 0;

  return {
    symbol: symbol.toLowerCase(),
    name: FRIENDLY[symbol.toLowerCase()] || symbol.toUpperCase(),
    price: close,
    change,
    changePercent,
    marketState: "DAILY"
  };
}

async function fetchAllStooq(symbols) {
  const out = [];
  for (const s of symbols) {
    try {
      const row = await fetchStooqDaily(s);
      if (row && row.price != null) out.push(row);
    } catch (e) {
      console.warn(`[stooq skip] ${s}: ${e.message}`);
    }
  }
  return out;
}

async function fetchCoinGecko(coins) {
  const ids = coins.map(c => c.id).join(",");
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd&include_24hr_change=true`;
  const r = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!r.ok) throw new Error(`CoinGecko ${r.status}`);
  const j = await r.json();
  return coins.map(c => {
    const row = j?.[c.id];
    if (!row) return null;
    return {
      symbol: c.symbol,
      name: c.name,
      price: safeNum(row.usd),
      change: safeNum(row.usd_24h_change ?? 0) ?? 0,
      changePercent: safeNum(row.usd_24h_change ?? 0) ?? 0,
      marketState: "CRYPTO"
    };
  }).filter(Boolean);
}

async function main() {
  const [stooqRes, cgRes] = await Promise.allSettled([
    fetchAllStooq(STOOQ_SYMBOLS),
    fetchCoinGecko(COINS)
  ]);

  const items = [
    ...(Array.isArray(stooqRes.value) ? stooqRes.value : []),
    ...(Array.isArray(cgRes.value) ? cgRes.value : [])
  ];

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
  // Don't fail the job
});
