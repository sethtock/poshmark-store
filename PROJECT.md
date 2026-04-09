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
Poshmark Store/
└── New Items/
    ├── item-001/          ← one folder per item
    │   ├── photo1.jpg
    │   ├── photo2.jpg
    │   └── photo3.jpg
    ├── item-002/
    │   ├── photo1.jpg
    │   └── photo2.jpg
    └── ...
```

Chris creates a numbered folder per item, drops all photos in. Sub-agent scans for new folders.

---

## Item Status Flow

| Status | Meaning | Who updates |
|---|---|---|
| `pending_review` | Needs human input before posting | Seth → flags Chris |
| `draft` | Ready but not yet posted | Seth |
| `posted` | Live on Poshmark | Seth (browser automation) |
| `needs_shipped` | Sold, Chris needs to pack & ship | Chris tells Seth |
| `shipped` | Chris has shipped it | Seth updates after Chris confirms |
| `sold` | Payment received / transaction complete | Seth (browser check or Chris says) |
| `error` | Something went wrong | Seth flags with error note |

**Note:** `needs_shipped` and `shipped` are manual triggers — Chris physically ships the item. He'll tell Seth when it's done, or Seth can periodically check Poshmark to sync state.

---

## Workflow Detail

### Full Pipeline (per item)
1. New folder detected in Drive "New Items/"
2. Collect all photos from folder
3. For each item:
   a. Run vision AI on cover photo → structured description (brand, type, size, color, condition)
   b. Web search for Poshmark sold comparables → get pricing data
   c. Apply pricing rules → set price
   d. If price > $80 OR low confidence → set status `pending_review`, ping Chris on Telegram with details, skip posting
   e. If auto-postable:
      - Set status `draft`
      - Browser automation logs into Poshmark
      - Creates listing with all photos + AI-generated description
      - Publishes
      - Captures listing URL
      - Sets status `posted`
   f. Update Google Sheet row with all details + URL + status

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
Columns: `Item ID` | `Date Added` | `Folder Name` | `Description` | `Brand` | `Size` | `Condition` | `Category` | `Photo Links` | `Initial Price` | `Current Price` | `Poshmark URL` | `Status` | `Notes`

### Tab: `Summary`
- Total items processed
- Items by status (count)
- Total listed value
- Total sold value
- Average sell price

### Conditional Formatting
- `pending_review` → yellow
- `posted` → blue
- `needs_shipped` → orange
- `shipped` → purple
- `sold` → green
- `error` → red

---

## Pricing Engine

- Base rules: brand + item type + condition → starting price
- Web search: Poshmark sold comps for similar items
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
  1. Scan Drive "New Items/" for folders with no corresponding sheet row
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
- [ ] **Poshmark login credentials:** Need to store email + password securely
- [ ] **Google Cloud project / service account:** Need to set up for Drive + Sheets API
- [ ] **Browser automation setup:** Playwright or Puppeteer on the server
- [ ] **Poshmark status sync frequency:** How often should Seth check Poshmark for sold/shipped updates?

---

## Build Order

1. **Google Cloud setup** — Drive + Sheets API, service account, share folders
2. **Spreadsheet template** — Create the sheet with tabs and column headers
3. **Drive folder setup** — Create "New Items/" structure, share with service account
4. **Credential storage** — Poshmark login in env vars
5. **Sub-agent code** — Build the processing pipeline
6. **Browser automation** — Playwright script for Poshmark login + post
7. **Telegram integration** — Notification flow for pending review
8. **Test run** — 3-5 items end-to-end
9. **Go live** — Chris starts dropping items

---

## Status

**Phase:** Planning (answers mostly complete)  
**Building:** Not started  
**Waiting on:** Google Cloud setup, Poshmark credentials, browser automation decision
