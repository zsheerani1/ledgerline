// Merges fetcher outputs + manual_signals.json + curation.json → site/data/signals.json
// Run: node scripts/build_signals.js
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";

const OUT = "site/data/signals.json";
const FETCH_OUT = ".fetch"; // fetchers write .fetch/<source>.json
const SOURCES = ["tenders", "jobs", "news"];
const today = new Date().toISOString().slice(0, 10);

const readJson = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback);

// 1. Load previous output (preserves first_seen and last-good freshness)
const prev = readJson(OUT, { signals: [], freshness: [] });
const prevById = new Map(prev.signals.map((s) => [s.id, s]));
const prevFreshness = new Map(prev.freshness.map((f) => [f.source, f]));

// 2. Gather fetched + manual signals
let incoming = [];
const freshness = [];
for (const src of SOURCES) {
  const file = `${FETCH_OUT}/${src}.json`;
  const data = readJson(file, null);
  if (data && Array.isArray(data.signals)) {
    incoming.push(...data.signals);
    for (const f of data.freshness || []) freshness.push(f);
  } else {
    // fetcher failed or hasn't run: keep previous signals from its sources, mark stale
    for (const f of prev.freshness.filter((x) => x.origin === src)) freshness.push(f);
    incoming.push(...prev.signals.filter((s) => s.fetch_origin === src));
    console.warn(`warn: no output from ${src}, carrying previous data`);
  }
}
const manual = readJson("data/manual_signals.json", { signals: [] });
incoming.push(...manual.signals.map((s) => ({ ...s, fetch_origin: "manual" })));

// 3. Validate shape — fail loudly so B's hand edits break the Action, not the site
const LANES = new Set(["deal", "migration", "tender"]);
for (const s of incoming) {
  const problems = [];
  if (!s.id) problems.push("missing id");
  if (!LANES.has(s.lane)) problems.push(`bad lane "${s.lane}"`);
  if (!s.org) problems.push("missing org");
  if (!s.source_url) problems.push("missing source_url");
  if (problems.length) {
    console.error(`INVALID SIGNAL ${s.id || "(no id)"} — ${problems.join(", ")}`);
    process.exit(1);
  }
}

// 4. Dedupe by id, preserve first_seen from previous runs
const byId = new Map();
for (const s of incoming) {
  const previous = prevById.get(s.id);
  const existing = byId.get(s.id);
  const merged = { ...(existing || {}), ...s, first_seen: previous?.first_seen || existing?.first_seen || s.first_seen || today };
  byId.set(s.id, merged);
}

// 5. Merge curation by id; retire entries whose signal no longer exists
const curation = readJson("data/curation.json", { entries: {}, _retired: {} });
let retiredCount = 0;
for (const [id, entry] of Object.entries(curation.entries)) {
  if (byId.has(id)) {
    byId.get(id).curated = entry;
  } else {
    curation._retired[id] = { ...entry, retired_on: today };
    delete curation.entries[id];
    retiredCount++;
  }
}
for (const s of byId.values()) if (!("curated" in s)) s.curated = null;
if (retiredCount) {
  writeFileSync("data/curation.json", JSON.stringify(curation, null, 2) + "\n");
  console.warn(`retired ${retiredCount} curation entr${retiredCount === 1 ? "y" : "ies"} (signal no longer present)`);
}

// 6. Write output
const signals = [...byId.values()].sort((a, b) => (b.first_seen || "").localeCompare(a.first_seen || ""));
writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), freshness, signals }, null, 2) + "\n");
copyFileSync("data/eol_clock.json", "site/data/eol_clock.json");
console.log(`wrote ${signals.length} signals to ${OUT}`);
