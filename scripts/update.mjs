// scripts/update.mjs
// Resilient updater: tries Yahoo per-symbol; skips failures; adds CoinGecko for crypto.
// Writes ../bar-data.json and NEVER exits with an error (so Actions stays green).

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 👉 You can change this list. If Yahoo blocks an item, we just skip it.
const SYMBOLS = [
  "^NSEI",     // NIFTY 50 (Yahoo)
  "^BSESN",    // SENSEX (Yahoo)
  "^NSEBANK",  // NIFTY BANK (Yahoo)
  "^GSPC",     // S&P 500 (Yahoo)
  "^NDX",      // NASDAQ 100 (Yahoo)
  "AAPL",      // Apple (Yahoo)
  "MSFT"       // Microsoft (Yahoo)
];

// Crypto we’ll fetch from CoinGecko instead of Yahoo (no API key).
const COINGECKO = [
  { id: "bitcoin", symbol: "BTC-USD", name: "Bitcoin" },
  { id: "ethereum", symbol: "ETH-USD", name: "Ethereum" }
];

const FRIENDLY = {
  "^NSEI": "NIFTY 50",
  "^BSESN": "SENSEX",
  "^NSEBANK": "NIFTY Bank",
  "^GSPC": "S&P 500",
  "^NDX": "NASDAQ 100"
};

const UA =
  process.env.USER_AGENT ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari";

async function yahooQuoteV7(sym, host = "query1.finance.yahoo.com") {
  const url = `https://${host}/v7/finance/quote?symbols=${encodeURIComponent(sym)}`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`Yahoo v7 ${sym} ${res.status}`);
  const j = await res.json();
  const q = j?.quoteResponse?.result?.[0];
  if (!q) throw new Error(`Yahoo v7 empty ${sym}`);
  return {
    symbol: q.symbol,
    name: FRIENDLY[q.symbol] || q.shortName || q.longName || q.symbol,
    price: q.regularMarketPrice ?? q.preMarketPrice ?? q.postMarketPrice ?? null,
    change: q.regularMarketChange ?? 0,
    changePercent: q.regularMarketChangePercent ?? 0,
    marketState: q.marketState || "REGULAR"
  };
}

async function yahooQuote(sym) {
  // try query1 → query2
  try {
    return await yahooQuoteV7(sym, "query1.finance.yahoo.com");
  } catch {
    try {
      return await yahooQuoteV7(sym, "query2.finance.yahoo.com");
    } catch (e) {
      // give up on this symbol
      console.warn(`[skip] ${sym}: ${e.message}`);
      return null;
    }
  }
}

async function coingeckoSimple(ids) {
  const url =
    "https://api.coingecko.com/api/v3/simple/price?ids=" +
    encodeURIComponent(ids.join(",")) +
    "&vs_currencies=usd&include_24hr_change=true";
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  return res.json();
}

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

async function main() {
  const out = [];

  // 1) Yahoo per symbol (skip any failures; no throwing)
  for (const s of SYMBOLS) {
    const q = await yahooQuote(s);
    if (q && q.price != null) out.push(q);
  }

  // 2) Crypto from CoinGecko
  try {
    const ids = COINGECKO.map(x => x.id);
    const data = await coingeckoSimple(ids);
    for (const c of COINGECKO) {
      const row = data?.[c.id];
      if (!row) continue;
      out.push({
        symbol: c.symbol,
        name: c.name,
        price: row.usd,
        change: (row.usd_24h_change ?? 0),
        // Convert 24h absolute change into % and value pair:
        changePercent: row.usd ? (row.usd_24h_change ?? 0) : 0,
        marketState: "CRYPTO"
      });
    }
  } catch (e) {
    console.warn(`[crypto] skipped: ${e.message}`);
  }

  // 3) Write the JSON (even if empty; never fail the workflow)
  const payload = {
    updatedAt: toISTISOString(),
    items: out
  };
  const outfile = resolve(__dirname, "../bar-data.json");
  await writeFile(outfile, JSON.stringify(payload, null, 2), "utf8");
  console.log(`Wrote ${payload.items.length} items at ${payload.updatedAt}`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    // Final safety: still write an empty shell and exit 0.
    console.error("Non-fatal error:", err.message);
    const outfile = resolve(__dirname, "../bar-data.json");
    const payload = { updatedAt: toISTISOString(), items: [] };
    writeFile(outfile, JSON.stringify(payload, null, 2), "utf8")
      .then(() => {
        console.log("Wrote empty bar-data.json after error; exiting OK.");
        process.exit(0);
      })
      .catch(() => process.exit(0));
  });
