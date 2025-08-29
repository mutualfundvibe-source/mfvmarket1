// scripts/update.mjs
// Global Market Feed (Set B) — Stooq daily CSV only (no keys, no Yahoo)
// Symbols: ^SPX, ^NDX, ^KOSPI, ^NKX, ^HSI, ^DAX, X.F (FTSE 100 fut), GC.F (Gold)
// Writes ../bar-data.json (never fails the workflow).

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---- Your chosen 8 items (Set B) ----
const STOOQ_SYMBOLS = [
  "^spx",    // S&P 500
  "^ndx",    // NASDAQ 100
  "^kospi",  // KOSPI (Korea)
  "^nkx",    // Nikkei 225 (Japan)
  "^hsi",    // Hang Seng (Hong Kong)
  "^dax",    // DAX (Germany)
  "x.f",     // FTSE 100 (futures proxy)
  "gc.f"     // Gold (futures)
];

const FRIENDLY = {
  "^spx":   "S&P 500",
  "^ndx":   "NASDAQ 100",
  "^kospi": "KOSPI (Korea)",
  "^nkx":   "Nikkei 225",
  "^hsi":   "Hang Seng",
  "^dax":   "DAX (Germany)",
  "x.f":    "FTSE 100",
  "gc.f":   "Gold"
};

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

function n(x) {
  if (x == null) return null;
  const v = Number(String(x).trim());
  return Number.isFinite(v) ? v : null;
}

// Pull per-symbol daily CSV and compute change from previous close
async function fetchStooqDaily(symbol) {
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=d`;
  const r = await fetch(url, { headers: { "Accept": "text/csv" } });
  if (!r.ok) throw new Error(`Stooq ${symbol} ${r.status}`);
  const text = await r.text();
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error(`Stooq ${symbol} empty`);
  const rows = lines.slice(1).map(line => line.split(","));
  if (!rows.length) throw new Error(`Stooq ${symbol} no rows`);

  const last = rows[rows.length - 1];
  const prev = rows[rows.length - 2] || [];

  const close = n(last[4]);
  const prevClose = n(prev[4]);

  if (close == null) throw new Error(`Stooq ${symbol} no close`);

  const change = (prevClose != null) ? (close - prevClose) : 0;
  const changePercent = (prevClose != null && prevClose !== 0) ? (change / prevClose) * 100 : 0;

  const key = symbol.toLowerCase();
  return {
    symbol: key,
    name: FRIENDLY[key] || symbol.toUpperCase(),
    price: close,
    change,
    changePercent,
    marketState: "DAILY"
  };
}

async function fetchAll(symbols) {
  const out = [];
  for (const s of symbols) {
    try {
      const row = await fetchStooqDaily(s);
      if (row && row.price != null) out.push(row);
    } catch (e) {
      console.warn(`[skip] ${s}: ${e.message}`);
    }
  }
  return out;
}

async function main() {
  const items = await fetchAll(STOOQ_SYMBOLS);
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
  // Do not fail the workflow
});
