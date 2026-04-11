# ADR-0005: Item Status Tracking and State Machine

**Date:** 2026-04-11  
**Status:** Accepted  
**Deciders:** Chris Kirk, Seth McClintock

---

## Context

Each item in the Poshmark pipeline moves through a defined lifecycle. We need to track where every item is at all times so:
1. Chris always knows what's pending review, ready to post, needs shipping, etc.
2. The sub-agent can skip items it already processed
3. Nothing falls through the cracks

## Status State Machine

```
pending_review → ready_to_post → posted → needs_shipped → shipped → sold
                  ↑                                              ↓
                  └────────────── error ←─────────────────────────┘
```

| Status | Meaning | Who updates | Notes |
|--------|---------|-------------|-------|
| `pending_review` | Needs human input before posting | Seth → flags Chris | Auto-set when price > threshold, low confidence, or missing brand/size |
| `ready_to_post` | Processed, waiting for Chris to trigger posting | Seth | Chris explicitly says "post item-XXX" or approves via Telegram |
| `posted` | Live on Poshmark | Seth (browser automation) | URL stored in sheet |
| `needs_shipped` | Sold, Chris needs to pack & ship | Chris notifies Seth | Seth checks Poshmark periodically or Chris tells Seth directly |
| `shipped` | Chris has shipped it | Seth updates after Chris confirms | |
| `sold` | Payment received / transaction complete | Seth (Poshmark check) | |
| `error` | Something went wrong | Seth flags with error note | Can retry from this state |

## Design Decisions

### All items go through `ready_to_post` before posting
Chris always has a chance to review the sheet and the price before anything goes live. The sub-agent never auto-posts without explicit trigger.

### No automatic status transitions from Poshmark
The pipeline doesn't poll Poshmark for status changes automatically (browser automation for checking sold status is deferred). In practice:
- Chris tells Seth when an item ships: "item-002 shipped" → Seth sets `shipped`
- Seth periodically could check (future work), or Chris notifies Seth on sale

### Error recovery via `error` status
If vision analysis, pricing, or sheet write fails, the item gets `error` status with a note. Chris can re-trigger by dropping a new photo or telling Seth to retry.

## Implementation

```typescript
// src/types.ts
export type ItemStatus =
  | 'pending_review'  // needs human input
  | 'ready_to_post'   // waiting for post trigger
  | 'posted'          // live on Poshmark
  | 'needs_shipped'   // sold, waiting for Chris to ship
  | 'shipped'         // Chris shipped it
  | 'sold'            // payment received
  | 'error';          // failed, needs attention
```

**Sheet column:** Column N (`Status`) — updated in real-time by Seth.

**Telegram notifications:** Sent on `pending_review`, `ready_to_post`, `error`, and run summary after each session.
