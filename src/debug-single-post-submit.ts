import { writeFile } from 'fs/promises';
import { loadEnv } from './lib/env.js';
import { getSheetsClient, getSpreadsheetId } from './lib/sheets.js';
import { getDriveClient, listPhotosInFolder, getPhotoUrl } from './lib/drive.js';
import { getBrowser, closeBrowser } from './lib/poshmark.js';
import { createPoshmarkContext, pageLooksLoggedIn } from './lib/poshmark-session.js';
import type { Item } from './types.js';
import axios from 'axios';
import { join } from 'path';
import { tmpdir } from 'os';
import { generateListingTitle } from './lib/listing-text.js';

loadEnv();

function mapCategory(category: string): { department: 'kids'; subcategory: string | null } {
  const normalized = category.toLowerCase();
  if (normalized.includes('dress')) return { department: 'kids', subcategory: 'Dresses' };
  if (normalized.includes('shoe') || normalized.includes('boot') || normalized.includes('sandal')) return { department: 'kids', subcategory: 'Shoes' };
  if (normalized.includes('pant') || normalized.includes('legging') || normalized.includes('short') || normalized.includes('bottom')) return { department: 'kids', subcategory: 'Bottoms' };
  if (normalized.includes('jacket') || normalized.includes('coat')) return { department: 'kids', subcategory: 'Jackets & Coats' };
  if (normalized.includes('set')) return { department: 'kids', subcategory: 'Matching Sets' };
  if (normalized.includes('pajama')) return { department: 'kids', subcategory: 'Pajamas' };
  if (normalized.includes('one piece') || normalized.includes('onesie')) return { department: 'kids', subcategory: 'One Pieces' };
  if (normalized.includes('shirt') || normalized.includes('top') || normalized.includes('sweater')) return { department: 'kids', subcategory: 'Shirts & Tops' };
  return { department: 'kids', subcategory: null };
}

function mapSize(size: string | null): { tab: 'Baby' | 'Girls' | 'Custom'; label: string } | null {
  if (!size) return null;
  const raw = size.trim();
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
  if (/^\d+t$/i.test(raw)) return { tab: 'Girls', label: raw.toUpperCase() };
  if (/^\d+[ck]?$/i.test(raw)) return { tab: 'Girls', label: raw.toUpperCase() };
  return { tab: 'Custom', label: raw };
}

async function clickIfVisible(page: any, selector: string): Promise<boolean> {
  const locator = page.locator(selector).first();
  if (await locator.isVisible().catch(() => false)) {
    await locator.click();
    return true;
  }
  return false;
}

async function downloadToTemp(url: string): Promise<string> {
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  const tmpPath = join(tmpdir(), `poshmark-photo-${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`);
  await writeFile(tmpPath, response.data);
  return tmpPath;
}

async function getFirstReadyItem(): Promise<Item> {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'All Items!A2:Q', valueRenderOption: 'FORMATTED_VALUE' });
  const rows = response.data.values ?? [];
  const row = rows.find((r) => r[13] === 'ready_to_post');
  if (!row) throw new Error('No ready_to_post items found');
  const folderUrl = row[3] ?? '';
  const folderIdMatch = folderUrl.match(/folders\/([a-zA-Z0-9_-]+)/);
  const folderId = folderIdMatch?.[1];
  if (!folderId) throw new Error(`Could not parse folder ID from ${folderUrl}`);
  const drive = await getDriveClient();
  const photos = await listPhotosInFolder(drive, folderId);
  const photoUrls = photos.map((p) => getPhotoUrl(p.id));
  return {
    id: row[0] ?? '',
    dateAdded: row[1] ? new Date(`${row[1]}T00:00:00.000Z`).toISOString() : new Date().toISOString(),
    folderName: row[2] ?? '',
    folderId,
    description: row[4] ?? '',
    brand: row[5] || null,
    size: row[6] || null,
    condition: (row[7] as Item['condition']) || 'good',
    category: row[8] || null,
    photoUrls,
    localPhotoPaths: [],
    initialPrice: row[10] ? Number(row[10]) : null,
    currentPrice: row[11] ? Number(row[11]) : null,
    poshmarkUrl: row[12] || null,
    status: (row[13] as Item['status']) || 'ready_to_post',
    pricingReasoning: row[14] ?? '',
    pricingConfidence: (row[15] as Item['pricingConfidence']) || 'medium',
    notes: row[16] ?? '',
    color: null,
    lastUpdated: new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  const item = await getFirstReadyItem();
  const title = generateListingTitle(item);
  const price = item.currentPrice ?? item.initialPrice ?? 0;
  const mappedCategory = mapCategory(item.category ?? 'Kids');
  const mappedSize = mapSize(item.size);

  const browser = await getBrowser();
  const context = await createPoshmarkContext(browser);
  const page = await context.newPage();

  const events: Array<Record<string, unknown>> = [];
  const interesting = (url: string) =>
    url.includes('poshmark.com') && (
      url.includes('/api/') ||
      url.includes('/vm-rest/') ||
      url.includes('/users/') ||
      url.includes('/posts') ||
      url.includes('/listing') ||
      url.includes('/create-listing') ||
      url.includes('/sell')
    );

  page.on('request', (req) => {
    const url = req.url();
    if (!interesting(url)) return;
    events.push({ type: 'request', method: req.method(), url, postData: req.postData() ?? null, ts: Date.now() });
  });

  page.on('requestfailed', (req) => {
    const url = req.url();
    if (!interesting(url)) return;
    events.push({ type: 'requestfailed', method: req.method(), url, failure: req.failure()?.errorText ?? null, ts: Date.now() });
  });

  page.on('response', async (res) => {
    const url = res.url();
    if (!interesting(url)) return;
    let body: string | null = null;
    if (res.status() >= 400 || url.includes('/posts') || url.includes('/users/')) {
      body = await res.text().catch(() => null);
      if (body && body.length > 2000) body = body.slice(0, 2000);
    }
    events.push({ type: 'response', status: res.status(), url, body, ts: Date.now() });
  });

  try {
    await page.goto('https://poshmark.com/dashboard', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    if (!(await pageLooksLoggedIn(page))) {
      throw new Error('Saved session is not logged in');
    }

    await page.goto('https://poshmark.com/sell', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    const uploadInput = page.locator('#img-file-input, input[name="img-file-input"], input[type="file"]').first();
    const filePaths: string[] = [];
    for (const url of item.photoUrls) {
      const downloadUrl = url.replace('uc?export=view&id=', 'uc?export=download&id=');
      filePaths.push(await downloadToTemp(downloadUrl));
    }
    await uploadInput.setInputFiles(filePaths);
    await page.waitForTimeout(2000);

    await clickIfVisible(page, 'button:has-text("Got it!")');
    await clickIfVisible(page, 'button:has-text("Ok")');

    await page.locator('input[placeholder="What are you selling? (required)"]').first().fill(title.substring(0, 100));
    await page.locator('textarea[placeholder="Describe it! (required)"]').first().fill(item.description);

    if (item.brand) {
      await page.locator('input[placeholder="Enter the Brand/Designer"]').first().fill(item.brand);
      await page.waitForTimeout(500);
    }

    await page.locator('div.listing-editor__category-container div[data-test="dropdown"]').first().click();
    await page.waitForTimeout(300);
    await page.locator(`a[data-et-name="${mappedCategory.department}"]`).click();
    await page.waitForTimeout(300);
    if (mappedCategory.subcategory) {
      await page.locator('div.listing-editor__category-container li', { hasText: mappedCategory.subcategory }).first().click();
      await page.waitForTimeout(500);
    }

    if (mappedSize) {
      await page.locator('div[data-test="dropdown"][selectortestlocator="size"]').first().click();
      await page.waitForTimeout(300);
      if (mappedSize.tab !== 'Baby') {
        await page.getByText(mappedSize.tab, { exact: true }).click();
        await page.waitForTimeout(300);
      }
      if (mappedSize.tab === 'Custom') {
        await page.locator('input[id^="customSizeInput"]').first().fill(mappedSize.label);
        await page.locator('button:has-text("Save")').first().click();
      } else {
        await page.locator(`button:has-text("${mappedSize.label}")`).first().click();
      }
      await clickIfVisible(page, 'button:has-text("Done"):visible');
      await page.waitForTimeout(500);
    }

    const conditionMap: Record<string, string> = {
      nwt: 'New With Tags (NWT)',
      nwot: 'Like New',
      like_new: 'Like New',
      good: 'Good',
      fair: 'Fair',
    };
    const conditionDropdown = page.locator('text=Select Condition').locator('xpath=ancestor::div[@data-test="dropdown"][1]');
    await conditionDropdown.click();
    await page.waitForTimeout(300);
    await page.getByText(conditionMap[item.condition] ?? 'Good', { exact: true }).click();
    await page.waitForTimeout(500);

    const originalPriceInput = page.locator('input[data-vv-name="originalPrice"]').first();
    const listingPriceInput = page.locator('input[data-vv-name="listingPrice"], input.listing-price-input').first();
    if (await originalPriceInput.isVisible().catch(() => false)) {
      await originalPriceInput.fill(String(Math.max(price, Math.round(price * 1.5))));
    }
    await listingPriceInput.fill(String(price));

    await clickIfVisible(page, 'button:has-text("Yes"):visible');
    await clickIfVisible(page, 'button:has-text("Done"):visible');
    await clickIfVisible(page, 'button:has-text("Ok"):visible');
    await clickIfVisible(page, 'button:has-text("Got it!"):visible');

    const preNextErrors = await page.locator('.form__error-message:visible').allTextContents().catch(() => []);
    console.log(JSON.stringify({ step: 'before-next', preNextErrors, url: page.url() }, null, 2));

    await page.getByText('Next', { exact: true }).click();
    await page.waitForTimeout(3000);

    const postNextErrors = await page.locator('.form__error-message:visible').allTextContents().catch(() => []);
    const postNextButtons = await page.locator('button:visible, a:visible').evaluateAll((els) =>
      els.map((el) => ({ text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120), href: el.getAttribute('href') })).filter((x) => x.text || x.href).slice(0, 25),
    ).catch(() => []);

    console.log(JSON.stringify({ step: 'after-next', postNextErrors, url: page.url(), postNextButtons }, null, 2));

    await clickIfVisible(page, 'button:has-text("Certify Listing")');
    await page.waitForTimeout(1000);
    await clickIfVisible(page, 'button:has-text("Certify")');
    await page.waitForTimeout(5000);

    const finalErrors = await page.locator('.form__error-message:visible').allTextContents().catch(() => []);
    const ariaInvalid = await page.locator('[aria-invalid="true"], .form__error').evaluateAll((els) =>
      els.map((el) => ({
        tag: el.tagName,
        text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 300),
        cls: el.getAttribute('class'),
        placeholder: el.getAttribute('placeholder'),
        vv: el.getAttribute('data-vv-name'),
      })).slice(0, 25),
    ).catch(() => []);

    const bodyText = ((await page.textContent('body')) || '').replace(/\s+/g, ' ').slice(0, 4000);
    const out = {
      itemId: item.id,
      title,
      finalUrl: page.url(),
      finalErrors,
      ariaInvalid,
      bodyText,
      events: events.slice(-120),
    };

    await writeFile('/tmp/poshmark-final-submit-debug.json', JSON.stringify(out, null, 2));
    await page.screenshot({ path: '/tmp/poshmark-final-submit-debug.png', fullPage: true }).catch(() => {});
    console.log('/tmp/poshmark-final-submit-debug.json');
    console.log('/tmp/poshmark-final-submit-debug.png');
  } finally {
    await context.close();
    await closeBrowser();
  }
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  await closeBrowser();
  process.exit(1);
});
