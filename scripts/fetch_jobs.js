// Phase 2: Adzuna (gb, fr, de, nl) + Reed (UK) → .fetch/jobs.json
// Each hit inherits system_context + trigger_date from data/eol_clock.json.
// Env: ADZUNA_APP_ID, ADZUNA_KEY, REED_KEY
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";

const clock = JSON.parse(readFileSync("data/eol_clock.json", "utf8"));
const ADZUNA_MARKETS = { gb: "UK", fr: "FR", de: "DE", nl: "NL" };
const now = () => new Date().toISOString();
const today = now().slice(0, 10);

export const slug = (s) =>
  String(s || "unknown").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

export function jobSignal(source, employer, jobUrl, jobTitle, geography, system) {
  return {
    id: `${source}-${slug(employer)}-${system.key}`,
    lane: "migration",
    source,
    fetch_origin: "jobs",
    source_url: jobUrl,
    org: employer || "Unknown employer",
    title: `Hiring "${jobTitle}"`,
    vertical: "other",
    geography,
    system_context: `${system.name}: ${system.what_it_means}`,
    trigger_date: system.eol_date,
    first_seen: today,
  };
}

export function mapAdzuna(data, geography, system) {
  return (data?.results || []).map((j) =>
    jobSignal("adzuna", j.company?.display_name, j.redirect_url, j.title, geography, system)
  );
}

export function mapReed(data, system) {
  return (data?.results || []).map((j) =>
    jobSignal("reed", j.employerName, `https://www.reed.co.uk/jobs/${j.jobId}`, j.jobTitle, "UK", system)
  );
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { Accept: "application/json", ...headers } });
  if (!res.ok) throw new Error(`${res.status} for ${url.replace(/app_key=[^&]+/, "app_key=***")}`);
  return res.json();
}

async function main() {
  const results = [];
  const freshness = [];
  const failures = [];
  const systems = clock.systems || [];

  if (process.env.ADZUNA_APP_ID && process.env.ADZUNA_KEY) {
    let count = 0, ok = true;
    for (const [market, geo] of Object.entries(ADZUNA_MARKETS)) {
      for (const system of systems) {
        for (const kw of system.watch_keywords || []) {
          try {
            const url =
              `https://api.adzuna.com/v1/api/jobs/${market}/search/1` +
              `?app_id=${process.env.ADZUNA_APP_ID}&app_key=${process.env.ADZUNA_KEY}` +
              `&results_per_page=20&what_phrase=${encodeURIComponent(kw)}&max_days_old=7`;
            const sigs = mapAdzuna(await getJson(url), geo, system);
            results.push(...sigs);
            count += sigs.length;
          } catch (err) {
            ok = false;
            failures.push(`adzuna/${market}/${kw}: ${err.message}`);
            console.error(`adzuna ${market} "${kw}": ${err.message}`);
          }
        }
      }
    }
    if (ok || count > 0) freshness.push({ source: "adzuna", origin: "jobs", last_success: now(), count });
  } else console.warn("ADZUNA_APP_ID/ADZUNA_KEY not set, skipping Adzuna");

  if (process.env.REED_KEY) {
    let count = 0, ok = true;
    const auth = { Authorization: "Basic " + Buffer.from(process.env.REED_KEY + ":").toString("base64") };
    for (const system of systems) {
      for (const kw of system.watch_keywords || []) {
        try {
          const url = `https://www.reed.co.uk/api/1.0/search?keywords=${encodeURIComponent(kw)}&resultsToTake=20`;
          const sigs = mapReed(await getJson(url, auth), system);
          results.push(...sigs);
          count += sigs.length;
        } catch (err) {
          ok = false;
          failures.push(`reed/${kw}: ${err.message}`);
          console.error(`reed "${kw}": ${err.message}`);
        }
      }
    }
    if (ok || count > 0) freshness.push({ source: "reed", origin: "jobs", last_success: now(), count });
  } else console.warn("REED_KEY not set, skipping Reed");

  // Per-run collapse: one signal per employer+system (id already encodes this),
  // which also gives cross-run dedupe via build_signals first_seen preservation.
  const byId = new Map();
  for (const s of results) if (!byId.has(s.id)) byId.set(s.id, s);

  mkdirSync(".fetch", { recursive: true });
  writeFileSync(".fetch/jobs.json", JSON.stringify({ signals: [...byId.values()], freshness, failures }, null, 2));
  console.log(`jobs: ${byId.size} signals from ${results.length} postings, ${failures.length} failure(s)`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) await main();
