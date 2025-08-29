// scripts/update.mjs
// Global Market Trend (4 indices only) — light theme bar uses this JSON
// Symbols: S&P 500 (^spx), NASDAQ 100 (^ndx), Hang Seng (^hsi), Shanghai Composite (^shc)

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const STOOQ_SYMBOLS = ["^spx", "^ndx", "^hsi", "^shc"];

const FRIENDLY = {
  "^spx": "S&P 500",
  "^ndx": "NASDAQ 100",
  "^hsi": "Hang Seng",
  "^shc": "Shanghai Comp."
};

function toISTISOString(date = new Date()) {
  const ist = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: true
  }).format(date);
  const [dmy, hms] = ist.split(", ");
  const [dd, mm, yyyy] = dmy.split("/");
  return `${dd}-${mm}-${yyyy}, ${hms}`;
}

function num(x) {
  if (x == null) return null;
  const n = Number(String(x).trim());
  return Number.isFinite(n) ? n : null;
}

async function fetchStooqDaily(symbol) {
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=d`;
  const r = await fetch(url, { headers: { "Accept": "text/csv" } });
  if (!r.ok) throw new Error(`Stooq ${symbol} ${r.status}`);
  const text = await r.text();
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error(`Stooq ${symbol} empty`);
  const rows = lines.slice(1).map(l => l.split(","));
  const last = rows[rows.length - 1];
  const prev = rows[rows.length - 2] || [];
  const close = num(last[4]);
  const prevClose = num(prev[4]);

  const change = (prevClose != null) ? (close - prevClose) : 0;
  const changePercent = (prevClose != null && prevClose !== 0) ? (change / prevClose) * 100 : 0;

  return {
    symbol: symbol.toLowerCase(),
    name: FRIENDLY[symbol.toLowerCase()] || symbol.toUpperCase(),
    price: close,
    change,
    changePercent
  };
}

async function fetchAll(symbols) {
  const out = [];
  for (const s of symbols) {
    try {
      const row = await fetchStooqDaily(s);
      if (row) out.push(row);
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
  await writeFile(out, JSON.stringify(payload, null, 2), "utf8");
});
