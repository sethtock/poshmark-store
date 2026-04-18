# Poshmark Store Automation 🤖

Automated Poshmark selling pipeline — photos land in Google Drive → AI analyzes + prices → Playwright posts → Google Sheets tracks everything.

## What It Does

1. **Watches Google Drive** for new folder-per-item photo drops
2. **Analyzes photos** via vision AI to extract brand, size, color, condition
3. **Prices items** using Poshmark sold comparables, with cache-gated rule-based fallback only for previously cached brand/item/size combos
4. **Posts through a saved Poshmark session** with documented SMS bootstrap, batch posting helpers, and verified `/sell` → `/create-listing` flow; flags expensive/low-confidence items for review
5. **Tracks everything** in a Google Sheet with status flow: `needs_pricing → pending_review → ready_to_post → posted → needs_shipped → shipped → sold`
6. **Notifies you** on Telegram when review is needed or items are posted

## Architecture

```
[Chris photos] → [Google Drive] → [Seth sub-agent] → [Vision AI + Pricing]
                                                        ↓
                                              [Playwright → Poshmark]
                                                        ↓
                                            [Google Sheets + Telegram]
```

## Status Flow

`needs_pricing` → `pending_review` → `ready_to_post` → `posted` → `needs_shipped` → `shipped` → `sold`

Items land in `needs_pricing` when pricing falls back to rules without a matching comparable cache entry. Items are flagged for review when they are >$80, low confidence, missing brand/size, or contain junk placeholders like `null` in required fields.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Fill in all required values
```

**Required env vars:**
- `POSHMARK_EMAIL` / `POSHMARK_PASSWORD` — Poshmark credentials
- `GOOGLE_SERVICE_ACCOUNT_KEY` — JSON service account key (or path to .json file)
- `DRIVE_FOLDER_ID` — ID of the `Poshmark Store / Inputs` folder
- `SPREADSHEET_ID` — ID of the tracking spreadsheet
- `TELEGRAM_BOT_TOKEN` — Bot token for notifications
- `TELEGRAM_CHAT_ID` — Your Telegram chat ID

### 3. Google Cloud Setup

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com)
2. Enable **Google Drive API** and **Google Sheets API**
3. Create a **Service Account** with "Project → Editor" role
4. Download the JSON key file
5. Share your Drive folder + spreadsheet with the service account email

### 4. Create the spreadsheet

```bash
npm run setup:sheets
```

### 5. Test with a few items

Drop 2-3 items in Drive and run:

```bash
npm start
```

## Usage

### Manual run
```bash
npm start
```

### Post items that are ready
```bash
# Post every row currently marked ready_to_post
npx tsx src/post-ready-batch.ts

# Retry the first ready_to_post row only
npx tsx src/post-single-ready.ts

# Push the current sheet values for one already-posted item back to Poshmark
npm run poshmark:update-item -- item-031
```

Note: the direct edit flow currently updates title, description, price, condition, brand, and size, but it intentionally skips category changes because Poshmark's edit-category picker is flaky. If a category needs to change, update that one manually in Poshmark.

### Poshmark auth bootstrap

Use the durable two-step auth flow, not ad hoc login retries:

1. Request one fresh SMS code and save the pending challenge:

```bash
npm run poshmark:auth:request
```

2. Submit the fresh code against that saved challenge, without generating another SMS:

```bash
npm run poshmark:auth:submit -- 123456
```

Important paths:
- saved session: `data/poshmark-storage-state.json`
- saved pending OTP challenge: `data/poshmark-pending-auth.json`
- API trace log: `data/poshmark-api-capture.jsonl`
- real listing entry path: `https://poshmark.com/sell` → `/create-listing`

Do not use `https://poshmark.com/modal/listing/create`, it currently returns 404.

For the full auth notes, see `docs/poshmark-auth.md`.

### Run on a schedule (cron)
```bash
# Run every hour
0 * * * * cd /path/to/poshmark-store && npm start >> /var/log/poshmark.log 2>&1
```

### Via sub-agent (from main Seth)
Triggered automatically when new items appear in Drive, or manually:
- Tell Seth: "run the Poshmark agent" or "check for new Poshmark items"

## Drive Folder Structure

```
Poshmark Store/
└── Inputs/
    ├── item-001/
    │   ├── photo1.jpg
    │   └── photo2.jpg
    └── item-002/
        └── photo1.jpg
```

## Google Sheet Tabs

- **All Items** — Full inventory with all columns
- **Summary** — Stats dashboard (counts, total listed/sold value)

Price columns on `All Items` now mean:
- **List Price** — original / anchor price for the listing
- **Current Price** — current asking price on Poshmark
- **Accepted Sell Price** — actual accepted / final sold amount when the item sells

## Operator Notes

- Prefer local converted JPEGs for photo analysis when available.
- Vision is tuned to inspect size tags carefully, including sideways or upside-down tag photos.
- Kids shoe size normalization now handles values like `6C`, `7C`, `2Y`, `EU 23.5`, and `US Toddler 7`.
- For Poshmark category mapping, treat moccasins and crib shoes as footwear.
- After posting, verify the sheet has both `status=posted` and a populated Poshmark URL.

## License

MIT — Chris Kirk, 2026
