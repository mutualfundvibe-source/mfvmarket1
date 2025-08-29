// scripts/update.mjs
// Fetches quotes from Yahoo Finance (no API key), writes ../bar-data.json

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SYMBOLS = [
  "^NSEI",     // NIFTY 50
  "^BSESN",    // SENSEX
  "^NSEBANK",  // NIFTY BANK
  "AAPL",
  "MSFT",
  "^GSPC",     // S&P 500
  "^NDX",      // NASDAQ 100
  "BTC-USD",
  "ETH-USD"
];

const FRIENDLY_NAMES = {
  "^NSEI": "NIFTY 50",
  "^BSESN": "SENSEX",
  "^NSEBANK": "NIFTY Bank",
  "^GSPC": "S&P 500",
  "^NDX": "NASDAQ 100",
  "BTC-USD": "Bitcoin",
  "ETH-USD": "Ethereum"
};

const UA = process.env.USER_AGENT || "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari";

async function fetchYahoo(symbols, host = "query1.finance.yahoo.com") {
  const url = `https://${host}/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(","))}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "application/json" }
  });
  if (!res.ok) {
    throw new Error(`Yahoo Finance API failed: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  if (!json || !json.quoteResponse || !Array.isArray(json.quoteResponse.result)) {
    throw new Error("Yahoo response shape unexpected.");
  }
  return json.quoteResponse.result.map(q => ({
    symbol: q.symbol,
    name: FRIENDLY_NAMES[q.symbol] || q.shortName || q.longName || q.symbol,
    price: q.regularMarketPrice ?? q.preMarketPrice ?? q.postMarketPrice ?? null,
    change: q.regularMarketChange ?? 0,
    changePercent: q.regularMarketChangePercent ?? 0,
    marketState: q.marketState || "REGULAR"
  }));
}

async function getData() {
  try {
    return await fetchYahoo(SYMBOLS, "query1.finance.yahoo.com");
  } catch (e1) {
    // Retry on secondary host (sometimes works if query1 is prickly)
    try {
      return await fetchYahoo(SYMBOLS, "query2.finance.yahoo.com");
    } catch (e2) {
      // Final attempt: request each symbol individually (slower but resilient)
      const items = [];
      for (const s of SYMBOLS) {
        try {
          const r = await fetchYahoo([s], "query1.finance.yahoo.com");
          items.push(r[0]);
        } catch {
          // Skip symbol if still failing
        }
      }
      if (items.length) return items;
      // If absolutely nothing worked, rethrow the first error (useful in Action logs)
      throw e1;
    }
  }
}

function toISTISOString(date = new Date()) {
  // Convert to Asia/Kolkata ISO-like string for clarity on UI
  const ist = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  }).format(date);
  // Convert "dd/mm/yyyy, hh:mm:ss" to ISO-ish "yyyy-mm-ddThh:mm:ss+05:30"
  const [dmy, hms] = ist.split(", ");
  const [dd, mm, yyyy] = dmy.split("/");
  return `${yyyy}-${mm}-${dd}T${hms}+05:30`;
}

async function main() {
  const items = await getData();

  const payload = {
    updatedAt: toISTISOString(),
    items: items.filter(x => x && x.price != null)
  };

  const out = resolve(__dirname, "../bar-data.json");
  await writeFile(out, JSON.stringify(payload, null, 2), "utf8");
  console.log(`Wrote ${payload.items.length} items to bar-data.json at ${payload.updatedAt}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
