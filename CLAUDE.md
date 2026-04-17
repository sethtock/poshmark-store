# CLAUDE.md

## Poshmark Store Repo Notes

Use this repo's real helpers, not ad hoc scripts, unless you are actively debugging.

### Canonical flows
- Process new Drive items: `npm start`
- Post all ready items: `npx tsx src/post-ready-batch.ts`
- Retry one ready item: `npx tsx src/post-single-ready.ts`
- Request fresh Poshmark OTP: `npm run poshmark:auth:request`
- Submit saved OTP challenge: `npm run poshmark:auth:submit -- 123456`

### Auth and session rules
- Reuse `data/poshmark-storage-state.json` whenever possible.
- Never request a second SMS code before trying the first one.
- Use `https://poshmark.com/sell` or `/create-listing`.
- Do not use `https://poshmark.com/modal/listing/create`.

### Vision / item-processing rules
- Prefer local converted JPEGs for vision when available.
- Vision now uses higher-detail local image analysis for better tag reading.
- Size extraction should look for tongue tags, inner labels, insole stamps, and sideways or upside-down photos.
- Normalize kids shoe sizes like `6C`, `7C`, `2Y`, `EU 23.5`, and `US Toddler 7`.
- Known improved brand cues include Golden Goose, Vans, and Janie and Jack.

### Posting rules
- Treat `moccasins` and `crib shoes` as footwear so they map to Poshmark Shoes.
- After batch posting, verify the sheet shows both `status=posted` and a `Poshmark URL`.
- If posting appears to fail, check the closet directly before assuming the listing is missing.

### Current known-good state
- Batch posting is working with the saved session.
- Recent fixes:
  - `3f66389` Improve vision size-tag detection for kids shoes
  - `0622d0e` Treat moccasins as footwear in Poshmark posting
