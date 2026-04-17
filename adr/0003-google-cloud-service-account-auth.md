# ADR-0003: Google Cloud Service Account for Drive + Sheets Access

**Date:** 2026-04-11  
**Status:** Accepted  
**Deciders:** Chris Kirk, Seth McClintock

---

## Context

The Poshmark pipeline needs programmatic read/write access to:
- **Google Drive:** Read item photo folders, write tracking spreadsheet
- **Google Sheets:** Write/update inventory tracking spreadsheet

Chris's personal Google account (`sethtock@gmail.com`) is used for the main gog CLI, but the server-side pipeline needs its own credentials that don't expire when Chris re-authenticates gog.

## Decision

Create a dedicated Google Cloud project and service account:

**Service account:** dedicated service account for Drive + Sheets access (email intentionally not published)

**Setup:**
1. Google Cloud project `poshmark-store` with Drive API + Sheets API enabled
2. Service account with **Project → Editor** role
3. JSON key file stored on server at `service-account-key.json`
4. Drive folder + spreadsheet shared with service account email (Writer access)

**Why dedicated service account (not OAuth user credentials):**
- No refresh token expiry
- No browser-based OAuth flow required
- Key file can be revoked/rotated independently
- Principle of least privilege — only has access to the specific resources it needs

## Alternatives Considered

### gog OAuth credentials (EXISTING)
Chris's gog CLI uses OAuth with his personal account. Could use the same credentials for the pipeline. Rejected because:
- Token refresh tied to gog's keyring setup on the server
- Personal account credentials shouldn't be used for automated server processes
- Less auditable — actions blend with Chris's personal account

### Chris's personal OAuth token (REJECTED)
Same issues as above.

## Consequences

**Positive:**
- Fully automated, no manual auth steps
- Credentials independent of Chris's personal Google session
- Can be scoped to only the Poshmark Drive folder and spreadsheet
- Audit trail in Google Cloud logs shows which service account accessed what

**Negative:**
- Service account email must be manually shared on each Drive folder/spreadsheet
- Key file must be kept secure (gitignored, not in repo)
- If key is compromised, must revoke and create new one

## Security Notes

- `service-account-key.json` is in `.gitignore` — never committed
- `GOOGLE_SERVICE_ACCOUNT_KEY` env var points to the file path
- Only the dedicated service account has access to the Drive folder and spreadsheet for automation — Chris's personal account still owns the data
