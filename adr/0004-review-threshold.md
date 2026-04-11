# ADR-0004: Configurable Review Price Threshold

**Date:** 2026-04-11  
**Status:** Accepted  
**Deciders:** Chris Kirk, Seth McClintock

---

## Context

Items priced above a certain threshold should require human review before posting — either because they're high-value items where accuracy matters more, or because we'd rather verify pricing on expensive pieces.

The threshold was hardcoded at `$80`. This was fine as an initial value but needs to be configurable as the store evolves and Chris learns what price points make sense for review.

## Decision

Make the review price threshold a **configurable environment variable**:

```
REVIEW_PRICE_THRESHOLD=80  # in .env
```

Default: `$80`. Items priced ≥ `$80` automatically go to `pending_review` regardless of confidence or brand/size detection.

The threshold is read once at module load time via `env.ts` and used in `pricing.ts`:
- `needsReview` check in `analyzeItem()`
- `reviewReason` message in the notification

## Alternatives Considered

### No threshold (REJECTED)
Auto-post everything. Risky for high-value items — a wrong price on a $150 item wastes time and money.

### Percentage of comp price (DEFERRED)
Flag items where our price differs significantly from comp average. More nuanced but harder to tune. Could revisit if the flat threshold proves too coarse.

### Brand-based thresholds (REJECTED)
Different thresholds per brand (e.g., $60 for Gap, $120 for Lululemon). Overcomplicates config. Can add later if needed.

## Consequences

**Positive:**
- Easy to tune without code changes
- Stored in `.env` (gitignored) — can be changed per deployment
- Clear default: $80 is a sensible balance between review overhead and price protection

**Negative:**
- Runtime constant (read once at module load) — requires restart to change
- Two places to keep in sync if the threshold logic changes (already mitigated: single source of truth in `env.REVIEW_PRICE_THRESHOLD`)

## Implementation

```typescript
// src/lib/env.ts
export const REVIEW_PRICE_THRESHOLD = Number(process.env.REVIEW_PRICE_THRESHOLD ?? 80);

// src/lib/pricing.ts — used in analyzeItem()
if (pricing.price > REVIEW_PRICE_THRESHOLD) {
  reviewReason = `Price $${pricing.price} exceeds $${REVIEW_PRICE_THRESHOLD} threshold`;
}
```
