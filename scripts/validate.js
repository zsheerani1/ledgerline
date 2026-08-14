// Phase 4a: validate B's hand-edited files with readable errors.
// Run: node scripts/validate.js   (exit 1 on any problem)
import { readFileSync } from "node:fs";

const LANES = new Set(["deal", "migration", "tender"]);
const STATUSES = new Set(["new", "reviewed", "starred", "parked", "dead"]);
const HML = new Set(["H", "M", "L"]);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const problems = [];
const flag = (file, where, msg) => problems.push(`${file} → ${where}: ${msg}`);

function load(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    flag(file, "whole file", `not valid JSON — ${err.message}`);
    return null;
  }
}

const cur = load("data/curation.json");
if (cur) {
  if (typeof cur.entries !== "object") flag("data/curation.json", "entries", "missing entries object");
  for (const [id, e] of Object.entries(cur.entries || {})) {
    if (e.status && !STATUSES.has(e.status)) flag("data/curation.json", id, `status "${e.status}" not one of ${[...STATUSES].join("/")}`);
    for (const k of ["fit", "heat"]) {
      if (e[k] == null) continue;
      const v = typeof e[k] === "number" ? (e[k] <= 3 ? "L" : e[k] <= 6 ? "M" : e[k] <= 9 ? "H" : "?") : e[k];
      if (!HML.has(v)) flag("data/curation.json", id, `${k} "${e[k]}" must be H/M/L or 1-9`);
    }
  }
}

const man = load("data/manual_signals.json");
if (man) {
  const ids = new Set();
  for (const [i, s] of (man.signals || []).entries()) {
    const where = s.id || `signals[${i}]`;
    if (!s.id) flag("data/manual_signals.json", where, "missing id");
    else if (ids.has(s.id)) flag("data/manual_signals.json", where, "duplicate id");
    else ids.add(s.id);
    if (!LANES.has(s.lane)) flag("data/manual_signals.json", where, `lane "${s.lane}" not one of deal/migration/tender`);
    if (!s.org) flag("data/manual_signals.json", where, "missing org");
    if (!s.source_url?.startsWith?.("http")) flag("data/manual_signals.json", where, "source_url must be a full http(s) URL");
    if (s.trigger_date && !ISO.test(s.trigger_date)) flag("data/manual_signals.json", where, `trigger_date "${s.trigger_date}" must be YYYY-MM-DD`);
    if (s.first_seen && !ISO.test(s.first_seen)) flag("data/manual_signals.json", where, `first_seen "${s.first_seen}" must be YYYY-MM-DD`);
    if ("curated" in s) flag("data/manual_signals.json", where, "remove 'curated' — scores belong in curation.json");
  }
}

const clock = load("data/eol_clock.json");
if (clock) {
  const keys = new Set();
  for (const [i, sys] of (clock.systems || []).entries()) {
    const where = sys.key || `systems[${i}]`;
    if (!sys.key) flag("data/eol_clock.json", where, "missing key");
    else if (keys.has(sys.key)) flag("data/eol_clock.json", where, "duplicate key");
    else keys.add(sys.key);
    if (!sys.name) flag("data/eol_clock.json", where, "missing name");
    if (!ISO.test(sys.eol_date || "")) flag("data/eol_clock.json", where, `eol_date "${sys.eol_date}" must be YYYY-MM-DD`);
    if (!Array.isArray(sys.watch_keywords) || !sys.watch_keywords.length) flag("data/eol_clock.json", where, "watch_keywords must be a non-empty list");
    if (!sys.what_it_means) flag("data/eol_clock.json", where, "missing what_it_means");
  }
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s) found:\n`);
  for (const p of problems) console.error("  ✗ " + p);
  console.error("");
  process.exit(1);
}
console.log("all data files valid");
