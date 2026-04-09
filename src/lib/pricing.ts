// Pricing engine — rule-based pricing with Poshmark sold comparables

import type { Item, PricingResult, ComparableItem } from '../types.js';
// Web search via OpenAI-compatible endpoint (Perplexity-style or OpenAI)

type Confidence = 'high' | 'medium' | 'low';

interface WebResult { title: string; snippet: string; url: string; date: string }

async function searchWeb(query: string): Promise<WebResult[]> {
  const apiKey = process.env.OPENROUTER_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) return [];

  const baseUrl = apiKey.startsWith('sk-or-v1') ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com';

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'openrouter/auto',
        messages: [
          { role: 'system', content: 'You are a web searcher. Search for the query and return top 5 results as JSON array with fields: title, snippet, url, date.' },
          { role: 'user', content: `Search: ${query}` },
        ],
        max_tokens: 500,
      }),
    });
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? '[]';
    return JSON.parse(content.replace(/```json\n?|```\n?/g, '').trim()) as WebResult[];
  } catch {
    return [];
  }
}

// Brand multipliers for kids clothing
const BRAND_MULTIPLIERS: Record<string, number> = {
  'gucci': 0.7, 'luxury': 0.7,
  'nike': 0.65, 'jordan': 0.65, 'adidas': 0.65, 'under armour': 0.6,
  'gap': 0.55, 'old navy': 0.5, 'golf': 0.55,
  'zara': 0.55, 'hm': 0.4, 'h&m': 0.4, 'uniqlo': 0.55,
  'carter\'s': 0.5, 'oshkosh': 0.5, 'guess': 0.5,
  'target': 0.35, 'walmart': 0.3, 'amazon': 0.3,
};

const CONDITION_MULTIPLIERS: Record<string, number> = {
  like_new: 0.85,
  good: 0.65,
  fair: 0.4,
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

interface SoldSearchParams {
  brand: string | null;
  description: string;
  size: string | null;
  itemType: string | null;
}

/**
 * Search Poshmark sold listings for comparables.
 */
async function searchPoshmarkSold(params: SoldSearchParams): Promise<ComparableItem[]> {
  const query = [params.brand, params.description, params.size, params.itemType, 'sold', 'poshmark']
    .filter(Boolean).join(' ');

  try {
    const results = await searchWeb(`${query} sold poshmark price`);

    const comps: ComparableItem[] = [];
    for (const r of results) {
      const priceMatch = r.snippet?.match(/\$[\d]+(\.\d{2})?/);
      if (priceMatch) {
        comps.push({
          title: r.title ?? query,
          price: parseFloat(priceMatch[0].replace('$', '')),
          soldDate: r.date ?? new Date().toISOString(),
          url: r.url ?? '',
          condition: 'unknown',
        });
      }
    }
    return comps;
  } catch {
    return [];
  }
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
    (pricing.price > 80) ||
    !item.brand ||
    !item.size;

  let reviewReason: string | undefined;
  if (pricing.price > 80) reviewReason = `Price $${pricing.price} exceeds $80 threshold`;
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
    const conditionText = { like_new: 'Like New', good: 'Good', fair: 'Fair' }[item.condition] ?? item.condition;
    parts.push(`Condition: ${conditionText}`);
  }
  if (item.category) parts.push(`Category: ${item.category}`);

  parts.push('');
  parts.push('Kids clothing — great quality, ready to ship same or next business day! 🚀');
  parts.push('Smoke-free, pet-free home.');
  parts.push('Happy to answer any questions!');

  return parts.join('\n');
}

async function calculatePricing(
  item: Pick<Item, 'brand' | 'size' | 'condition' | 'category' | 'description'>,
  description: string,
): Promise<PricingResult> {
  const comps = await searchPoshmarkSold({
    brand: item.brand,
    description,
    size: item.size,
    itemType: item.category,
  });

  if (comps.length > 0) {
    const avgComp = comps.reduce((s, c) => s + c.price, 0) / comps.length;
    const conditionMult = CONDITION_MULTIPLIERS[item.condition] ?? 0.65;
    const price = Math.round(avgComp * conditionMult);
    const confidence: Confidence = comps.length >= 3 ? 'high' : comps.length >= 1 ? 'medium' : 'low';

    return {
      price,
      confidence,
      comparables: comps,
      reasoning: `Based on ${comps.length} Poshmark sold comp(s), avg $${avgComp.toFixed(2)} × ${conditionMult} (${item.condition}) = $${price}`,
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
