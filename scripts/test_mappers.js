// Smoke test: recorded sample payloads through the real mapping + build pipeline.
// Run: node scripts/test_mappers.js
import { mkdirSync, writeFileSync } from "node:fs";
import { mapFindATender, mapContractsFinder, mapTed } from "./fetch_tenders.js";
import { mapAdzuna, mapReed } from "./fetch_jobs.js";
import { mapRss } from "./fetch_news.js";
import { readFileSync } from "node:fs";

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { console.error(`  ✗ ${name} — ${detail}`); failures++; }
};

// --- Find a Tender (OCDS release package shape) ---
const fat = mapFindATender({ releases: [{
  ocid: "ocds-h6vhtk-04f0a1", id: "049520-2026",
  buyer: { name: "Borough of Westhaven" },
  tender: {
    title: "Financial Management System Replacement",
    description: "Replacement of the council finance system including general ledger",
    tenderPeriod: { endDate: "2026-08-20T12:00:00Z" },
    value: { amount: 480000, currency: "GBP" },
    items: [{ classification: { scheme: "CPV", id: "48443000" } }],
  },
}, {
  ocid: "ocds-h6vhtk-nomatch", id: "049521-2026",
  buyer: { name: "Roads Dept" },
  tender: { title: "Pothole repairs", description: "Tarmac", items: [] },
}]});
check("FaT: keyword+CPV match maps, non-match filtered", fat.length === 1, `got ${fat.length}`);
check("FaT: deadline + org + id correct",
  fat[0]?.trigger_date === "2026-08-20" && fat[0]?.org === "Borough of Westhaven" && fat[0]?.id === "fat-ocds-h6vhtk-04f0a1",
  JSON.stringify(fat[0]));

// --- Contracts Finder (search wrapper shape) ---
const cf = mapContractsFinder({ results: [{ item: {
  ocid: "ocds-b5fd17-cf1", noticeIdentifier: "2026/S 001",
  organisationName: "Kelsford NHS Trust",
  title: "Finance system upgrade", description: "ERP finance modules",
  deadlineDate: "2026-09-15T00:00:00Z", cpvCodes: ["48444100"],
}}]});
check("CF: wrapper shape maps with fallback fields",
  cf.length === 1 && cf[0].org === "Kelsford NHS Trust" && cf[0].trigger_date === "2026-09-15", JSON.stringify(cf[0]));

// --- TED (v3 search, multilingual fields) ---
const ted = mapTed({ notices: [{
  "publication-number": "00123456-2026",
  "notice-title": { eng: "ERP finance module for NGO consolidation" },
  "buyer-name": { fra: "Fondation Clairmont" },
  "buyer-country": "FRA",
  "deadline-receipt-tenders-date-time": "2026-08-31T17:00:00+02:00",
}]});
check("TED: multilingual fields resolve, country truncates",
  ted[0]?.org === "Fondation Clairmont" && ted[0]?.geography === "FR" && ted[0]?.trigger_date === "2026-08-31", JSON.stringify(ted[0]));

// --- Adzuna + Reed with EOL inheritance ---
const clock = JSON.parse(readFileSync("data/eol_clock.json", "utf8"));
const gp = clock.systems.find((s) => s.key === "dynamics_gp");
const adz = mapAdzuna({ results: [
  { company: { display_name: "Harzmann Logistik GmbH" }, redirect_url: "https://adzuna.de/j/1", title: "Dynamics GP Finanzbuchhalter" },
  { company: { display_name: "Harzmann Logistik GmbH" }, redirect_url: "https://adzuna.de/j/2", title: "Dynamics GP Senior FiBu" },
]}, "DE", gp);
check("Adzuna: inherits EOL context + trigger_date",
  adz[0]?.system_context.startsWith("Dynamics GP:") && adz[0]?.trigger_date === gp.eol_date, JSON.stringify(adz[0]));
check("Adzuna: same employer+system collapses to one id",
  adz[0].id === adz[1].id && adz[0].id === "adzuna-harzmann-logistik-gmbh-dynamics_gp", adz.map((x) => x.id).join(" vs "));
const reed = mapReed({ results: [{ employerName: "Meridian Care Trust", jobId: 55501, jobTitle: "SunSystems Management Accountant" }] },
  clock.systems.find((s) => s.key === "sunsystems_4_5"));
check("Reed: maps with UK geography and job URL",
  reed[0]?.geography === "UK" && reed[0]?.source_url.endsWith("/55501"), JSON.stringify(reed[0]));

// --- Google News RSS ---
const rss = mapRss(`<?xml version="1.0"?><rss version="2.0"><channel>
  <item><title>Alpine Hospitality Group acquires four UK hotels - Hotel Weekly</title><link>https://news.example/a1</link></item>
  <item><title>Charity merger creates largest care provider - Third Sector</title><link>https://news.example/a2</link></item>
</channel></rss>`, "hospitality");
check("RSS: parses items, flags needs_review, guesses org",
  rss.length === 2 && rss[0].needs_review === true && rss[0].org === "Alpine Hospitality Group", JSON.stringify(rss[0]));

// --- End-to-end: fetcher outputs through the real build ---
mkdirSync(".fetch", { recursive: true });
writeFileSync(".fetch/tenders.json", JSON.stringify({ signals: [...fat, ...cf, ...ted], freshness: [{ source: "find_a_tender", origin: "tenders", last_success: new Date().toISOString(), count: fat.length }] }));
writeFileSync(".fetch/jobs.json", JSON.stringify({ signals: [adz[0], ...reed], freshness: [] }));
writeFileSync(".fetch/news.json", JSON.stringify({ signals: rss, freshness: [] }));

process.exitCode = failures ? 1 : 0;
console.log(failures ? `\n${failures} FAILURE(S)` : "\nall mapper tests passed — .fetch/ populated for a build run");
