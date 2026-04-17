import type { Item } from '../types.js';

function normalizeNullableText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^(null|n\/a|na|none|unknown)$/i.test(trimmed)) return null;
  return trimmed;
}

const CATEGORY_TITLE_MAP: Array<[RegExp, string]> = [
  [/dress/i, 'Dress'],
  [/(shirt|top|blouse|sweater)/i, 'Top'],
  [/(pants|leggings|shorts|bottoms)/i, 'Pants'],
  [/(jacket|coat)/i, 'Jacket'],
  [/(matching sets|set)/i, 'Set'],
  [/(one pieces|one piece|onesie)/i, 'One Piece'],
  [/(pajamas|pajama)/i, 'Pajamas'],
  [/(sandals|sandal)/i, 'Sandals'],
  [/(boots|boot)/i, 'Boots'],
  [/(shoes|shoe|sneakers|sneaker|footwear)/i, 'Shoes'],
  [/(swim|swimsuit)/i, 'Swimwear'],
  [/(costumes|costume)/i, 'Costume'],
  [/(accessories|accessory)/i, 'Accessory'],
];

function normalizeColor(color: string | null): string | null {
  const normalized = normalizeNullableText(color);
  if (!normalized) return null;
  return normalized
    .split(/[\/,&]/)[0]
    ?.trim()
    ?.replace(/\s+/g, ' ')
    ?.replace(/\b\w/g, (m) => m.toUpperCase()) || null;
}

function categoryToTitle(category: string | null): string | null {
  const normalized = normalizeNullableText(category);
  if (!normalized) return null;
  for (const [pattern, label] of CATEGORY_TITLE_MAP) {
    if (pattern.test(normalized)) return label;
  }

  const stripped = normalized
    .replace(/^(Girls|Girl|Boys|Boy|Kids|Kid|Baby)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  return stripped.replace(/\b\w/g, (m) => m.toUpperCase()) || null;
}

export function generateListingTitle(item: Pick<Item, 'brand' | 'category' | 'size' | 'color' | 'id'>): string {
  const parts = [
    normalizeNullableText(item.brand),
    categoryToTitle(item.category),
    normalizeNullableText(item.size),
    normalizeColor(item.color),
  ].filter(Boolean);

  return parts.join(' ').slice(0, 80) || `Kids Item ${item.id}`;
}

export function getListingTitle(item: Pick<Item, 'title' | 'brand' | 'category' | 'size' | 'color' | 'id'>): string {
  const explicitTitle = normalizeNullableText(item.title)?.replace(/\bnull\b/gi, '').replace(/\s+/g, ' ').trim();
  if (explicitTitle) return explicitTitle;
  return generateListingTitle(item);
}

export function generateListingDescription(item: Pick<Item, 'condition'>): string {
  const conditionLine = {
    nwt: 'New with tags, never worn, and in perfect condition.',
    nwot: 'New without tags and in excellent condition.',
    like_new: 'Excellent condition with little to no visible wear.',
    good: 'Gently used and still in great shape.',
    fair: 'Pre-loved with visible wear, priced accordingly.',
  }[item.condition] ?? 'Pre-loved and ready for a new home.';

  return [
    conditionLine,
    'Ready to ship same or next business day! 🚀',
    'Happy to answer any questions!',
  ].join('\n');
}
