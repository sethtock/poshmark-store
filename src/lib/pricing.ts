// Pricing engine — rule-based pricing with Poshmark sold comparables

import type { Item, PricingResult, ComparableItem } from '../types.js';
import { findComparables } from './comparables.js';
import { loadEnv, REVIEW_PRICE_THRESHOLD } from './env.js';
loadEnv(); // Ensure env vars are loaded before reading REVIEW_PRICE_THRESHOLD

type Confidence = 'high' | 'medium' | 'low';

const CONDITION_MULTIPLIERS: Record<string, number> = {
  nwt: 0.85,      // New with Tags — top condition
  nwot: 0.80,     // New without Tags
  like_new: 0.75, // Worn once or twice, no visible wear
  good: 0.65,     // Normal used wear
  fair: 0.40,     // Significant wear
};

const BRAND_MULTIPLIERS: Record<string, number> = {
  // Premium brands
  lululemon: 0.90, patagonia: 0.85, nike: 0.75, gap: 0.75,
  'old navy': 0.60, 'gymboree': 0.60, 'child of mine': 0.55,
  carters: 0.55, oshkosh: 0.55, chuck: 0.75,
  // Mid-tier
  hm: 0.50, zara: 0.55,
  // High-end
  'janie and jack': 0.85, mik俏: 0.80, stellarluna: 0.80,
  'vineyard vines': 0.80, 'tommy hilfiger': 0.75,
  // Kids designer
  'little marc jacobs': 0.85, 'gucci kids': 0.90,
};

const TYPE_BASE_PRICES: Record<string, number> = {
  'shirt': 15, 'tee': 12, 't-shirt': 12, 'top': 14, 'blouse': 15,
  'pants': 18, 'jean': 20, 'legging': 12, 'shorts': 14,
  'dress': 22, 'romper': 18, 'jumpsuit': 20,
  'jacket': 25, 'coat': 30, 'hoodie': 22, 'sweater': 20,
  'pajama': 14, 'swimsuit': 16,
  'shoe': 25, 'sneaker': 30, 'boot': 28, 'sandal': 15,
  'hat': 10,
};

function getBasePrice(itemType: string | null): number {
  if (!itemType) return 15;
  const lower = itemType.toLowerCase();
  for (const [key, price] of Object.entries(TYPE_BASE_PRICES)) {
    if (lower.includes(key)) return price;
  }
  return 15;
}

function getBrandMultiplier(brand: string | null): number {
  if (!brand) return 0.45;
  const lower = brand.toLowerCase();
  for (const [key, mult] of Object.entries(BRAND_MULTIPLIERS)) {
    if (lower.includes(key)) return mult;
  }
  return 0.45;
}

export interface AnalyzeResult {
  item: Item;
  pricing: PricingResult;
  needsReview: boolean;
  reviewReason?: string;
}

/**
 * Analyze a single item — generate description + pricing.
 * This is called by the sub-agent for each new item folder.
 */
export async function analyzeItem(item: Item): Promise<AnalyzeResult> {
  const description = generateDescription(item);
  const pricing = await calculatePricing(item, description);

  const needsReview =
    pricing.confidence === 'low' ||
    (pricing.price > REVIEW_PRICE_THRESHOLD) ||
    !item.brand ||
    !item.size;

  let reviewReason: string | undefined;
  if (pricing.price > REVIEW_PRICE_THRESHOLD) reviewReason = `Price $${pricing.price} exceeds $${REVIEW_PRICE_THRESHOLD} threshold`;
  else if (pricing.confidence === 'low') reviewReason = 'Low pricing confidence';
  else if (!item.brand) reviewReason = 'No brand detected';
  else if (!item.size) reviewReason = 'No size detected';

  return { item: { ...item, description }, pricing, needsReview, reviewReason };
}

function generateDescription(item: Pick<Item, 'brand' | 'size' | 'color' | 'condition' | 'category'>): string {
  const parts: string[] = [];

  if (item.brand) parts.push(`Brand: ${item.brand}`);
  if (item.size) parts.push(`Size: ${item.size}`);
  if (item.color) parts.push(`Color: ${item.color}`);
  if (item.condition) {
    const conditionText = { nwt: 'New with Tags', nwot: 'New without Tags', like_new: 'Like New', good: 'Good', fair: 'Fair' }[item.condition] ?? item.condition;
    parts.push(`Condition: ${conditionText}`);
  }
  if (item.category) parts.push(`Category: ${item.category}`);

  parts.push('');
  if (item.condition === 'nwt') {
    parts.push('New with tags — never worn. Perfect condition, ready for a new home!');
  } else if (item.condition === 'nwot') {
    parts.push('New without tags — never worn, excellent condition.');
  } else if (item.condition === 'like_new') {
    parts.push('Worn once or twice — excellent condition, no visible wear.');
  } else if (item.condition === 'good') {
    parts.push('Pre-loved and ready for its next adventure!');
  } else {
    parts.push('Well-loved and ready for a new home.');
  }
  parts.push('Ready to ship same or next business day! 🚀');
  parts.push('Happy to answer any questions!');

  return parts.join('\n');
}

async function calculatePricing(
  item: Pick<Item, 'brand' | 'size' | 'condition' | 'category' | 'description'>,
  description: string,
): Promise<PricingResult> {
  // Use cached comparable search — checks local cache first, falls back to web search
  const compResult = await findComparables(
    item.brand ?? '',
    item.category ?? description.split(' ')[0] ?? '',
    item.size ?? '',
  );
  const comps = compResult.items;

  if (comps.length > 0) {
    const avgComp = comps.reduce((s, c) => s + c.price, 0) / comps.length;
    const conditionMult = CONDITION_MULTIPLIERS[item.condition] ?? 0.65;
    const price = Math.round(avgComp * conditionMult);
    const confidence: Confidence = comps.length >= 3 ? 'high' : comps.length >= 1 ? 'medium' : 'low';
    const cacheNote = compResult.fromCache ? ' (from cache)' : '';

    return {
      price,
      confidence,
      comparables: comps,
      reasoning: `Based on ${comps.length} Poshmark sold comp(s)${cacheNote}, avg $${avgComp.toFixed(2)} × ${conditionMult} (${item.condition}) = $${price}`,
    };
  }

  // Fallback to rule-based
  const basePrice = getBasePrice(item.category);
  const brandMult = getBrandMultiplier(item.brand);
  const conditionMult = CONDITION_MULTIPLIERS[item.condition] ?? 0.65;
  const price = Math.round(basePrice * brandMult * conditionMult);

  return {
    price,
    confidence: 'medium',
    comparables: [],
    reasoning: `Rule-based: base $${basePrice} × brand mult ${brandMult} × condition ${conditionMult} = $${price}`,
  };
}
