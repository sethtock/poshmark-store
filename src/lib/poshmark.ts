// Poshmark browser automation via Playwright

import { chromium, type Browser, type Page } from 'playwright';

const POSHMARK_URL = 'https://poshmark.com';

let browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
  }
  return browser;
}

export async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

async function login(page: Page): Promise<void> {
  const email = process.env.POSHMARK_EMAIL;
  const password = process.env.POSHMARK_PASSWORD;
  if (!email || !password) throw new Error('POSHMARK_EMAIL / POSHMARK_PASSWORD not set');

  await page.goto(`${POSHMARK_URL}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  if (await pageLooksLoggedIn(page)) {
    await savePoshmarkSession(page.context());
    return;
  }

  await page.goto(`${POSHMARK_URL}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  const emailInput = page.locator('input[name="login_form[username_email]"], input[name="username_email"], input[type="email"], input[name="email"]').first();
  const passwordInput = page.locator('input[name="login_form[password]"], input[name="password"], input[type="password"]').first();
  const submitButton = page.locator('button[type="submit"], button:has-text("Log In"), button:has-text("Login")').first();

  await emailInput.fill(email);
  await passwordInput.fill(password);
  await submitButton.click();

  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2500);

  if (!(await pageLooksLoggedIn(page))) {
    throw new Error('Poshmark login did not complete. A saved session or interactive verification may be required.');
  }

  await savePoshmarkSession(page.context());
}

async function dismissPhotoModal(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let acted = false;
    acted = await clickIfVisible(page, 'button:has-text("Apply"):visible') || acted;
    acted = await clickIfVisible(page, 'button:has-text("Done"):visible') || acted;
    acted = await clickIfVisible(page, 'button:has-text("Got it!"):visible') || acted;
    acted = await clickIfVisible(page, 'button:has-text("Ok"):visible') || acted;

    const modalVisible = await page.locator('div.listing-editor__image-modal, div[data-test="modal-body"].listing-editor__image-modal').first().isVisible().catch(() => false);
    if (!modalVisible) return;

    if (!acted) {
      await page.keyboard.press('Escape').catch(() => {});
    }
    await page.waitForTimeout(500);
  }

  await page.locator('div.listing-editor__image-modal, div[data-test="modal-body"].listing-editor__image-modal').first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
}

async function uploadPhotos(page: Page, photoUrls: string[]): Promise<void> {
  const hasFileInput = await page.locator('input[type="file"]').count().catch(() => 0);
  if (!hasFileInput) {
    await page.click('button[data-test="create-list-btn"], a[href="/create-listing"], a[href="/sell"]', { timeout: 5000 }).catch(async () => {
      await page.goto(`${POSHMARK_URL}/sell`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle');
    });
  }

  await page.waitForSelector('#img-file-input, input[name="img-file-input"], input[type="file"]', { timeout: 10000 });

  const uploadInput = page.locator('#img-file-input, input[name="img-file-input"], input[type="file"]').first();
  const filePaths: string[] = [];
  for (const url of photoUrls) {
    if (/^https?:\/\//i.test(url)) {
      const downloadUrl = url.replace('uc?export=view&id=', 'uc?export=download&id=');
      const filePath = await downloadToTemp(downloadUrl);
      filePaths.push(filePath);
    } else {
      filePaths.push(url);
    }
  }

  await uploadInput.setInputFiles(filePaths);
  await page.waitForTimeout(1500);
  await dismissPhotoModal(page);
  await page.waitForTimeout(1000);
}

import { writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import axios from 'axios';
import { createPoshmarkContext, pageLooksLoggedIn, savePoshmarkSession } from './poshmark-session.js';

async function downloadToTemp(url: string): Promise<string> {
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  const tmpPath = join(tmpdir(), `poshmark-photo-${Date.now()}.jpg`);
  await writeFile(tmpPath, response.data);
  return tmpPath;
}

interface ListingData {
  title: string;
  description: string;
  category: string;
  brand: string | null;
  size: string | null;
  condition: string;
  price: number;
  photoUrls: string[];
}

function normalizeNullableText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^(null|n\/a|na|none|unknown)$/i.test(trimmed)) return null;
  return trimmed;
}

function isFootwearCategory(category: string | null): boolean {
  const normalized = (normalizeNullableText(category) ?? '').toLowerCase();
  return normalized.includes('shoe') || normalized.includes('boot') || normalized.includes('sandal') || normalized.includes('footwear') || normalized.includes('sneaker') || normalized.includes('slipper') || normalized.includes('moccasin') || normalized.includes('crib shoe');
}

function mapCategory(category: string): { department: 'kids'; subcategory: string | null } {
  const normalized = category.toLowerCase();

  if (normalized.includes('dress')) return { department: 'kids', subcategory: 'Dresses' };
  if (isFootwearCategory(category)) return { department: 'kids', subcategory: 'Shoes' };
  if (normalized.includes('pant') || normalized.includes('legging') || normalized.includes('short') || normalized.includes('bottom')) return { department: 'kids', subcategory: 'Bottoms' };
  if (normalized.includes('jacket') || normalized.includes('coat')) return { department: 'kids', subcategory: 'Jackets & Coats' };
  if (normalized.includes('set')) return { department: 'kids', subcategory: 'Matching Sets' };
  if (normalized.includes('pajama')) return { department: 'kids', subcategory: 'Pajamas' };
  if (normalized.includes('one piece') || normalized.includes('onesie')) return { department: 'kids', subcategory: 'One Pieces' };
  if (normalized.includes('shirt') || normalized.includes('top') || normalized.includes('sweater')) return { department: 'kids', subcategory: 'Shirts & Tops' };

  return { department: 'kids', subcategory: null };
}

function mapSize(size: string | null, category: string | null): { tab: 'Baby' | 'Girls' | 'Boys' | 'Custom'; label: string } | null {
  const rawSize = normalizeNullableText(size);
  if (!rawSize) return null;

  const raw = rawSize.replace(/^us\s+/i, '').trim();
  const normalized = raw.toLowerCase().replace(/\s+/g, ' ');

  const monthMap: Record<string, string> = {
    '0-3 months': '0-3 Months',
    '0 to 3 months': '0-3 Months',
    '3-6 months': '3-6 Months',
    '3 to 6 months': '3-6 Months',
    '6-9 months': '6-9 Months',
    '6 to 9 months': '6-9 Months',
    '9-12 months': '9-12 Months',
    '9 to 12 months': '9-12 Months',
    '12-18 months': '12-18 Months',
    '12 to 18 months': '12-18 Months',
    '18-24 months': '18-24 Months',
    '18 to 24 months': '18-24 Months',
    '3 months': '3 Months',
    '6 months': '6 Months',
    '9 months': '9 Months',
    '12 months': '12 Months',
    '18 months': '18 Months',
    '24 months': '24 Months',
  };

  if (monthMap[normalized]) return { tab: 'Baby', label: monthMap[normalized] };

  if (isFootwearCategory(category)) {
    const childShoeMatch = raw.match(/^(\d+(?:\.\d+)?)\s*[ck]$/i);
    if (childShoeMatch) {
      const numeric = childShoeMatch[1];
      return { tab: Number(numeric) <= 7 ? 'Baby' : 'Boys', label: numeric };
    }

    const numericShoeMatch = raw.match(/^(\d+(?:\.\d+)?)$/);
    if (numericShoeMatch) {
      const numeric = numericShoeMatch[1];
      return { tab: Number(numeric) <= 7 ? 'Baby' : 'Boys', label: numeric };
    }
  }

  if (/^\d+t$/i.test(raw)) return { tab: 'Girls', label: raw.toUpperCase() };
  if (/^\d+[ck]?$/i.test(raw)) return { tab: 'Girls', label: raw.toUpperCase() };

  return { tab: 'Custom', label: raw };
}

async function clickIfVisible(page: Page, selector: string): Promise<boolean> {
  const locator = page.locator(selector).first();
  if (await locator.isVisible().catch(() => false)) {
    await locator.click();
    return true;
  }
  return false;
}

export async function createListing(listing: ListingData): Promise<string> {
  const browser = await getBrowser();
  const context = await createPoshmarkContext(browser);
  const page = await context.newPage();

  try {
    await login(page);

    // Go to create listing
    await page.goto(`${POSHMARK_URL}/sell`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');

    // Upload photos
    await uploadPhotos(page, listing.photoUrls);
    await page.waitForTimeout(2000);
    await dismissPhotoModal(page);

    // Use evaluate-based fill to properly trigger React controlled-input events
    const titleVal = listing.title.substring(0, 100);
    await page.evaluate((t: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = globalThis as any;
      const doc = win.document;
      if (!doc) return;
      const input: any = doc.querySelector('input[placeholder="What are you selling? (required)"]');
      if (input) {
        const proto = win.HTMLInputElement?.prototype;
        const setter = proto && Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(input, t);
        else input.value = t;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, titleVal);
    await page.waitForTimeout(300);

    const descVal = listing.description;
    await page.evaluate((t: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = globalThis as any;
      const doc = win.document;
      if (!doc) return;
      const textarea: any = doc.querySelector('textarea[placeholder="Describe it! (required)"]');
      if (textarea) {
        const proto = win.HTMLTextAreaElement?.prototype;
        const setter = proto && Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(textarea, t);
        else textarea.value = t;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, descVal);
    await page.waitForTimeout(300);

    if (listing.brand) {
      const brandInput = page.locator('input[placeholder="Enter the Brand/Designer"]').first();
      await brandInput.fill(listing.brand);
      await page.waitForTimeout(300);
    }

    const mappedCategory = mapCategory(listing.category);
    const categoryDropdown = page.locator('div.listing-editor__category-container div[data-test="dropdown"]').first();
    await categoryDropdown.click();
    await page.waitForTimeout(300);
    await page.locator(`a[data-et-name="${mappedCategory.department}"]`).click();
    await page.waitForTimeout(300);
    if (mappedCategory.subcategory) {
      await page.locator('div.listing-editor__category-container li', { hasText: mappedCategory.subcategory }).first().click();
      await page.waitForTimeout(500);
    } else {
      // No subcategory — dismiss the open picker and wait for it to close
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }

    const mappedSize = mapSize(listing.size, listing.category);
    if (mappedSize) {
      // Scroll the size dropdown into view and force-click through any overlay
      const sizeDropdown = page.locator('div[data-test="dropdown"][selectortestlocator="size"]').first();
      await sizeDropdown.scrollIntoViewIfNeeded();
      await sizeDropdown.click({ force: true });
      await page.waitForTimeout(500);
      if (mappedSize.tab !== 'Baby' && mappedSize.tab !== 'Custom') {
        // Try to click the tab first, but don't fail if it's not there
        const tabBtn = page.getByText(mappedSize.tab, { exact: true });
        if (await tabBtn.isVisible().catch(() => false)) {
          await tabBtn.click();
          await page.waitForTimeout(300);
        }
      }

      if (mappedSize.tab === 'Custom') {
        const customTab = page.getByText('Custom', { exact: true });
        if (await customTab.isVisible().catch(() => false)) {
          await customTab.click();
        }
        await page.locator('input[id^="customSizeInput"]').first().fill(mappedSize.label);
        await page.locator('button:has-text("Save")').first().click();
      } else {
        // Try to find the size button directly (it may be in Baby tab or already visible)
        const sizeBtn = page.locator(`button:has-text("${mappedSize.label}")`).first();
        if (await sizeBtn.isVisible().catch(() => false)) {
          await sizeBtn.click();
        } else {
          // Fallback: type into a size search input if one exists
          const sizeInput = page.locator('input[placeholder*="size" i], input[placeholder*="Size"]').first();
          if (await sizeInput.isVisible().catch(() => false)) {
            await sizeInput.fill(mappedSize.label);
            await page.waitForTimeout(300);
          }
        }
      }

      await clickIfVisible(page, 'button:has-text("Done"):visible');
      await page.waitForTimeout(300);
    }

    try {
      const conditionDropdown = page.locator('text=Select Condition').locator('xpath=ancestor::div[@data-test="dropdown"][1]');
      await conditionDropdown.click();
      await page.waitForTimeout(300);
      const conditionMap: Record<string, string> = {
        nwt: 'New With Tags (NWT)',
        nwot: 'Like New',
        like_new: 'Like New',
        good: 'Good',
        fair: 'Fair',
      };
      const conditionText = conditionMap[listing.condition] ?? 'Good';
      await page.getByText(conditionText, { exact: true }).click();
      await page.waitForTimeout(300);
    } catch {
      // Condition selection failed
    }

    const originalPriceInput = page.locator('input[data-vv-name="originalPrice"]').first();
    const listingPriceInput = page.locator('input[data-vv-name="listingPrice"], input.listing-price-input').first();
    const originalPrice = Math.max(listing.price, Math.round(listing.price * 1.5));
    if (await originalPriceInput.isVisible().catch(() => false)) {
      await originalPriceInput.fill(String(originalPrice));
    }
    await listingPriceInput.fill(String(listing.price));

    await clickIfVisible(page, 'button:has-text("Yes"):visible');
    await clickIfVisible(page, 'button:has-text("Done"):visible');
    await clickIfVisible(page, 'button:has-text("Ok"):visible');
    await clickIfVisible(page, 'button:has-text("Got it!"):visible');

    await page.getByText('Next', { exact: true }).click();
    await page.waitForTimeout(2500);

    await clickIfVisible(page, 'button:has-text("List This Item"):visible');
    await page.waitForTimeout(1500);
    await clickIfVisible(page, 'button:has-text("Certify Listing")');
    await page.waitForTimeout(1000);
    await clickIfVisible(page, 'button:has-text("Certify")');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(4000);

    // Capture the listing URL from the redirect
    const url = page.url();
    if (url.includes('/listing/')) {
      return url;
    }

    // Try to find the listing link in the page
    const listingLink = await page.locator('a[href*="/listing/"]').first().getAttribute('href').catch(() => null);
    if (listingLink) {
      return `${POSHMARK_URL}${listingLink}`;
    }

    const visibleButtons = await page.locator('button:visible, a:visible').evaluateAll((els) =>
      els.map((el) => ({
        tag: el.tagName,
        text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120),
        href: el.getAttribute('href'),
      })).filter((x) => x.text || x.href).slice(0, 25),
    ).catch(() => []);

    throw new Error(`Could not determine listing URL after publish. Final URL: ${page.url()} Visible actions: ${JSON.stringify(visibleButtons)}`);
  } finally {
    await context.close();
  }
}

/** Get listing status by URL (checks if it's still active, sold, etc.) */
export async function checkListingStatus(listingUrl: string): Promise<{ status: 'active' | 'sold' | 'not_found'; price: number | null }> {
  const browser = await getBrowser();
  const context = await createPoshmarkContext(browser);
  const page = await context.newPage();

  try {
    await login(page);
    await page.goto(listingUrl);
    await page.waitForLoadState('networkidle');

    const pageText = await page.textContent('body');

    if (pageText?.includes('Sold')) {
      return { status: 'sold', price: null };
    }

    if (pageText?.includes('Not Found') || pageText?.includes('removed')) {
      return { status: 'not_found', price: null };
    }

    // Try to get price
    let price: number | null = null;
    try {
      const priceText = await page.locator('[data-test="price"]').first().textContent();
      if (priceText) {
        price = parseFloat(priceText.replace(/[^0-9.]/g, ''));
      }
    } catch {
      // Price not found
    }

    return { status: 'active', price };
  } finally {
    await context.close();
  }
}
