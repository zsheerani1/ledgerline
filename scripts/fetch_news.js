// Phase 3: Google News RSS per query → .fetch/news.json (all needs_review: true)
// Unofficial feed: fail soft per query, never auto-publish (build renders these
// into the Review inbox, curation promotes them).
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";

const dict = existsSync("data/query_dictionary.json")
  ? JSON.parse(readFileSync("data/query_dictionary.json", "utf8"))
  : {};
const QUERIES = dict.news_queries || [
  { q: '"hotel group" acquisition UK finance', vertical: "hospitality", hl: "en-GB" },
  { q: '"charity" merger finance system', vertical: "nonprofit", hl: "en-GB" },
  { q: 'Übernahme Hotelgruppe', vertical: "hospitality", hl: "de" },
  { q: 'acquisition groupe hôtelier', vertical: "hospitality", hl: "fr" },
];

const now = () => new Date().toISOString();
const today = now().slice(0, 10);
const parser = new XMLParser({ ignoreAttributes: false });

export function mapRss(xml, vertical) {
  const doc = parser.parse(xml);
  let items = doc?.rss?.channel?.item || [];
  if (!Array.isArray(items)) items = [items];
  return items.slice(0, 15).map((item) => {
    const title = String(item.title || "Untitled");
    const link = String(item.link || "");
    // Google News titles end with " - Publisher"; strip for org guess, keep full in title
    const orgGuess = title.split(" - ")[0].split(/ acquires| buys| merges| übernimmt| rachète/i)[0].trim().slice(0, 60);
    return {
      id: `gnews-${hash(link || title)}`,
      lane: "deal",
      source: "gnews",
      fetch_origin: "news",
      source_url: link,
      org: orgGuess || "Unreviewed",
      title,
      vertical,
      geography: "EU",
      system_context: null,
      trigger_date: null,
      first_seen: today,
      needs_review: true,
    };
  });
}

export function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

async function main() {
  const results = [];
  const failures = [];
  let anySuccess = false;
  for (const { q, vertical, hl } of QUERIES) {
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl || "en-GB"}`;
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (ledgerline)" } });
      if (!res.ok) throw new Error(`${res.status}`);
      results.push(...mapRss(await res.text(), vertical));
      anySuccess = true;
    } catch (err) {
      failures.push(`gnews "${q}": ${err.message}`);
      console.error(`gnews "${q}": ${err.message}`);
    }
  }
  const byId = new Map();
  for (const s of results) if (!byId.has(s.id)) byId.set(s.id, s);
  const freshness = anySuccess
    ? [{ source: "gnews", origin: "news", last_success: now(), count: byId.size }]
    : [];
  mkdirSync(".fetch", { recursive: true });
  writeFileSync(".fetch/news.json", JSON.stringify({ signals: [...byId.values()], freshness, failures }, null, 2));
  console.log(`news: ${byId.size} candidates, ${failures.length} failure(s)`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) await main();
