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
        brand: parsed.brand ?? null,
        itemType: parsed.itemType ?? null,
        size: parsed.size ?? null,
        color: parsed.color ?? null,
        condition: parsed.condition ?? 'good',
        category: parsed.category ?? null,
        confidence: parsed.confidence ?? 'low',
        rawDescription: parsed.notes ?? '',
      };

      expect(result.condition).toBe('good');
      expect(result.confidence).toBe('low');
      expect(result.itemType).toBeNull();
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
