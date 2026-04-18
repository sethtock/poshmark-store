import { describe, expect, it } from 'vitest';
import { generateListingDescription, generateListingTitle } from '../listing-text.js';

describe('listing text generation', () => {
  it('uses shoes instead of footwear in generated titles', () => {
    expect(generateListingTitle({
      brand: 'Nike',
      category: 'footwear',
      size: '6C',
      color: 'blue',
      id: 'item-001',
    })).toBe('Nike Shoes 6C Blue');
  });

  it('writes a more human description for worn items', () => {
    const description = generateListingDescription({
      condition: 'good',
      brand: 'Nike',
      category: 'shoes',
      color: 'Blue/Red',
      notes: 'Blue and red colorway with velcro straps and sporty look.',
    });

    expect(description).toContain('This Nike pair of shoes in blue was worn by my little one');
    expect(description).toContain('Gently used and still in really nice shape.');
    expect(description).toContain('Cute detail: blue and red colorway with velcro straps and sporty look.');
  });

  it('keeps nwt descriptions authentic without saying it was worn', () => {
    const description = generateListingDescription({
      condition: 'nwt',
      brand: 'Janie and Jack',
      category: 'dress',
      color: 'Pink',
      notes: 'Floral print with ruffle sleeves.',
    });

    expect(description).toContain('New with tags from Janie and Jack in pink.');
    expect(description).not.toContain('worn by my little one');
  });

  it('strips hedging about photos from detail notes', () => {
    const description = generateListingDescription({
      condition: 'good',
      brand: 'Burberry',
      category: 'button-down shirts',
      color: 'Archive Beige',
      notes: 'No major flaws visible in the photos. Wrinkling from storage.',
    });

    expect(description).toContain('Cute detail: no major flaws.');
    expect(description).not.toContain('visible in the photos');
  });

  it('avoids visible-wear wording in stock condition lines', () => {
    const likeNew = generateListingDescription({
      condition: 'like_new',
      brand: 'Nike',
      category: 'shoes',
      color: 'Blue',
      notes: '',
    });

    const fair = generateListingDescription({
      condition: 'fair',
      brand: 'Nike',
      category: 'shoes',
      color: 'Blue',
      notes: '',
    });

    expect(likeNew).toContain('little to no wear');
    expect(likeNew).not.toContain('visible wear');
    expect(fair).toContain('noticeable wear');
  });
});
