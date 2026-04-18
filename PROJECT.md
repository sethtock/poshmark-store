# Poshmark Store Automation — Project Plan

## Overview
Automated Poshmark selling pipeline: photos land in Google Drive → Seth (sub-agent) processes, prices, posts, and tracks everything in Google Sheets.

**Owner:** Seth McClintock (sub-agent)  
**Human:** Chris Kirk  
**Created:** 2026-04-09

---

## Architecture

```
[Chris photos items]
       ↓
[Google Drive folder]  ← folder-per-item structure
       ↓
[Seth sub-agent (watcher)]  ← triggered on new photos
       ↓
[Vision AI analysis]  ← describe item, brand, size, condition
       ↓
[Pricing engine]  ← rule-based + Poshmark sold data
       ↓
[Browser automation → Poshmark]  ← login, upload, post
       ↓
[Google Sheets]  ← track everything: status, links, price, sold, shipped
       ↓
[Telegram ping to Chris]  ← pending review notifications
```

---

## Folder Structure (Google Drive)

```
Poshmark Store/                    (folder ID configured in env)
└── Inputs/                        (folder ID configured in env)
    ├── item-001/          ← one folder per item
    │   ├── photo1.jpg
    │   ├── photo2.jpg
    │   └── photo3.jpg
    ├── item-002/
    │   ├── photo1.jpg
    │   └── photo2.jpg
    └── ...
```

Chris creates a numbered folder per item, drops all photos in. Sub-agent scans for new folders in the Inputs folder.

---

## Item Status Flow

| Status | Meaning | Who updates |
|---|---|---|
| `needs_pricing` | Missing cached comparable pricing, do not auto-post | Seth |
| `pending_review` | Needs human input before posting | Seth → flags Chris |
| `ready_to_post` | Processed, approved, waiting to be posted | Seth (after approval or auto-process) |
| `posted` | Live on Poshmark | Seth (browser automation, triggered by Chris) |
| `needs_shipped` | Sold, Chris needs to pack & ship | Chris tells Seth |
| `shipped` | Chris has shipped it | Seth updates after Chris confirms |
| `sold` | Payment received / transaction complete | Seth (browser check or Chris says) |
| `error` | Something went wrong | Seth flags with error note |

**Note:** Only postable items go through `ready_to_post` before posting. Items without cached comparable pricing stay `needs_pricing`. Items missing critical fields like size stay `pending_review` so Chris can fix them first.

---

## Workflow Detail

### Full Pipeline (per item)
1. New folder detected in Drive `Inputs/`
2. Collect all photos from folder
3. For each item:
   a. Run vision AI on cover photo → structured description (brand, type, size, color, condition)
   b. Web search for Poshmark sold comparables → get pricing data
   c. Apply pricing rules → set price
   d. If sold comps are unavailable and this brand/item/size is not already in the local comparable cache → set status `needs_pricing`
   e. If price > $80 OR low confidence OR no brand/size (including junk values like `null`) → set status `pending_review`, ping Chris on Telegram with details
   f. If auto-processable:
      - Set status `ready_to_post`
      - Update Google Sheet row with all details (description, brand, size, price, pricing reasoning, confidence)
      - Ping Chris on Telegram: "Ready to Post" with approve/post button
   g. Chris tells Seth to post (via Telegram or by saying "post item-003")
   h. Seth runs browser automation → Poshmark listing created → status `posted`

### Post-Sale Flow
1. Chris notifies Seth: "item-003 shipped" (or Seth checks Poshmark periodically)
2. Seth updates status → `shipped`
3. Seth periodically checks Poshmark for "sold" status
4. On confirmed sale → status `sold`

### Pending Review Notification (Telegram)
When an item lands in `pending_review`, Seth sends Chris a Telegram message with:
- Item description
- Detected brand / size / condition
- Suggested price
- Photos (Drive links)
- "Approve price $X" or "Adjust and post" or "Skip"

Chris replies → Seth proceeds or adjusts.

---

## Google Sheets Structure

### Tab: `All Items`
Columns: `Item ID` | `Date Added` | `Folder Name` | `Drive Folder` | `Title` | `Description` | `Brand` | `Size` | `Condition` | `Category` | `Photo Links` | `List Price` | `Current Price` | `Accepted Sell Price` | `Poshmark URL` | `Status` | `Pricing Reasoning` | `Confidence` | `Notes`

- **List Price** = original / anchor list price
- **Current Price** = live asking price
- **Accepted Sell Price** = final accepted or sold amount

### Tab: `Summary`
- Total items processed
- Items by status (count)
- Total listed value
- Total sold value
- Average sell price

### Conditional Formatting
- `needs_pricing` → light orange
- `pending_review` → yellow
- `ready_to_post` → gray (needs Chris action to post)
- `posted` → blue
- `needs_shipped` → orange
- `shipped` → purple
- `sold` → green
- `error` → red

---

## Pricing Engine

- Comparable cache hit: may use sold comps or cached pricing context directly
- Comparable cache miss: do not auto-post on rule-based pricing alone, mark `needs_pricing`
- Rule-based pricing remains a fallback only when the brand/item/size already has cached comparable context
- Items >$80 → `pending_review` (one-off manual review)
- Items with low brand/type confidence → `pending_review`
- All others → auto-post

---

## Sub-Agent: Seth-Poshmark

- **Runtime:** `subagent`
- **Trigger:** New folder in Google Drive OR manual trigger via message
- **Schedule:** Can also run daily to check for new items and sync Poshmark status
- **Owned by:** Main Seth agent
- **Behavior:**
  1. Scan Drive `Inputs/` for folders with no corresponding sheet row
  2. Process each through pipeline above
  3. Update Google Sheet in real-time
  4. Ping Chris on Telegram for `pending_review` items
  5. Periodically check Poshmark for status changes on `posted` items
  6. Report run summary to Chris after each session

---

## Open Questions / Decisions

- [x] **Poshmark account:** Personal
- [x] **Photo grouping:** Folder per item (item-001, item-002, etc.)
- [x] **Brands:** TBD — leave open, add as Chris identifies
- [x] **Listings:** One listing per item, all photos included
- [x] **Notifications:** Ping on Telegram + status in sheet
- [x] **Auto-update sheet:** Yes, Seth handles everything
- [x] **Shipping statuses:** Yes — `needs_shipped` and `shipped` added to flow
- [x] **Poshmark login credentials:** Stored in `.env`
- [x] **Google Cloud project / service account:** Set up for Drive + Sheets API
- [x] **Browser automation setup:** Playwright-based posting flow working on the server
- [ ] **Poshmark status sync frequency:** How often should Seth check Poshmark for sold/shipped updates?
- [ ] **Listing polish:** Improve generic footwear titles like `Nike Footwear 6C` into more descriptive titles before posting

---

## Build Order

1. **Google Cloud setup** — Drive + Sheets API, service account, share folders
2. **Spreadsheet template** — Create the sheet with tabs and column headers
3. **Drive folder setup** — Create `Inputs/` structure, share with service account
4. **Credential storage** — Poshmark login in env vars
5. **Sub-agent code** — Build the processing pipeline
6. **Browser automation** — Playwright script for Poshmark login + post
7. **Telegram integration** — Notification flow for pending review
8. **Test run** — 3-5 items end-to-end
9. **Go live** — Chris starts dropping items

---

## Status

**Phase:** Google Drive & Sheets setup complete, Poshmark auth/session bootstrap working, ready-to-post batch listing flow working end-to-end
**GitHub:** https://github.com/sethtock/poshmark-store

### ✅ Completed
- **Poshmark folder created** — configured in env / Drive
- **Inputs folder created** — configured in env / Drive
- **Spreadsheet created** — configured in env / Sheets
  - Tab "All Items" with headers
  - Tab "Summary" with headers
- **Poshmark credentials stored** in `.env`
- **gog (Google Workspace CLI)** configured with OAuth access
- **Google Cloud service account** — configured and shared with the required Drive/Sheets resources
  - JSON key saved to `service-account-key.json`
  - Drive + Sheets APIs enabled
  - Drive folder + spreadsheet shared with service account (writer access)
- **HEIC photo conversion** — Drive thumbnail CDN converts HEIC→JPEG automatically
- **Comparable cache** — local JSON cache stores Poshmark sold comps (30-day expiry, brand:itemType:size key)
- **Vision analysis** — works with local JPEG files (base64 encoded)
- **Automated tests** — Vitest unit tests for pricing, comparables, vision logic
- **ADRs** — architecture decision records for HEIC conversion, comparable cache, service account auth
- **Poshmark auth bootstrap** — two-step OTP flow works and saves reusable session state to `data/poshmark-storage-state.json`
- **Saved OTP challenge flow** — request and submit are split so submitting a code no longer triggers another SMS
- **Current listing entry path identified** — `/sell` redirects to `/create-listing`; old `/modal/listing/create` route is stale
- **Ready-item posting flow working** — `src/post-ready-batch.ts` and `src/post-single-ready.ts` successfully post listings and update the sheet to `posted`
- **Direct listing edit flow working** — `src/update-sheet-item-on-poshmark.ts` can push title/description/price updates from a sheet row back to an existing Poshmark listing
- **Vision size-tag detection improved** — higher-detail local analysis plus sideways-tag handling now correctly extracts sizes like `6C`
- **Footwear category mapping improved** — moccasins and crib shoes now map to Poshmark Shoes so baby moccasin listings can post cleanly

### ⏳ Waiting On
- **Listing title polish** — improve generic footwear titles before posting so listings are more descriptive by default
- **Poshmark status sync frequency** — decide how often to check posted listings for sold / shipped updates

## ⚠️ Poshmark Login — Phone Verification Required

Chris's Poshmark account requires SMS verification, but the working flow is now documented and codified:

1. Run `npm run poshmark:auth:request`
2. Poshmark sends one fresh SMS code
3. Run `npm run poshmark:auth:submit -- 123456`
4. The script reuses the saved challenge, exchanges the code for an `entry_token`, replays login, and saves session state

Important guardrails:
- Keep request and submit as separate steps
- Do **not** request a second code before trying the first one
- Reuse `data/poshmark-storage-state.json` once auth succeeds
- Use `/sell` or `/create-listing`, not `/modal/listing/create`
- Use `src/post-ready-batch.ts` or `src/post-single-ready.ts` for real posting runs instead of ad hoc debug scripts

**Credentials:** stored in `.env` via `POSHMARK_EMAIL` / `POSHMARK_PASSWORD`, not in docs.
