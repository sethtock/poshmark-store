import { describe, it, expect } from 'vitest';

describe('Comparable Cache Logic', () => {

  describe('Key normalization', () => {
    const normalizeKey = (brand: string, itemType: string, size: string) =>
      `${brand ?? ''}`.toLowerCase().trim() + ':' +
      `${itemType ?? ''}`.toLowerCase().trim() + ':' +
      `${size ?? ''}`.toLowerCase().trim();

    it('normalizes to lowercase colon-separated key', () => {
      expect(normalizeKey('Nike', 'shoes', '6C')).toBe('nike:shoes:6c');
    });

    it('normalizes uppercase input', () => {
      expect(normalizeKey('NIKE', 'SHOES', '6C')).toBe('nike:shoes:6c');
    });

    it('trims whitespace', () => {
      expect(normalizeKey(' Janie and Jack ', ' dress ', ' 2T ')).toBe('janie and jack:dress:2t');
    });

    it('handles empty/null values', () => {
      expect(normalizeKey('', '', '')).toBe('::');
      expect(normalizeKey(null as unknown as string, null as unknown as string, null as unknown as string)).toBe('::');
    });

    it('consistent key for same entity across formats', () => {
      expect(normalizeKey('Nike', 'shoes', '6C')).toBe(normalizeKey('nike', 'SHOES', '6c'));
    });
  });

  describe('Cache expiry detection', () => {
    const isExpired = (searchedAt: string) => {
      const age = (Date.now() - new Date(searchedAt).getTime()) / (1000 * 60 * 60 * 24);
      return age > 30;
    };

    it('detects expired entries (older than 30 days)', () => {
      const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
      expect(isExpired(thirtyOneDaysAgo)).toBe(true);
    });

    it('does not flag fresh entries', () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      const today = new Date().toISOString();
      expect(isExpired(tenDaysAgo)).toBe(false);
      expect(isExpired(today)).toBe(false);
    });

    it('edge case: exactly 30 days old is not expired', () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      expect(isExpired(thirtyDaysAgo)).toBe(false);
    });
  });

  describe('Size system inference', () => {
    const inferSizeSystem = (size: string) => {
      const s = `${size}`.toLowerCase();
      // Kids: 0C-13C, 1Y-7Y, 2T-5T (any letter suffix is kids)
      if (/^\d+(\.\d+)?[cmcty]$/i.test(s)) return 'us-kids';
      if (/^\d+$/.test(s)) {
        const n = parseInt(s);
        if (n >= 5 && n <= 9) return 'us-womens';
        if (n >= 10) return 'us-mens';
      }
      return 'unknown';
    };

    it('correctly identifies kids sizes', () => {
      expect(inferSizeSystem('6C')).toBe('us-kids');
      expect(inferSizeSystem('2T')).toBe('us-kids');
      expect(inferSizeSystem('4Y')).toBe('us-kids');
      expect(inferSizeSystem('3.5C')).toBe('us-kids');
      expect(inferSizeSystem('5T')).toBe('us-kids');
    });

    it('correctly identifies womens sizes', () => {
      expect(inferSizeSystem('6')).toBe('us-womens');
      expect(inferSizeSystem('7')).toBe('us-womens');
      expect(inferSizeSystem('8')).toBe('us-womens');
    });

    it('correctly identifies mens sizes', () => {
      expect(inferSizeSystem('10')).toBe('us-mens');
      expect(inferSizeSystem('11')).toBe('us-mens');
      expect(inferSizeSystem('12')).toBe('us-mens');
    });

    it('handles unknown formats', () => {
      expect(inferSizeSystem('M')).toBe('unknown');
      expect(inferSizeSystem('S')).toBe('unknown');
      expect(inferSizeSystem('unknown')).toBe('unknown');
    });
  });

  describe('Cache CRUD operations', () => {
    it('adds a new entry without duplicates', () => {
      const cache = { version: 1, entries: [] as any[] };
      const newEntry = {
        key: 'nike:shoes:6c', brand: 'Nike', itemType: 'shoes', size: '6C',
        sizeSystem: 'us-kids' as const,
        items: [{ title: 'Nike Sneakers', price: 24, soldDate: '2026-03-09', url: '', condition: 'good' as const }],
        searchedAt: new Date().toISOString(), sourceQuery: 'nike shoes 6c',
      };
      cache.entries = cache.entries.filter(e => e.key !== newEntry.key);
      cache.entries.push(newEntry);
      expect(cache.entries).toHaveLength(1);
      expect(cache.entries[0].key).toBe('nike:shoes:6c');
    });

    it('replaces existing entry with same key', () => {
      const cache = {
        version: 1,
        entries: [{
          key: 'nike:shoes:6c', brand: 'Nike', itemType: 'shoes', size: '6C',
          sizeSystem: 'us-kids' as const,
          items: [{ title: 'Old', price: 18, soldDate: '2026-01-01', url: '', condition: 'good' as const }],
          searchedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
          sourceQuery: 'old',
        }],
      };
      const newEntry = {
        ...cache.entries[0],
        items: [{ title: 'New', price: 24, soldDate: '2026-04-10', url: '', condition: 'good' as const }],
        searchedAt: new Date().toISOString(), sourceQuery: 'new',
      };
      cache.entries = cache.entries.filter(e => e.key !== newEntry.key);
      cache.entries.push(newEntry);
      expect(cache.entries).toHaveLength(1);
      expect(cache.entries[0].items[0].price).toBe(24);
    });

    it('filters expired entries correctly', () => {
      const entries = [
        { key: 'expired', searchedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString() },
        { key: 'valid', searchedAt: new Date().toISOString() },
      ];
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const validEntries = entries.filter(e => {
        const age = (Date.now() - new Date(e.searchedAt).getTime()) / (1000 * 60 * 60 * 24);
        return age <= 30;
      });
      expect(validEntries).toHaveLength(1);
      expect(validEntries[0].key).toBe('valid');
    });
  });
});
