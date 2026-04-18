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

## Done

- [x] Accept `needs_pricing` as a distinct status alongside `pending_review`
- [x] Add `Accepted Sell Price` column to sheet
- [x] Direct Poshmark edit flow (update title/description/price/condition on existing listings)
- [x] Bulk refresh stale posted listings (old boilerplate descriptions, generic titles)
- [x] Skip category edits in the update flow (category picker is flaky on edit)
