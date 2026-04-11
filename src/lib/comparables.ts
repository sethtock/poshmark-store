// Comparable cache — stores Poshmark sold listing data for future pricing lookups

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { ComparableItem } from '../types.js';

const CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const CACHE_FILE = join(CACHE_DIR, 'comparables.json');
const CACHE_MAX_AGE_DAYS = 30;

export interface ComparableEntry {
  /** Normalized cache key: brand:itemType:size */
  key: string;
  brand: string;
  itemType: string;
  size: string;
  sizeSystem: 'us-kids' | 'us-womens' | 'us-mens' | 'unknown';
  items: ComparableItem[];
  searchedAt: string; // ISO date
  sourceQuery: string;
}

interface CacheStore {
  version: number;
  entries: ComparableEntry[];
}

function normalizeKey(brand: string, itemType: string, size: string): string {
  const b = (brand ?? '').toLowerCase().trim();
  const t = (itemType ?? '').toLowerCase().trim();
  const s = (size ?? '').toLowerCase().trim();
  return `${b}:${t}:${s}`;
}

function isExpired(entry: ComparableEntry): boolean {
  const age = (Date.now() - new Date(entry.searchedAt).getTime()) / (1000 * 60 * 60 * 24);
  return age > CACHE_MAX_AGE_DAYS;
}

export async function ensureCacheDir(): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
}

async function loadCache(): Promise<CacheStore> {
  try {
    const data = await readFile(CACHE_FILE, 'utf-8');
    return JSON.parse(data) as CacheStore;
  } catch {
    return { version: 1, entries: [] };
  }
}

async function saveCache(cache: CacheStore): Promise<void> {
  await ensureCacheDir();
  await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
}

/**
 * Look up a cached comparable entry. Returns null if not found or expired.
 */
export async function getCached(brand: string, itemType: string, size: string): Promise<ComparableEntry | null> {
  const cache = await loadCache();
  const key = normalizeKey(brand, itemType, size);
  const entry = cache.entries.find((e) => e.key === key);
  if (!entry) return null;
  if (isExpired(entry)) return null;
  return entry;
}

/**
 * Store a comparable entry in the cache.
 */
export async function putCached(
  brand: string,
  itemType: string,
  size: string,
  sizeSystem: ComparableEntry['sizeSystem'],
  items: ComparableItem[],
  sourceQuery: string,
): Promise<void> {
  const cache = await loadCache();
  const key = normalizeKey(brand, itemType, size);

  // Remove existing entry with same key
  cache.entries = cache.entries.filter((e) => e.key !== key);

  // Add new entry
  cache.entries.push({
    key,
    brand: brand ?? '',
    itemType: itemType ?? '',
    size: size ?? '',
    sizeSystem,
    items,
    searchedAt: new Date().toISOString(),
    sourceQuery,
  });

  await saveCache(cache);
  console.log(`[comparable-cache] Stored ${items.length} comps for "${key}"`);
}

/**
 * Get all cached entries (for inspection/debugging).
 */
export async function getAllCached(): Promise<ComparableEntry[]> {
  const cache = await loadCache();
  return cache.entries;
}

/**
 * Search Poshmark for sold listings matching the given criteria.
 * Uses web search to find sold Poshmark listings.
 */
export async function searchPoshmarkSold(brand: string, itemType: string, size: string): Promise<{
  items: ComparableItem[];
  sourceQuery: string;
  sizeSystem: ComparableEntry['sizeSystem'];
}> {
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return { items: [], sourceQuery: '', sizeSystem: 'unknown' };
  }

  // Build search query
  const sizeSystem = inferSizeSystem(size);
  const sizeQuery = normalizeSizeForSearch(size, sizeSystem);
  const query = `${brand} ${itemType} ${sizeQuery} poshmark sold -boots -sandals size:${sizeQuery}`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a Poshmark research assistant. Search for SOLD listings on Poshmark for the item described. Return a JSON array of sold comparables.

For each sold listing found, return:
{
  "title": "exact listing title",
  "price": number (actual sold price in dollars, no $ sign),
  "soldDate": "YYYY-MM-DD or relative like '2 weeks ago'",
  "url": "poshmark.com listing URL if known, otherwise empty string",
  "condition": "nwt/nwot/like_new/good/fair"
}

Rules:
- Only include items that actually SOLD (not just listed)
- Price should be what it sold for, not the listing price
- If no sold listings found, return empty array []
- Return ONLY valid JSON array, no markdown, no explanation
- Include as many real sold comps as you can find (up to 10)`,
          },
          {
            role: 'user',
            content: `Find recently SOLD Poshmark listings for: ${brand} ${itemType}, size ${sizeQuery} (${sizeSystem}). Look for actual sold prices, not asking prices.`,
          },
        ],
        max_tokens: 800,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('[comparable-search] API error:', response.status, text);
      return { items: [], sourceQuery: query, sizeSystem };
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? '';
    const jsonStr = content.replace(/```json\n?|```\n?/g, '').trim();

    let items: ComparableItem[] = [];
    try {
      items = JSON.parse(jsonStr) as ComparableItem[];
      // Filter out any items without valid price
      items = items.filter((item) => typeof item.price === 'number' && item.price > 0);
    } catch {
      console.error('[comparable-search] Failed to parse result:', jsonStr.substring(0, 200));
    }

    console.log(`[comparable-search] Found ${items.length} sold comps for ${brand} ${itemType} size ${sizeQuery}`);
    return { items, sourceQuery: query, sizeSystem };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[comparable-search] Error:', msg);
    return { items: [], sourceQuery: query, sizeSystem };
  }
}

function inferSizeSystem(size: string): ComparableEntry['sizeSystem'] {
  const s = (size ?? '').toLowerCase();
  // Kids sizes: 0C-13C, 1Y-7Y, 2T-5T (toddler)
  if (/^\d+(\.\d+)?[cmcy]$/i.test(s)) return 'us-kids';
  // Womens sizes: 5-9 (numeric only)
  if (/^\d+$/.test(s)) {
    const n = parseInt(s);
    if (n >= 5 && n <= 9) return 'us-womens';
    if (n >= 10) return 'us-mens';
  }
  return 'unknown';
}

function normalizeSizeForSearch(size: string, system: ComparableEntry['sizeSystem']): string {
  const s = (size ?? '').trim();
  if (system === 'us-kids') {
    // Convert "6C" to "6C" or "6" for search
    return s.replace(/^(\d+)C$/i, '$1C').replace(/^(\d+)Y$/i, '$1Y');
  }
  return s;
}

/**
 * Search for comparables, checking cache first.
 */
export async function findComparables(
  brand: string,
  itemType: string,
  size: string,
): Promise<{ items: ComparableItem[]; fromCache: boolean }> {
  // Check cache first
  const cached = await getCached(brand, itemType, size);
  if (cached) {
    console.log(`[comparable-cache] HIT for "${cached.key}": ${cached.items.length} comps`);
    return { items: cached.items, fromCache: true };
  }

  console.log(`[comparable-cache] MISS for "${normalizeKey(brand, itemType, size)}" — searching...`);
  const result = await searchPoshmarkSold(brand, itemType, size);

  if (result.items.length > 0) {
    await putCached(brand, itemType, size, result.sizeSystem, result.items, result.sourceQuery);
  }

  return { items: result.items, fromCache: false };
}
