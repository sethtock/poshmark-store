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

async function uploadPhotos(page: Page, photoUrls: string[]): Promise<void> {
  const hasFileInput = await page.locator('input[type="file"]').count().catch(() => 0);
  if (!hasFileInput) {
    await page.click('button[data-test="create-list-btn"], a[href="/create-listing"], a[href="/sell"]', { timeout: 5000 }).catch(async () => {
      await page.goto(`${POSHMARK_URL}/sell`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle');
    });
  }

  await page.waitForSelector('input[type="file"]', { timeout: 10000 });

  // Upload each photo
  const fileInput = page.locator('input[type="file"]');
  for (const url of photoUrls) {
    // Convert Drive URL to direct download
    const downloadUrl = url.replace('uc?export=view&id=', 'uc?export=download&id=');
    const filePath = await downloadToTemp(downloadUrl);
    await fileInput.setInputFiles(filePath);
    // Small delay between uploads
    await page.waitForTimeout(500);
  }
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

    // Fill title
    const titleInput = page.locator('input[name="title"], input[placeholder*="title" i]');
    await titleInput.fill(listing.title.substring(0, 100));

    // Fill description
    const descInput = page.locator('textarea[name="description"], textarea[placeholder*="description" i]');
    await descInput.fill(listing.description);

    // Fill price
    const priceInput = page.locator('input[name="price"], input[placeholder*="price" i]');
    await priceInput.fill(String(listing.price));

    // Select category (approximate — Poshmark has a category picker UI)
    // This is one of the trickiest parts — the UI is React-based with cascaded dropdowns
    // We'll try to click through it
    try {
      await page.click('button[data-test="category-picker"]', { timeout: 3000 });
      await page.click('button[data-test="category-item"]:has-text("Kids")', { timeout: 2000 });
      await page.waitForTimeout(500);
    } catch {
      // Category selection failed — log and continue
    }

    // Select condition
    try {
      const conditionMap: Record<string, string> = {
        like_new: 'New with Tags',
        good: 'Good',
        fair: 'Fair',
      };
      const conditionText = conditionMap[listing.condition] ?? 'Good';
      await page.click(`button:has-text("${conditionText}")`, { timeout: 3000 });
    } catch {
      // Condition selection failed
    }

    // Fill brand
    if (listing.brand) {
      try {
        const brandInput = page.locator('input[name="brand"], input[placeholder*="brand" i]').first();
        await brandInput.fill(listing.brand);
        await page.waitForTimeout(500);
      } catch {
        // Brand field not found
      }
    }

    // Fill size
    if (listing.size) {
      try {
        const sizeInput = page.locator('input[name="size"], input[placeholder*="size" i]').first();
        await sizeInput.fill(listing.size);
        await page.waitForTimeout(300);
      } catch {
        // Size field not found
      }
    }

    // Submit listing
    await page.click('button[data-test="submit-btn"], button:has-text("List"), button:has-text("Publish")', { timeout: 5000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

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

    throw new Error('Could not determine listing URL after publish');
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
