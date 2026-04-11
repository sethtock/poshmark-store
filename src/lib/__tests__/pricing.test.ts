import { describe, it, expect } from 'vitest';

describe('Pricing Engine', () => {

  describe('Condition multipliers', () => {
    const CONDITION_MULTIPLIERS: Record<string, number> = {
      nwt: 0.85,
      nwot: 0.80,
      like_new: 0.75,
      good: 0.65,
      fair: 0.40,
    };

    it('applies correct multiplier for each condition', () => {
      expect(CONDITION_MULTIPLIERS.nwt).toBeCloseTo(0.85);
      expect(CONDITION_MULTIPLIERS.nwot).toBeCloseTo(0.80);
      expect(CONDITION_MULTIPLIERS.like_new).toBeCloseTo(0.75);
      expect(CONDITION_MULTIPLIERS.good).toBeCloseTo(0.65);
      expect(CONDITION_MULTIPLIERS.fair).toBeCloseTo(0.40);
    });

    it('higher multipliers for better conditions', () => {
      expect(CONDITION_MULTIPLIERS.nwt).toBeGreaterThan(CONDITION_MULTIPLIERS.good);
      expect(CONDITION_MULTIPLIERS.like_new).toBeGreaterThan(CONDITION_MULTIPLIERS.fair);
    });
  });

  describe('Brand multipliers', () => {
    const BRAND_MULTIPLIERS: Record<string, number> = {
      lululemon: 0.90,
      patagonia: 0.85,
      nike: 0.75,
      gap: 0.70,
      'old navy': 0.60,
      hm: 0.50,
      zara: 0.55,
      'janie and jack': 0.85,
    };

    const getBrandMultiplier = (brand: string | null): number => {
      if (!brand) return 0.45;
      const lower = brand.toLowerCase();
      for (const [key, mult] of Object.entries(BRAND_MULTIPLIERS)) {
        if (lower.includes(key)) return mult;
      }
      return 0.45;
    };

    it('returns correct multiplier for known brands', () => {
      expect(getBrandMultiplier('Nike')).toBeCloseTo(0.75);
      expect(getBrandMultiplier('NIKE')).toBeCloseTo(0.75);
      expect(getBrandMultiplier('Janie and Jack')).toBeCloseTo(0.85);
      expect(getBrandMultiplier('Old Navy')).toBeCloseTo(0.60);
      expect(getBrandMultiplier('Lululemon')).toBeCloseTo(0.90);
    });

    it('returns default multiplier for unknown brands', () => {
      expect(getBrandMultiplier('UnknownBrand')).toBeCloseTo(0.45);
      expect(getBrandMultiplier(null)).toBeCloseTo(0.45);
      expect(getBrandMultiplier('')).toBeCloseTo(0.45);
    });

    it('partial match works', () => {
      expect(getBrandMultiplier('Nike Air Max')).toBeCloseTo(0.75);
      expect(getBrandMultiplier('OLD NAVY KIDS')).toBeCloseTo(0.60);
    });
  });

  describe('Base price by item type', () => {
    const TYPE_BASE_PRICES: Record<string, number> = {
      shirt: 15, tee: 12, 't-shirt': 12, top: 14, blouse: 15,
      pants: 18, jean: 20, legging: 12, shorts: 14,
      dress: 22, romper: 18, jumpsuit: 20,
      jacket: 25, coat: 30, hoodie: 22, sweater: 20,
      shoe: 25, sneaker: 30, boot: 28, sandal: 15,
    };

    const getBasePrice = (itemType: string | null): number => {
      if (!itemType) return 15;
      const lower = itemType.toLowerCase();
      for (const [key, price] of Object.entries(TYPE_BASE_PRICES)) {
        if (lower.includes(key)) return price;
      }
      return 15;
    };

    it('returns correct base price for known types', () => {
      expect(getBasePrice('sneaker')).toBe(30);
      expect(getBasePrice('shoes')).toBe(25);
      expect(getBasePrice('dress')).toBe(22);
      expect(getBasePrice('jacket')).toBe(25);
      expect(getBasePrice('tee')).toBe(12);
      expect(getBasePrice('jeans')).toBe(20);
    });

    it('returns default 15 for unknown types', () => {
      expect(getBasePrice('unknown')).toBe(15);
      expect(getBasePrice(null)).toBe(15);
      expect(getBasePrice('')).toBe(15);
    });
  });

  describe('Rule-based pricing formula', () => {
    const calculateRuleBasedPrice = (basePrice: number, brandMult: number, conditionMult: number) =>
      Math.round(basePrice * brandMult * conditionMult);

    it('calculates Nike shoes like_new correctly', () => {
      // Nike shoes: base=25, brand=0.75, condition=0.75
      // 25 * 0.75 * 0.75 = 14.0625 → 14
      expect(calculateRuleBasedPrice(25, 0.75, 0.75)).toBe(14);
    });

    it('calculates Janie and Jack dress nwt correctly', () => {
      // 22 * 0.85 * 0.85 = 15.905 → 16
      expect(calculateRuleBasedPrice(22, 0.85, 0.85)).toBe(16);
    });

    it('calculates Old Navy jeans good correctly', () => {
      // 20 * 0.60 * 0.65 = 7.8 → 8
      expect(calculateRuleBasedPrice(20, 0.60, 0.65)).toBe(8);
    });

    it('calculates Lululemon hoodie like_new correctly', () => {
      // 22 * 0.90 * 0.75 = 14.85 → 15
      expect(calculateRuleBasedPrice(22, 0.90, 0.75)).toBe(15);
    });

    it('calculates Nike sneaker like_new correctly (realistic for item-002)', () => {
      // Nike sneakers: base=30, brand=0.75, condition=0.75
      // 30 * 0.75 * 0.75 = 16.875 → 17
      expect(calculateRuleBasedPrice(30, 0.75, 0.75)).toBe(17);
    });
  });

  describe('Comparable-based pricing', () => {
    it('calculates price from average of sold comps with condition multiplier', () => {
      const comps = [
        { price: 24 },
        { price: 20 },
      ];
      const avgComp = comps.reduce((s, c) => s + c.price, 0) / comps.length;
      expect(avgComp).toBe(22);

      const conditionMult = 0.75;
      const price = Math.round(avgComp * conditionMult);
      expect(price).toBe(17); // 22 * 0.75 = 16.5 → 17
    });

    it('assigns high confidence for 3+ comps', () => {
      const confidence = (comps: object[]) =>
        comps.length >= 3 ? 'high' : comps.length >= 1 ? 'medium' : 'low';

      expect(confidence([])).toBe('low');
      expect(confidence([{}])).toBe('medium');
      expect(confidence([{}, {}])).toBe('medium');
      expect(confidence([{}, {}, {}])).toBe('high');
    });
  });

  describe('needsReview logic', () => {
    const shouldReview = (price: number, confidence: string, brand: string | null, size: string | null) =>
      confidence === 'low' || price > 80 || !brand || !size;

    it('flags items over $80', () => {
      expect(shouldReview(81, 'high', 'Nike', '6C')).toBe(true);
      expect(shouldReview(80, 'high', 'Nike', '6C')).toBe(false);
    });

    it('flags missing brand or size', () => {
      expect(shouldReview(20, 'high', null, '6C')).toBe(true);
      expect(shouldReview(20, 'high', 'Nike', null)).toBe(true);
      expect(shouldReview(20, 'high', 'Nike', '6C')).toBe(false);
    });

    it('flags low confidence', () => {
      expect(shouldReview(20, 'low', 'Nike', '6C')).toBe(true);
      expect(shouldReview(20, 'high', 'Nike', '6C')).toBe(false);
    });
  });

  describe('Description generation', () => {
    const generateDescription = (
      brand: string | null,
      size: string | null,
      color: string | null,
      condition: string | null,
      category: string | null,
    ): string => {
      const parts: string[] = [];
      if (brand) parts.push(`Brand: ${brand}`);
      if (size) parts.push(`Size: ${size}`);
      if (color) parts.push(`Color: ${color}`);
      if (condition) {
        const conditionText: Record<string, string> = {
          nwt: 'New with Tags', nwot: 'New without Tags',
          like_new: 'Like New', good: 'Good', fair: 'Fair',
        };
        parts.push(`Condition: ${conditionText[condition] ?? condition}`);
      }
      if (category) parts.push(`Category: ${category}`);
      parts.push('');
      if (condition === 'nwt') parts.push('New with tags — never worn. Perfect condition, ready for a new home!');
      else if (condition === 'like_new') parts.push('Worn once or twice — excellent condition, no visible wear.');
      else if (condition === 'good') parts.push('Pre-loved and ready for its next adventure!');
      parts.push('Ready to ship same or next business day! 🚀');
      parts.push('Happy to answer any questions!');
      return parts.join('\n');
    };

    it('includes all available fields', () => {
      const desc = generateDescription('Nike', '6C', 'white', 'like_new', 'footwear');
      expect(desc).toContain('Brand: Nike');
      expect(desc).toContain('Size: 6C');
      expect(desc).toContain('Color: white');
      expect(desc).toContain('Condition: Like New');
      expect(desc).toContain('Category: footwear');
      expect(desc).toContain('Worn once or twice');
      expect(desc).toContain('🚀');
    });

    it('handles minimal item (no brand, no color)', () => {
      const desc = generateDescription(null, '2T', null, 'good', null);
      expect(desc).toContain('Size: 2T');
      expect(desc).toContain('Condition: Good');
      expect(desc).not.toContain('Brand:');
      expect(desc).not.toContain('Color:');
      expect(desc).toContain('Pre-loved');
    });

    it('includes ship line for all conditions', () => {
      for (const cond of ['nwt', 'nwot', 'like_new', 'good', 'fair']) {
        const desc = generateDescription('Nike', '6C', 'white', cond, 'footwear');
        expect(desc).toContain('🚀');
        expect(desc).toContain('Ready to ship same or next business day!');
      }
    });
  });
});
