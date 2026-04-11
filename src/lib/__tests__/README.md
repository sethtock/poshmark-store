# Tests

Uses [Vitest](https://vitest.dev/) for unit tests.

## Running Tests

```bash
# Run once
npm run test:ci

# Run with watch
npm run test

# Run specific test
npx vitest run src/lib/__tests__/pricing.test.ts
```

## Test Structure

| File | What it tests |
|------|--------------|
| `comparables.test.ts` | Cache key normalization, expiry detection, size system inference |
| `pricing.test.ts` | Condition/brand multipliers, base prices, pricing formula, description generation |
| `vision.test.ts` | URL/path detection, base64 encoding, JSON parsing, merge logic |

## Pre-Merge Requirement

`npm run test:ci` must pass before merging any PR. This runs in CI without watch mode.

## Writing Tests

Tests focus on **pure logic** — functions that take inputs and return deterministic outputs without network calls or filesystem access. This makes tests fast, reliable, and easy to run in CI.

For tests that need mocking (network calls, file I/O), use Vitest's `vi.mock()` or `fetch` mocking utilities. Currently the test suite avoids these by testing at the pure-logic layer.

## Test Data Directory

Tests use the real `data/` directory for cache operations. Cache files created during tests are cleaned up in `afterEach`.
