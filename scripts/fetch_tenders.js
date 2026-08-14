// Phase 1: Find a Tender (OCDS) + Contracts Finder + TED → .fetch/tenders.json
// Run: node scripts/fetch_tenders.js   (TED_KEY env var enables TED)
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";

const dict = existsSync("data/query_dictionary.json")
  ? JSON.parse(readFileSync("data/query_dictionary.json", "utf8"))
  : {};
const KEYWORDS = dict.tender_keywords || [
  "financial management system", "finance system", "ERP", "accounting software",
  "general ledger", "financial consolidation",
];
const CPV_PREFIXES = dict.cpv_prefixes || ["48443", "48444", "48441", "72212443"];
const TED_COUNTRIES = dict.ted_countries || ["FRA", "BEL", "NLD", "LUX", "DEU", "IRL", "CZE"];

const now = () => new Date().toISOString();
const today = now().slice(0, 10);

const matches = (text, cpvs) => {
  const t = (text || "").toLowerCase();
  return (
    KEYWORDS.some((k) => t.includes(k.toLowerCase())) ||
    (cpvs || []).some((c) => CPV_PREFIXES.some((p) => String(c).startsWith(p)))
  );
};

const signal = (o) => ({
  lane: "tender", fetch_origin: "tenders", vertical: "other",
  system_context: null, trigger_date: null, first_seen: today, ...o,
});

// ---- mappers (pure, exported for tests) ----

export function mapFindATender(pkg) {
  const out = [];
  for (const r of pkg.releases || []) {
    const t = r.tender || {};
    const cpvs = (t.items || []).flatMap((i) =>
      [i.classification, ...(i.additionalClassifications || [])].filter(Boolean).map((c) => c.id)
    );
    if (!matches(`${t.title || ""} ${t.description || ""}`, cpvs)) continue;
    out.push(signal({
      id: `fat-${r.ocid || r.id}`,
      source: "find_a_tender",
      source_url: `https://www.find-tender.service.gov.uk/Notice/${encodeURIComponent(r.id || r.ocid || "")}`,
      org: r.buyer?.name || (r.parties || []).find((p) => (p.roles || []).includes("buyer"))?.name || "Unknown buyer",
      title: t.title || "Untitled tender",
      geography: "UK",
      trigger_date: t.tenderPeriod?.endDate?.slice(0, 10) || null,
      system_context: t.value?.amount
        ? `Value ${t.value.currency || "GBP"} ${Number(t.value.amount).toLocaleString("en-GB")}`
        : null,
    }));
  }
  return out;
}

export function mapContractsFinder(page) {
  const out = [];
  for (const n of page?.results || page?.releases || []) {
    const item = n.item || n; // CF search API wraps notices in {item}
    const t = item.tender || {};
    const title = t.title || item.title || "";
    const desc = t.description || item.description || "";
    const cpvs = (t.items || []).flatMap((i) =>
      [i.classification, ...(i.additionalClassifications || [])].filter(Boolean).map((c) => c.id)
    ).concat(item.cpvCodes || []);
    if (!matches(`${title} ${desc}`, cpvs)) continue;
    const id = item.ocid || item.id || item.noticeIdentifier;
    out.push(signal({
      id: `cf-${id}`,
      source: "contracts_finder",
      source_url: item.uri || `https://www.contractsfinder.service.gov.uk/Notice/${encodeURIComponent(id || "")}`,
      org: item.buyer?.name || item.organisationName || "Unknown buyer",
      title: title || "Untitled notice",
      geography: "UK",
      trigger_date: (t.tenderPeriod?.endDate || item.deadlineDate || "").slice(0, 10) || null,
    }));
  }
  return out;
}

export function mapTed(res) {
  const out = [];
  for (const n of res?.notices || res?.results || []) {
    const get = (f) => {
      const v = n[f];
      if (v == null) return null;
      if (typeof v === "object") return v.eng || v.en || Object.values(v)[0] || null;
      return v;
    };
    const title = get("notice-title") || get("title") || "Untitled notice";
    const country = String(get("buyer-country") || get("place-of-performance") || "EU").slice(0, 2).toUpperCase();
    const pub = get("publication-number") || n.publicationNumber || n.ND;
    out.push(signal({
      id: `ted-${pub}`,
      source: "ted",
      source_url: `https://ted.europa.eu/en/notice/-/detail/${encodeURIComponent(pub || "")}`,
      org: get("buyer-name") || "Unknown buyer",
      title,
      geography: country,
      trigger_date: (get("deadline-receipt-tenders-date-time") || get("deadline") || "").slice(0, 10) || null,
    }));
  }
  return out;
}

// ---- fetchers ----

async function getJson(url, opts = {}) {
  const res = await fetch(url, { headers: { Accept: "application/json" }, ...opts });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function findATender() {
  const url = "https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?stages=tender&limit=100";
  return mapFindATender(await getJson(url));
}

async function contractsFinder() {
  const url = "https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search?stages=tender&limit=100";
  return mapContractsFinder(await getJson(url));
}

async function ted() {
  if (!process.env.TED_KEY) { console.warn("TED_KEY not set, skipping TED"); return null; }
  const query = [
    `(${KEYWORDS.map((k) => `"${k}"`).join(" OR ")} OR classification-cpv IN (${CPV_PREFIXES.map((p) => p.padEnd(8, "0")).join(" ")}))`,
    `buyer-country IN (${TED_COUNTRIES.join(" ")})`,
  ].join(" AND ");
  const body = {
    query, page: 1, limit: 100, scope: "ACTIVE",
    fields: ["publication-number", "notice-title", "buyer-name", "buyer-country", "deadline-receipt-tenders-date-time"],
  };
  const data = await getJson("https://api.ted.europa.eu/v3/notices/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${process.env.TED_KEY}` },
    body: JSON.stringify(body),
  });
  return mapTed(data);
}

async function main() {
  const results = [];
  const freshness = [];
  const failures = [];
  const jobs = [["find_a_tender", findATender], ["contracts_finder", contractsFinder], ["ted", ted]];
  for (const [name, fn] of jobs) {
    try {
      const sigs = await fn();
      if (sigs === null) continue; // deliberately skipped
      results.push(...sigs);
      freshness.push({ source: name, origin: "tenders", last_success: now(), count: sigs.length });
    } catch (err) {
      failures.push(`${name}: ${err.message}`);
      console.error(`fetcher failed: ${name}: ${err.message}`);
    }
  }
  // Cross-source dedupe: FaT and CF republish each other; prefer FaT by ocid tail
  const seen = new Map();
  for (const s of results) {
    const key = s.id.replace(/^(fat|cf)-/, "");
    const prior = seen.get(key);
    if (!prior || (prior.source === "contracts_finder" && s.source === "find_a_tender")) seen.set(key, s);
  }
  mkdirSync(".fetch", { recursive: true });
  writeFileSync(".fetch/tenders.json", JSON.stringify({ signals: [...seen.values()], freshness, failures }, null, 2));
  console.log(`tenders: ${seen.size} signals, ${failures.length} failure(s)`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) await main();
