# Ledgerline

Private dashboard of live sales triggers for finance-systems implementers.
Three lanes: deals, migrations, tenders. See the build plan for phases.

## Local dev

    npm run dev          # serves site/ at localhost:3000
    npm run build        # rebuilds site/data/signals.json from data/ + .fetch/
    npm run fetch        # runs all fetchers (writes .fetch/, gitignored)

No install step needed for the site itself — it is static files.
Node 20+ required for the scripts (built-in fetch).

## How data flows

    fetchers → .fetch/*.json ─┐
    data/manual_signals.json ─┼→ build_signals.js → site/data/signals.json → dashboard
    data/curation.json ───────┘        (nightly GitHub Action commits the result)

Rules of the road:
- `site/data/signals.json` is generated. Never hand-edit it.
- B edits exactly three files: `data/eol_clock.json`, `data/manual_signals.json`,
  `data/curation.json` — via the GitHub web UI or the Phase 4 curation function.
- `first_seen` is preserved across runs; curation entries whose signal disappears
  are moved to `_retired` in curation.json, never silently dropped.
- API keys live only in GitHub Actions secrets (and Netlify env vars for Phase 4).

## Deploy

Netlify: connect repo, publish directory `site/` (netlify.toml already set).
Add repo secrets before enabling the nightly Action: TED_KEY, ADZUNA_APP_ID,
ADZUNA_KEY, REED_KEY.

## Phase status

- [x] Phase 0 — skeleton, sample signals, visual identity
- [x] Phase 1 — tenders: Find a Tender + Contracts Finder + TED implemented
- [x] Phase 2 — jobs: Adzuna (gb/fr/de/nl) + Reed with EOL inheritance
- [x] Phase 3 — news → Review inbox (needs_review, never auto-published)
- [x] Phase 4 — curate mode UI + serverless save + validation workflows
- [x] Phase 5 — filters, search, mobile, empty/error states, freshness footer

All code implemented and tested against recorded API payloads
(scripts/test_mappers.js). Remaining work is live verification: run each
fetcher with real keys and fix any field-name drift against the real APIs.
Keyword/CPV/news dictionaries are placeholders in the fetchers until B's
data/query_dictionary.json is supplied (see fetchers for its expected shape).
