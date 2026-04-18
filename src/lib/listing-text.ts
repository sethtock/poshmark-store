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
  [/(blazer|jacket|coat)/i, 'Jacket'],
  [/(matching sets|set)/i, 'Set'],
  [/(one pieces|one piece|onesie)/i, 'One Piece'],
  [/(pajamas|pajama)/i, 'Pajamas'],
  [/(sandals|sandal)/i, 'Sandals'],
  [/(boots|boot)/i, 'Boots'],
  [/(shoes|shoe|sneakers|sneaker|footwear)/i, 'Shoes'],
  [/(swim|swimsuit)/i, 'Swimwear'],
  [/(costumes|costume)/i, 'Costume'],
  [/(hat|cap)/i, 'Hat'],
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

function normalizeBrandForDescription(brand: string | null | undefined): string | null {
  const normalized = normalizeNullableText(brand);
  if (!normalized) return null;
  return normalized.replace(/\bBABY\b/g, 'Baby');
}

function normalizeCategoryForDescription(category: string | null | undefined): string | null {
  const normalized = categoryToTitle(category ?? null);
  if (!normalized) return null;
  if (normalized === 'Shoes') return 'pair of shoes';
  if (normalized === 'Pajamas') return 'pajama set';
  if (normalized === 'One Piece') return 'one-piece';
  if (normalized === 'Hat') return 'hat';
  return normalized.toLowerCase();
}

function summarizeNotes(notes: string | null | undefined): string | null {
  const normalized = normalizeNullableText(notes);
  if (!normalized) return null;

  const cleaned = normalized
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
    .find((part) => !/no visible|no brand|no size|tag visible|label visible|made in/i.test(part));

  if (!cleaned) return null;

  return cleaned
    .replace(/^(the item|item|features?)\s+/i, '')
    .replace(/\.$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function generateListingDescription(item: Pick<Item, 'condition' | 'brand' | 'category' | 'color' | 'notes'>): string {
  const brand = normalizeBrandForDescription(item.brand);
  const category = normalizeCategoryForDescription(item.category) ?? 'piece';
  const color = normalizeColor(item.color)?.toLowerCase();
  const noteSummary = summarizeNotes(item.notes);

  const intro = item.condition === 'nwt'
    ? `New with tags ${brand ? `from ${brand}` : ''}${color ? ` in ${color}` : ''}.`.replace(/\s+\./g, '.')
    : `This ${brand ? `${brand} ` : ''}${category}${color ? ` in ${color}` : ''} was worn by my little one and still has lots of life left.`;

  const conditionLine = {
    nwt: 'Never worn and ready to go.',
    nwot: 'Never worn, just missing the original tags.',
    like_new: 'In excellent condition with little to no visible wear.',
    good: 'Gently used and still in really nice shape.',
    fair: 'Pre-loved with visible wear, priced accordingly.',
  }[item.condition] ?? 'Pre-loved and ready for a new home.';

  const detailLine = noteSummary
    ? `Cute detail: ${noteSummary.charAt(0).toLowerCase() + noteSummary.slice(1)}.`
    : null;

  return [
    intro,
    conditionLine,
    detailLine,
    'Happy to answer questions or share more photos.',
    'Ships same or next business day! 🚀',
  ].filter(Boolean).join('\n');
}
