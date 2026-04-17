# Poshmark Auth Flow

This project now has a durable, documented Poshmark auth bootstrap. The SMS verification flow should not need to be rediscovered again.

## Why it exists

For this account, `POST /vm-rest/auth/users/access_token` returns `EntryTokenRequired` until an SMS challenge is completed.

The successful flow is:

1. login attempt
2. `POST /vm-rest/auth/otp_requests`
3. `POST /vm-rest/auth/entry_tokens`
4. replay login with the returned `entry_token`

If you request a new OTP before using the previous one, Poshmark invalidates the earlier SMS code.

## Canonical two-step flow

### 1. Request one SMS code

```bash
npm run poshmark:auth:request
```

This triggers the OTP request once and saves the pending challenge to:

- `data/poshmark-pending-auth.json`

### 2. Submit that exact code

```bash
npm run poshmark:auth:submit -- 123456
```

This reuses the saved challenge, submits the OTP, extracts the returned `entry_token`, and replays login.

On success it saves:

- browser/session state: `data/poshmark-storage-state.json`
- request/response trace: `data/poshmark-api-capture.jsonl`

## Known-good URLs

- login: `https://poshmark.com/login`
- create listing entry: `https://poshmark.com/sell`
- final create listing page: `https://poshmark.com/create-listing`

Do **not** use `https://poshmark.com/modal/listing/create`, it currently returns 404.

## Session facts worth preserving

After OTP succeeds, the replayed auth response contains:

- `data.auth.isUserLoggedIn = true`
- user id in `data.ui.uid`
- closet handle in `data.ui.dh`

The code now treats those as canonical fallbacks when page state is incomplete.

## Operator rules

- Never request a second code before trying the first one
- Submit the code immediately after it arrives
- Reuse saved storage state instead of forcing login again
- If auth fails, inspect `data/poshmark-api-capture.jsonl` before requesting another SMS
- For real listing runs, prefer `src/post-ready-batch.ts` or `src/post-single-ready.ts` over one-off debug scripts

## Posting notes

- The current verified listing entry path is `https://poshmark.com/sell` which lands on `/create-listing`.
- Batch posting is working with the saved storage state.
- Moccasins and crib shoes should be treated as footwear when mapping categories for Poshmark.
