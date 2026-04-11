# ADR-0002: Local Comparable Cache for Poshmark Sold Pricing Data

**Date:** 2026-04-11  
**Status:** Accepted  
**Deciders:** Chris Kirk, Seth McClintock

---

## Context

Pricing items on Poshmark requires knowing what similar items actually sold for. Each pricing call was making a fresh LLM search for sold comparables, which:
- Costs API tokens on every run
- Is slow (network latency + LLM inference)
- Finds different results each time (inconsistent pricing)
- Never reuses research from previous runs

Chris wanted a system that "remembers" comparable searches across runs so the same brand/size/type doesn't need to be searched twice.

## Decision

Store Poshmark sold comparable data in a local JSON file (`data/comparables.json`) indexed by `brand:itemType:size`.

**Cache structure:**
```json
{
  "version": 1,
  "entries": [{
    "key": "nike:shoes:6c",
    "brand": "Nike",
    "itemType": "shoes",
    "size": "6C",
    "sizeSystem": "us-kids",
    "items": [{ "title": "...", "price": 24, "soldDate": "2026-03-09", "url": "...", "condition": "good" }],
    "searchedAt": "2026-04-11T05:30:00.000Z",
    "sourceQuery": "nike shoes 6C poshmark sold"
  }]
}
```

**Lookup flow:**
1. `findComparables(brand, itemType, size)` → normalize key → check cache
2. Cache hit (valid, not expired) → return cached items instantly
3. Cache miss → search Poshmark via LLM → store result → return

**Expiry:** 30 days. Expired entries are skipped on lookup and replaced on next search.

## Alternatives Considered

### SQLite / better-sqlite3 (DEFERRED)
More scalable, supports complex queries, but adds a binary dependency and schema migration complexity. JSON file is sufficient for <10K entries at current scale.

### Redis / external cache (REJECTED)
Over-engineered for this use case. Adds infrastructure requirements.

### No caching (REJECTED)
Current state — every run makes fresh API calls.

## Consequences

**Positive:**
- Zero API cost for cached lookups (instant)
- Consistent pricing for the same items across runs
- Human-verified comps persist and can be inspected manually
- Builds a growing dataset of real Poshmark sold prices

**Negative:**
- Stale data after 30 days (mitigated by expiry)
- Single point of failure (file corruption — mitigated by try/catch)
- Cache key normalization is imperfect (e.g., "nike" vs "Nike" vs "NIKE" must normalize)

## Implementation

```typescript
// src/lib/comparables.ts
export async function findComparables(brand, itemType, size) {
  const cached = await getCached(brand, itemType, size);
  if (cached) return { items: cached.items, fromCache: true };

  const result = await searchPoshmarkSold(brand, itemType, size);
  if (result.items.length > 0) {
    await putCached(brand, itemType, size, result.sizeSystem, result.items, result.sourceQuery);
  }
  return { items: result.items, fromCache: false };
}
```

Cache file location: `data/comparables.json` (gitignored — contains live pricing data).
