# Poshmark Store — Backlog

## Bugs

### Require live comp data before posting (not just cached)
**Priority:** high  
**Status:** open

Currently the pipeline marks items as `needs_pricing` when there are no cached comparables. This means items sit waiting even when comp data could be fetched live from Poshmark and saved for future use.

**Expected behavior:**
- If cached comps exist for a brand/size/category → use them (current behavior ✓)
- If no cached comps exist → search Poshmark for sold comps, save results to `comparables.json`, then price from those comps
- Only mark `needs_pricing` if the live search also returns insufficient data

This turns the pricing flow from "wait for human" into "fetch, save, and proceed."

**Files likely involved:**
- `src/lib/pricing.ts` — `analyzeItem()`, `fetchComparables()`
- `src/lib/comparables.ts` — comp storage/read/write
- `src/types.ts` — `PricingResult.source` may need a new variant (e.g. `'live_search'`)

---

## Features

### Mark item as sold on Poshmark
**Priority:** medium  
**Status:** open

Add a script/flow to mark an existing posted listing as sold and record the accepted price in the sheet (`acceptedSellPrice` column). Should prompt for final sale price if not already in the sheet.

---

### Add `needs_category` status
**Priority:** medium  
**Status:** open

When an item has complete brand/size/price but the category is ambiguous or missing, route it to `pending_category` instead of `needs_pricing` or `pending_review`. Keeps the category review queue separate from the pricing review queue.

---

### Burberry / premium brand comp caching
**Priority:** medium  
**Status:** open

Pre-seed `comparables.json` with known sold comps for high-value brands (Burberry, Golden Goose, Petite Plume, etc.) so these items price accurately out of the box without requiring a live search on first encounter.

---

### Track pricing provenance and cache freshness
**Priority:** high
**Status:** open

The current `comparables.json` cache stores finished price recommendations per brand/size/category but loses the raw comp data and doesn't track when entries were last updated.

**What to add per cache entry:**
- `lastUpdated` — ISO timestamp of when this entry was last refreshed (used for staleness判断)
- `source` — `'manual'` | `'live_search'` | `'seed'` so we know where it came from
- `rawComps` — array of the actual sold comp records used to calculate the price, each containing:
  - `title`, `soldPrice`, `soldDate`, `size`, `condition`, `url` (or equivalent Poshmark listing reference)
- `reasoning` — brief note on how the final price was derived (e.g. "median of 5 comps, excl. outliers")

**Why it matters:**
- If a price looks wrong later, you can open the cache entry and trace it back to the exact comps that produced it
- Stale entries (e.g. older than 30–60 days) can be flagged or auto-refreshed
- New brands that get their first comp via live search have a full audit trail from day one

**Files likely involved:**
- `src/lib/comparables.ts` — schema change + `saveComp()` / `updateComp()` functions
- `src/lib/pricing.ts` — store raw comps and reasoning alongside the price
- `src/types.ts` — `ComparableEntry` type redesign

---

## Done

- [x] Accept `needs_pricing` as a distinct status alongside `pending_review`
- [x] Add `Accepted Sell Price` column to sheet
- [x] Direct Poshmark edit flow (update title/description/price/condition on existing listings)
- [x] Bulk refresh stale posted listings (old boilerplate descriptions, generic titles)
- [x] Skip category edits in the update flow (category picker is flaky on edit)
- [x] Add backlog.md for features and bug fixes
