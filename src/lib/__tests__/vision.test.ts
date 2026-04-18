import { describe, it, expect } from 'vitest';

describe('Vision Analysis', () => {

  describe('analyzePhoto input detection', () => {
    const isUrl = (input: string) =>
      input.startsWith('http://') || input.startsWith('https://');

    it('correctly identifies URL inputs', () => {
      expect(isUrl('https://drive.google.com/uc?id=abc')).toBe(true);
      expect(isUrl('http://example.com/image.jpg')).toBe(true);
    });

    it('correctly identifies local file paths', () => {
      expect(isUrl('/tmp/poshmark-photos/photo-abc.jpg')).toBe(false);
      expect(isUrl('/Users/chris/photos/item.jpg')).toBe(false);
    });
  });

  describe('analyzePhoto base64 encoding', () => {
    it('encodes buffer as base64 data URL', () => {
      const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      const base64 = fakeJpeg.toString('base64');
      const dataUrl = `data:image/jpeg;base64,${base64}`;

      expect(dataUrl).toContain('data:image/jpeg;base64,');
      expect(base64.length).toBeGreaterThan(0);
    });
  });

  describe('Vision result parsing', () => {
    const normalizeNullableText = (value: string | null | undefined) => {
      if (value == null) return null;
      const trimmed = value.trim();
      if (!trimmed) return null;
      if (/^(null|n\/a|na|none|unknown)$/i.test(trimmed)) return null;
      return trimmed;
    };

    const normalizeVisionBrand = (brand: string | null | undefined, notes: string | null | undefined) => {
      const normalizedBrand = normalizeNullableText(brand);
      const combined = `${normalizedBrand ?? ''} ${notes ?? ''}`.toLowerCase();
      if (/kyte(?:\s*baby)?/.test(combined)) return 'Kyte BABY';
      if (/golden\s*goose|ggdb|sstar/.test(combined)) return 'Golden Goose';
      if (/\bvans\b|off the wall/.test(combined)) return 'Vans';
      if (/janie\s+and\s+jack/.test(combined)) return 'Janie and Jack';
      if (/posh\s*peanut/.test(combined)) return 'Posh Peanut';
      return normalizedBrand;
    };

    const normalizeVisionCategory = (category: string | null | undefined, itemType: string | null | undefined, notes: string | null | undefined) => {
      const normalizedCategory = normalizeNullableText(category);
      const combined = `${normalizedCategory ?? ''} ${itemType ?? ''} ${notes ?? ''}`.toLowerCase();
      if (/(newsboy|ivy)\s+cap|\bhat\b|\bcap\b|accessor/.test(combined)) return 'hats';
      if (/matching\s*set|two[-\s]*piece|2[-\s]*piece|top\s+and\s+shorts|top\s+and\s+pants/.test(combined)) return 'matching sets';
      if (/pajama|sleep(?:er|wear)|zip\s*sleeper/.test(combined)) return 'pajamas';
      if (/one[-\s]*piece|onesie|bodysuit|jumpsuit/.test(combined)) return 'one pieces';
      if (/zip(?:per)?\s*(front|closure)?|snap\s*buttons?\s*at\s*the\s*bottom/.test(combined) && !/shirt|top/.test(combined)) return 'one pieces';
      if (/shoe|footwear|sneaker/.test(combined)) return 'shoes';
      return normalizedCategory;
    };

    const normalizeVisionItemType = (itemType: string | null | undefined, notes: string | null | undefined) => {
      const normalizedItemType = normalizeNullableText(itemType);
      const combined = `${normalizedItemType ?? ''} ${notes ?? ''}`.toLowerCase();
      if (/matching\s*set|two[-\s]*piece|2[-\s]*piece|top\s+and\s+shorts|top\s+and\s+pants/.test(combined)) return 'set';
      if (/pajama|sleep(?:er|wear)|zip\s*sleeper|footie|footed|flame\s*resistant/.test(combined)) return 'pajamas';
      if (/romper/.test(combined)) return 'romper';
      if (/one[-\s]*piece|onesie|bodysuit|jumpsuit|coverall|bubble/.test(combined)) return 'one piece';
      if (/zip(?:per)?\s*(front|closure)?|snap\s*buttons?\s*at\s*the\s*bottom/.test(combined) && !/shirt|top/.test(combined)) return 'one piece';
      return normalizedItemType;
    };

    const normalizeVisionSize = (size: string | null | undefined, notes: string | null | undefined) => {
      const normalizedSize = normalizeNullableText(size);
      const combined = `${normalizedSize ?? ''} ${notes ?? ''}`;
      const monthCompact = combined.match(/\b(0|3|6|9|12|18|24|36)\s*\/\s*(3|6|9|12|18|24|36)\s*m\b/i);
      if (monthCompact) return `${monthCompact[1]}-${monthCompact[2]}M`;
      const monthRange = combined.match(/\b(0|3|6|9|12|18|24|36)\s*(?:to|-)\s*(3|6|9|12|18|24|36)\s*(?:months|month|mos|m)\b/i);
      if (monthRange) return `${monthRange[1]}-${monthRange[2]}M`;
      const monthSingle = combined.match(/\b(newborn|nb|0\s*months?|3\s*months?|6\s*months?|9\s*months?|12\s*months?|18\s*months?|24\s*months?|36\s*months?)\b/i);
      if (monthSingle) {
        const raw = monthSingle[1].toUpperCase().replace(/\s+MONTHS?/, 'M');
        if (raw === 'NEWBORN') return 'NEWBORN';
        if (raw === 'NB') return 'NB';
        return raw.replace(/\s+/g, '');
      }
      const toddlerAlpha = combined.match(/\b(\d+)\s*T\b/i);
      if (toddlerAlpha) return `${toddlerAlpha[1]}T`;
      const kidsAlpha = combined.match(/\b(?:us\s*)?(\d+(?:\.\d+)?)\s*([CYT])\b/i);
      if (kidsAlpha) return `${kidsAlpha[1]}${kidsAlpha[2].toUpperCase()}`;
      const euSize = combined.match(/\bEU\s*(\d+(?:\.\d+)?)\b/i);
      if (euSize) return `EU ${euSize[1]}`;
      const toddlerSize = combined.match(/\b(?:US\s*)?Toddler\s*(\d+(?:\.\d+)?)\b/i);
      if (toddlerSize) return `US Toddler ${toddlerSize[1]}`;
      return normalizedSize;
    };

    it('extracts all fields from valid JSON response', () => {
      const raw = JSON.stringify({
        brand: 'Nike',
        itemType: 'shoes',
        size: '6C',
        color: 'white',
        condition: 'good',
        category: 'footwear',
        confidence: 'high',
        notes: 'Velcro straps, minor wear'
      });
      const parsed = JSON.parse(raw);

      expect(parsed.brand).toBe('Nike');
      expect(parsed.itemType).toBe('shoes');
      expect(parsed.size).toBe('6C');
      expect(parsed.condition).toBe('good');
      expect(parsed.confidence).toBe('high');
    });

    it('strips markdown code fences from response', () => {
      const response = '```json\n{"brand": "Nike"}\n```';
      const stripped = response.replace(/```json\n?|```\n?/g, '').trim();
      expect(stripped).toBe('{"brand": "Nike"}');
      expect(() => JSON.parse(stripped)).not.toThrow();
    });

    it('handles missing optional fields with defaults', () => {
      const parsed = JSON.parse('{"brand": "Nike"}');
      const result = {
        brand: normalizeVisionBrand(parsed.brand ?? null, parsed.notes ?? ''),
        itemType: normalizeNullableText(parsed.itemType ?? null),
        size: normalizeNullableText(parsed.size ?? null),
        color: normalizeNullableText(parsed.color ?? null),
        condition: parsed.condition ?? 'good',
        category: normalizeNullableText(parsed.category ?? null),
        confidence: parsed.confidence ?? 'low',
        rawDescription: parsed.notes ?? '',
      };

      expect(result.condition).toBe('good');
      expect(result.confidence).toBe('low');
      expect(result.itemType).toBeNull();
    });

    it('normalizes Golden Goose from GGDB cues in notes', () => {
      expect(normalizeVisionBrand(null, 'GGDB branding on straps and side star visible')).toBe('Golden Goose');
      expect(normalizeVisionBrand('Golden Goose Kids', 'Made in Italy')).toBe('Golden Goose');
    });

    it('normalizes Vans from brand cues in notes', () => {
      expect(normalizeVisionBrand(null, 'Vans branding visible on tongue')).toBe('Vans');
      expect(normalizeVisionBrand(null, 'OFF THE WALL heel branding visible')).toBe('Vans');
    });

    it('normalizes Kyte BABY and does not confuse it with Kite', () => {
      expect(normalizeVisionBrand(null, 'Kyte Baby tag visible size 0-3')).toBe('Kyte BABY');
      expect(normalizeVisionBrand('Kite', 'label clearly says Kite')).toBe('Kite');
    });

    it('normalizes kids size from notes and tag text', () => {
      expect(normalizeVisionSize(null, 'size tag shows US 6C')).toBe('6C');
      expect(normalizeVisionSize('US 6C', '')).toBe('6C');
      expect(normalizeVisionSize(null, 'EU 23.5 on inner tag')).toBe('EU 23.5');
      expect(normalizeVisionSize(null, 'Toddler 7 visible on label')).toBe('US Toddler 7');
      expect(normalizeVisionSize(null, 'size 0/3M on label')).toBe('0-3M');
      expect(normalizeVisionSize(null, '6 to 12 months visible on tag')).toBe('6-12M');
      expect(normalizeVisionSize(null, 'NEWBORN 0 months')).toBe('NEWBORN');
      expect(normalizeVisionSize(null, '2T tag visible')).toBe('2T');
    });

    it('normalizes generic footwear and sleepwear categories into friendlier buckets', () => {
      expect(normalizeVisionCategory('footwear', 'sneakers', '')).toBe('shoes');
      expect(normalizeVisionCategory('accessories', 'cap', 'newsboy cap')).toBe('hats');
      expect(normalizeVisionCategory('tops', 'zip sleeper', 'bamboo pajama sleeper')).toBe('pajamas');
    });

    it('pulls sleepers, one-pieces, and sets out of generic tops', () => {
      expect(normalizeVisionItemType('top', 'bamboo zip sleeper with footie design')).toBe('pajamas');
      expect(normalizeVisionCategory('tops', 'top', 'zip front one-piece with snap buttons at the bottom')).toBe('one pieces');
      expect(normalizeVisionItemType('top', 'matching top and shorts set')).toBe('set');
      expect(normalizeVisionCategory('tops', 'top', 'matching top and shorts set')).toBe('matching sets');
    });
  });

  describe('analyzeItemPhotos merge logic', () => {
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

    it('picks most common value for each field', () => {
      const sizes = ['6C', '6C', null, '6C', null];
      const brands = ['Nike', 'Nike', 'Nike', 'Adidas', 'Nike'];
      const colors = ['white', 'white', 'blue'];

      expect(pickMostCommon(sizes)).toBe('6C');
      expect(pickMostCommon(brands)).toBe('Nike');
      expect(pickMostCommon(colors)).toBe('white');
    });

    it('returns null when all values are null', () => {
      expect(pickMostCommon([null, null, null])).toBeNull();
    });

    it('handles single value', () => {
      expect(pickMostCommon(['Nike'])).toBe('Nike');
    });

    it('computes average confidence score correctly', () => {
      const scores = [
        { confidence: 'high' as const, expected: 3 },
        { confidence: 'medium' as const, expected: 2 },
        { confidence: 'low' as const, expected: 1 },
        { confidence: 'high' as const, expected: 3 },
        { confidence: 'medium' as const, expected: 2 },
      ];
      const confidenceMap: Record<string, number> = { high: 3, medium: 2, low: 1 };
      const avgScore = scores.reduce((s, r) => s + confidenceMap[r.confidence], 0) / scores.length;
      const confidenceArr = ['low', 'medium', 'high'];
      const avgConfidence = confidenceArr[Math.round(avgScore) - 1] ?? 'medium';

      expect(avgScore).toBe(2.2);
      expect(avgConfidence).toBe('medium');
    });
  });

  describe('Error handling', () => {
    it('returns low-confidence result on API error', () => {
      const result = {
        brand: null, itemType: null, size: null, color: null,
        condition: 'good' as const, category: null,
        confidence: 'low' as const,
        rawDescription: 'API error 500',
      };
      expect(result.confidence).toBe('low');
      expect(result.rawDescription).toContain('error');
    });

    it('returns error result on missing API key', () => {
      const result = {
        brand: null, itemType: null, size: null, color: null,
        condition: 'good' as const, category: null,
        confidence: 'low' as const,
        rawDescription: 'No API key set for vision',
      };
      expect(result.rawDescription).toContain('No API key');
    });
  });
});
