# Poshmark Store Automation 🤖

Automated Poshmark selling pipeline — photos land in Google Drive → AI analyzes + prices → Playwright posts → Google Sheets tracks everything.

## What It Does

1. **Watches Google Drive** for new folder-per-item photo drops
2. **Analyzes photos** via vision AI to extract brand, size, color, condition
3. **Prices items** using Poshmark sold comparables + rule-based engine
4. **Posts through a saved Poshmark session** with documented SMS bootstrap; flags expensive/low-confidence items for review
5. **Tracks everything** in a Google Sheet with status flow: `pending_review → ready_to_post → posted → needs_shipped → shipped → sold`
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

`pending_review` → `ready_to_post` → `posted` → `needs_shipped` → `shipped` → `sold`

Items flagged for review: >$80, low confidence, no brand detected, no size detected, or junk placeholders like `null` in required fields.

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
- `DRIVE_FOLDER_ID` — ID of the "Poshmark Store / New Items" folder
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
└── New Items/
    ├── item-001/
    │   ├── photo1.jpg
    │   └── photo2.jpg
    └── item-002/
        └── photo1.jpg
```

## Google Sheet Tabs

- **All Items** — Full inventory with all columns
- **Summary** — Stats dashboard (counts, total listed/sold value)

## License

MIT — Chris Kirk, 2026
