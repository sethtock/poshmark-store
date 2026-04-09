// Vision analysis — analyze clothing photos to extract brand, size, color, condition

import type { Item } from '../types.js';

export interface VisionResult {
  brand: string | null;
  itemType: string | null;
  size: string | null;
  color: string | null;
  condition: 'like_new' | 'good' | 'fair';
  category: string | null;
  confidence: 'high' | 'medium' | 'low';
  rawDescription: string;
}

type Confidence = 'high' | 'medium' | 'low';

/**
 * Analyze a single photo URL using the agent's image model (via the image tool).
 * Returns structured item data extracted from the image.
 *
 * Since we can't call the image() tool directly from Node code, we call the
 * configured LLM with vision capability via a separate HTTP call using the
 * OPENROUTER_API_KEY or OPENAI_API_KEY env var.
 */
export async function analyzePhoto(photoUrl: string): Promise<VisionResult> {
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return { brand: null, itemType: null, size: null, color: null, condition: 'good', category: null, confidence: 'low', rawDescription: 'No API key set for vision' };
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
                text: `Analyze this kids clothing photo. Return ONLY valid JSON (no markdown, no explanation):
{
  "brand": "brand name or null",
  "itemType": "type of item (shirt, pants, dress, etc.)",
  "size": "size label or null",
  "color": "primary color or null",
  "condition": "like_new, good, or fair",
  "category": "category (tops, bottoms, dresses, etc.)",
  "confidence": "high, medium, or low",
  "notes": "any additional observations"
}`,
              },
              {
                type: 'image_url',
                image_url: { url: photoUrl },
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

    return {
      brand: parsed.brand ?? null,
      itemType: parsed.itemType ?? null,
      size: parsed.size ?? null,
      color: parsed.color ?? null,
      condition: (parsed.condition as VisionResult['condition']) ?? 'good',
      category: parsed.category ?? null,
      confidence: (parsed.confidence as Confidence) ?? 'low',
      rawDescription: parsed.notes ?? '',
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
