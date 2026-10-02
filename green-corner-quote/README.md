# Green Corner Quote Tool

Internal Waste2Light tool that turns a list of components into a priced quote. It reads Microscale and Hub360 prices twice a day, adds a per-item markup (10% default) and totals the quote. Built from the PRD dated 2 Oct 2026.

Next.js 16 (TypeScript), PostgreSQL, a Node sync script run by GitHub Actions.

## Run it locally

```bash
cd green-corner-quote
npm install
cp .env.example .env        # fill in DATABASE_URL, AUTH_SECRET, ADMIN_EMAIL
npm run hash-password -- 'a password of 10+ chars'   # put the output in ADMIN_PASSWORD_HASH (single-quote it)
npm run migrate
npm run dev
```

Next.js does not read a plain `.env` for the scripts; export the variables (or use `node --env-file=.env`) before `npm run migrate` / `npm run sync`.

Then: sign in, add components in **Catalog**, link supplier listings on each component's page (search, or paste a product URL; set *units per listing* for packs), and build quotes.

## Tests

```bash
npm test                                  # parsers, pricing, safeguards, schedule (no database needed)
TEST_DATABASE_URL=postgres://... npm test # also runs sync + quote integration tests. WIPES that database.
```

## Deploy

1. Create a Postgres database (Neon, Supabase). Run `npm run migrate` against it.
2. Deploy `green-corner-quote/` as its own app on its own subdomain (for example Vercel with root directory `green-corner-quote`). Set `DATABASE_URL`, `AUTH_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `SYNC_CONTACT`.
3. In the GitHub repo add the secret `GCQ_DATABASE_URL` (same database) and optionally the variable `GCQ_SYNC_CONTACT`. The workflow `.github/workflows/gcq-sync.yml` only runs on the **default branch**, so merge before expecting scheduled runs.
4. "Sync now" in the app runs in the background of the web request (`maxDuration` 300 s). Hosts that cap request time below that should use the workflow's manual **Run workflow** button with *force* instead.

## How the rules map to the PRD

| PRD | Where |
| --- | --- |
| Pricing (FR-10) | `src/lib/pricing.ts`, tested in `tests/pricing.test.ts` (includes the ₦98,120 worked example) |
| Safeguards (FR-8) | `src/lib/sync/safeguards.ts` (decisions), `src/lib/sync/run.ts` (applies them) |
| Sync, 1 req/s to Hub360, mapped items only | `src/lib/sync/run.ts`, `src/lib/sync/hub360.ts` |
| Saved quotes keep prices (FR-15) | `src/lib/quotes.ts` snapshots every line; the server re-prices, never the browser |
| Schema | `db/migrations/001_init.sql` |

## Things you must check before relying on it

These are the gaps from building without internet access to the real sites:

1. **Brand tokens are placeholders.** The build environment could not reach waste2light.com, so the colors and fonts in `src/app/tokens.css` are neutral stand-ins, not the site's. Run `npm run extract-brand` on a connected machine and copy the values into that one file. The logo is a text wordmark until you drop in the real one.
2. **Parsers were tested on hand-written samples**, not captured pages. The Microscale parser follows the standard Shopify `products.json` shape. The Hub360 parser tries JSON-LD, then `itemprop`, then Odoo's printed price (`.oe_currency_value`), and treats an unknown stock status as *in stock*. Run `npm run capture-fixtures -- <hub360 product url> ...` to save real pages into `tests/fixtures/`, point the parser tests at them, and confirm where Hub360 shows stock (PRD open question).
3. **Hub360 terms.** The PRD notes only part of their terms was read. Check the automated-access rules before the first live Hub360 sync.
4. Microscale prices are assumed to be in naira.

## Deviations from the PRD

- **Schedule.** Instead of a fixed cron of `0 5,17 * * *`, the workflow runs hourly and the script runs a sync when a time in Settings is due and not yet handled. This makes the Settings page (FR-19) real, and a delayed GitHub run is caught up instead of lost. Defaults are still 06:00 and 18:00 Lagos.
- Extra columns beyond the PRD's table: `sync_runs.status`, `sync_runs.component_id`, `quote_lines.name/detail/warnings`, a `pending` listing status for never-synced links, `held_changes.decided_at`.
- PDF is the print stylesheet ("Print / save as PDF"), as the PRD prefers.
- Duplicate quote copies the lines and re-prices them at today's prices.
- Editing a saved quote keeps each unchanged line's saved price; use **Reprice** on a line or **Reprice all** to refresh.

## Decisions taken for the PRD's open questions

Cheapest in-stock supplier by default (switchable per line), one admin login, on-screen/print/PDF output only, 10% markup editable per component, whole-naira rounding, Next.js + Postgres. Subdomain is left to you.
