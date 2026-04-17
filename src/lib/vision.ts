// Vision analysis — analyze clothing photos to extract brand, size, color, condition

import type { Item } from '../types.js';

const KNOWN_BRAND_GUIDANCE = `Known brands often seen in this closet: Nike, Adidas, Jordan, Janie and Jack, Golden Goose, Vans.
For Golden Goose kids sneakers, watch for these cues: side star applique, GGDB branding, SSTAR lettering on straps, Golden Goose heel or insole branding, Made in Italy stamp, and an intentionally vintage or distressed-looking sole. Do not mistake Golden Goose's intentional worn-in styling for severe damage unless there is additional real wear.
For Vans kids shoes, watch for these cues: Vans tongue or insole branding, OFF THE WALL heel branding, signature side stripe, waffle sole, and skate-style low or mid top silhouettes, often with velcro straps on toddler pairs.`;

function normalizeNullableText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^(null|n\/a|na|none|unknown)$/i.test(trimmed)) return null;
  return trimmed;
}

function normalizeVisionBrand(brand: string | null | undefined, notes: string | null | undefined): string | null {
  const normalizedBrand = normalizeNullableText(brand);
  const combined = `${normalizedBrand ?? ''} ${notes ?? ''}`.toLowerCase();

  if (/golden\s*goose|ggdb|sstar/.test(combined)) return 'Golden Goose';
  if (/\bvans\b|off the wall/.test(combined)) return 'Vans';
  if (/janie\s+and\s+jack/.test(combined)) return 'Janie and Jack';

  return normalizedBrand;
}

export interface VisionResult {
  brand: string | null;
  itemType: string | null;
  size: string | null;
  color: string | null;
  condition: 'nwt' | 'nwot' | 'like_new' | 'good' | 'fair';
  category: string | null;
  confidence: 'high' | 'medium' | 'low';
  rawDescription: string;
}

type Confidence = 'high' | 'medium' | 'low';

/**
 * Analyze a single photo using the vision API.
 * Accepts either a URL (http:// or https://) or a local file path.
 * For local files, reads from disk and sends as base64-encoded JPEG.
 */
export async function analyzePhoto(photoUrlOrPath: string): Promise<VisionResult> {
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return { brand: null, itemType: null, size: null, color: null, condition: 'good', category: null, confidence: 'low', rawDescription: 'No API key set for vision' };
  }

  const isUrl = photoUrlOrPath.startsWith('http://') || photoUrlOrPath.startsWith('https://');

  let imageContent: { url?: string } | { url?: string; detail?: string };
  if (isUrl) {
    imageContent = { url: photoUrlOrPath };
  } else {
    // Local file — read and base64-encode
    const fs = await import('fs/promises');
    const buffer = await fs.readFile(photoUrlOrPath);
    const base64 = buffer.toString('base64');
    imageContent = { url: `data:image/jpeg;base64,${base64}`, detail: 'low' };
  }

  // Use OpenAI vision API (also works with OpenRouter-compatible endpoints)
  const baseUrl = process.env.OPENAI_API_KEY ? 'https://api.openai.com' : 'https://openrouter.ai/api/v1';

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Analyze this kids clothing or shoes photo. ${KNOWN_BRAND_GUIDANCE}
Return ONLY valid JSON (no markdown, no explanation):
{
  "brand": "brand name or null",
  "itemType": "type of item (shirt, pants, dress, sneakers, sandals, etc.)",
  "size": "size label or null",
  "color": "primary color or null",
  "condition": "like_new, good, or fair",
  "category": "category (tops, bottoms, dresses, footwear, sneakers, etc.)",
  "confidence": "high, medium, or low",
  "notes": "any additional observations, including visible brand cues, style details, and real wear vs intentional distress"
}`,
              },
              {
                type: 'image_url',
                image_url: imageContent,
              },
            ],
          },
        ],
        max_tokens: 200,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('Vision API error:', response.status, text);
      return { brand: null, itemType: null, size: null, color: null, condition: 'good', category: null, confidence: 'low', rawDescription: `API error ${response.status}` };
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? '';

    // Strip markdown code fences
    const jsonStr = content.replace(/```json\n?|```\n?/g, '').trim();
    const parsed = JSON.parse(jsonStr) as Partial<VisionResult & { notes: string }>;

    const notes = parsed.notes ?? '';

    return {
      brand: normalizeVisionBrand(parsed.brand ?? null, notes),
      itemType: normalizeNullableText(parsed.itemType ?? null),
      size: normalizeNullableText(parsed.size ?? null),
      color: normalizeNullableText(parsed.color ?? null),
      condition: (parsed.condition as VisionResult['condition']) ?? 'good',
      category: normalizeNullableText(parsed.category ?? null),
      confidence: (parsed.confidence as Confidence) ?? 'low',
      rawDescription: notes,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { brand: null, itemType: null, size: null, color: null, condition: 'good', category: null, confidence: 'low', rawDescription: `Error: ${msg}` };
  }
}

/**
 * Analyze all photos for an item and merge results (most common answer wins).
 */
export async function analyzeItemPhotos(photoUrls: string[]): Promise<VisionResult> {
  const results = await Promise.all(photoUrls.map((url) => analyzePhoto(url).catch(() => null)));
  const valid = results.filter((r): r is VisionResult => r !== null);

  if (valid.length === 0) {
    return { brand: null, itemType: null, size: null, color: null, condition: 'good', category: null, confidence: 'low', rawDescription: '' };
  }

  const pickMostCommon = <T>(values: (T | null)[]): T | null => {
    const counts = new Map<T, number>();
    for (const v of values) {
      if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    let best: T | null = null;
    let bestCount = 0;
    for (const [v, count] of counts) {
      if (count > bestCount) { bestCount = count; best = v; }
    }
    return best;
  };

  const confidenceScore = valid.reduce((s, r) => {
    const map: Record<string, number> = { high: 3, medium: 2, low: 1 };
    return s + (map[r.confidence] ?? 2);
  }, 0) / valid.length;

  const confidenceMap: Confidence[] = ['low', 'medium', 'high'];
  const avgConfidence = confidenceMap[Math.round(confidenceScore) - 1] ?? 'medium';

  return {
    brand: pickMostCommon(valid.map((r) => r.brand)),
    itemType: pickMostCommon(valid.map((r) => r.itemType)),
    size: pickMostCommon(valid.map((r) => r.size)),
    color: pickMostCommon(valid.map((r) => r.color)),
    condition: pickMostCommon(valid.map((r) => r.condition)) ?? 'good',
    category: pickMostCommon(valid.map((r) => r.category)),
    confidence: avgConfidence,
    rawDescription: valid.map((r) => r.rawDescription).filter(Boolean).join(' | '),
  };
}
