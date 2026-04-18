import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeItem } from '../pricing.js';
import { findComparables } from '../comparables.js';
import type { Item } from '../../types.js';

vi.mock('../comparables.js', () => ({
  findComparables: vi.fn(),
}));

const mockedFindComparables = vi.mocked(findComparables);

const baseItem: Item = {
  id: 'item-test',
  folderName: 'test-folder',
  folderId: 'folder-id',
  photoUrls: [],
  localPhotoPaths: [],
  title: 'Test Item',
  description: '',
  brand: 'Janie and Jack',
  size: '2T',
  color: 'Pink',
  condition: 'good',
  category: 'tops',
  initialPrice: null,
  currentPrice: null,
  acceptedSellPrice: null,
  poshmarkUrl: null,
  status: 'pending_review',
  notes: '',
  pricingReasoning: '',
  pricingConfidence: 'medium',
  dateAdded: new Date().toISOString(),
  lastUpdated: new Date().toISOString(),
};

describe('Pricing cache gating', () => {
  beforeEach(() => {
    mockedFindComparables.mockReset();
  });

  it('marks cache-miss rule-based pricing as needs_pricing', async () => {
    mockedFindComparables.mockResolvedValue({ items: [], fromCache: false });

    const result = await analyzeItem(baseItem);

    expect(result.needsPricing).toBe(true);
    expect(result.needsPricingReason).toContain('No cached comparable pricing');
    expect(result.needsReview).toBe(false);
    expect(result.pricing.source).toBe('rule_based');
    expect(result.pricing.cacheHit).toBe(false);
  });

  it('allows cached rule-based pricing without needs_pricing', async () => {
    mockedFindComparables.mockResolvedValue({ items: [], fromCache: true });

    const result = await analyzeItem(baseItem);

    expect(result.needsPricing).toBe(false);
    expect(result.pricing.source).toBe('rule_based');
    expect(result.pricing.cacheHit).toBe(true);
  });

  it('uses sold comps immediately when comparables are found', async () => {
    mockedFindComparables.mockResolvedValue({
      fromCache: false,
      items: [
        { title: 'Comp A', price: 18, soldDate: '2026-04-01', url: '', condition: 'good' },
        { title: 'Comp B', price: 22, soldDate: '2026-04-02', url: '', condition: 'good' },
      ],
    });

    const result = await analyzeItem(baseItem);

    expect(result.needsPricing).toBe(false);
    expect(result.pricing.source).toBe('comparables');
    expect(result.pricing.cacheHit).toBe(false);
    expect(result.pricing.comparables).toHaveLength(2);
  });
});
