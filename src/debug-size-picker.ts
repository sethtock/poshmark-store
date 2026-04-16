import { loadEnv } from './lib/env.ts';
import { getSheetsClient, getSpreadsheetId } from './lib/sheets.ts';
import { getAuth, getDriveClient, listPhotosInFolder, downloadAndConvertPhoto } from './lib/drive.ts';
import { getBrowser, closeBrowser } from './lib/poshmark.js';
import { createPoshmarkContext, pageLooksLoggedIn } from './lib/poshmark-session.js';
import { generateListingTitle } from './lib/listing-text.ts';
loadEnv();

async function getFirstReadyItem() {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'All Items!A2:R', valueRenderOption: 'FORMATTED_VALUE' });
  const rows = resp.data.values ?? [];
  return rows.find((r) => r[14] === 'ready_to_post');
}

function mapCategory(category: string): { department: 'kids'; subcategory: string | null } {
  const n = category.toLowerCase();
  if (n.includes('dress')) return { department: 'kids', subcategory: 'Dresses' };
  if (n.includes('shoe') || n.includes('boot') || n.includes('sandal')) return { department: 'kids', subcategory: 'Shoes' };
  if (n.includes('pant') || n.includes('legging') || n.includes('short') || n.includes('bottom')) return { department: 'kids', subcategory: 'Bottoms' };
  if (n.includes('jacket') || n.includes('coat')) return { department: 'kids', subcategory: 'Jackets & Coats' };
  if (n.includes('set')) return { department: 'kids', subcategory: 'Matching Sets' };
  if (n.includes('pajama')) return { department: 'kids', subcategory: 'Pajamas' };
  if (n.includes('one piece') || n.includes('onesie')) return { department: 'kids', subcategory: 'One Pieces' };
  if (n.includes('shirt') || n.includes('top') || n.includes('sweater')) return { department: 'kids', subcategory: 'Shirts & Tops' };
  return { department: 'kids', subcategory: null };
}

function mapSize(size: string | null): { tab: 'Baby' | 'Girls' | 'Custom'; label: string } | null {
  if (!size) return null;
  const raw = size.trim();
  const normalized = raw.toLowerCase().replace(/\s+/g, ' ');
  const monthMap: Record<string, string> = {
    '0-3 months': '0-3 Months', '0 to 3 months': '0-3 Months',
    '3-6 months': '3-6 Months', '3 to 6 months': '3-6 Months',
    '6-9 months': '6-9 Months', '6 to 9 months': '6-9 Months',
    '9-12 months': '9-12 Months', '9 to 12 months': '9-12 Months',
    '12-18 months': '12-18 Months', '12 to 18 months': '12-18 Months',
    '18-24 months': '18-24 Months', '18 to 24 months': '18-24 Months',
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
  const { writeFile } = await import('fs/promises');
  const { join } = await import('path');
  const { tmpdir } = await import('os');
  const axios = (await import('axios')).default;
  const res = await axios.get(url, { responseType: 'arraybuffer' });
  const p = join(tmpdir(), `ph-${Date.now()}.jpg`);
  await writeFile(p, res.data);
  return p;
}

async function main() {
  const row = await getFirstReadyItem();
  if (!row) { console.log('No ready item'); process.exit(0); }
  const folderId = (row[3] ?? '').match(/folders\/([a-zA-Z0-9_-]+)/)?.[1];
  if (!folderId) throw new Error('no folder');
  const drive = await getDriveClient();
  const auth = await getAuth();
  const photos = await listPhotosInFolder(drive, folderId);
  const localPaths = await Promise.all(photos.map((p) => downloadAndConvertPhoto(drive, p, auth)));

  const browser = await getBrowser();
  const context = await createPoshmarkContext(browser);
  const page = await context.newPage();

  await page.goto('https://poshmark.com/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  if (!(await pageLooksLoggedIn(page))) throw new Error('not logged in');

  await page.goto('https://poshmark.com/sell', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  // Upload photos
  const uploadInput = page.locator('#img-file-input, input[name="img-file-input"], input[type="file"]').first();
  await uploadInput.setInputFiles(localPaths);
  await page.waitForTimeout(2000);
  await clickIfVisible(page, 'button:has-text("Apply"):visible');
  await page.waitForTimeout(1500);
  await clickIfVisible(page, 'button:has-text("Got it!"):visible');
  await clickIfVisible(page, 'button:has-text("Ok"):visible');

  const title = generateListingTitle({ id: row[0] ?? '', brand: row[6] || null, size: row[7] || null, color: null, category: row[9] || null });
  await page.locator('input[placeholder="What are you selling? (required)"]').first().fill(title.substring(0, 100));
  await page.locator('textarea[placeholder="Describe it! (required)"]').first().fill(row[5] ?? '');

  if (row[6]) {
    await page.locator('input[placeholder="Enter the Brand/Designer"]').first().fill(row[6]);
    await page.waitForTimeout(500);
  }

  const mc = mapCategory(row[9] ?? 'Kids');
  await page.locator('div.listing-editor__category-container div[data-test="dropdown"]').first().click();
  await page.waitForTimeout(300);
  await page.locator(`a[data-et-name="${mc.department}"]`).click();
  await page.waitForTimeout(300);
  if (mc.subcategory) {
    await page.locator('div.listing-editor__category-container li', { hasText: mc.subcategory }).first().click();
    await page.waitForTimeout(500);
  } else {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }

  const ms = mapSize(row[7]);
  if (ms) {
    const sd = page.locator('div[data-test="dropdown"][selectortestlocator="size"]').first();
    await sd.scrollIntoViewIfNeeded();
    await sd.click({ force: true });
    await page.waitForTimeout(500);
    if (ms.tab !== 'Baby' && ms.tab !== 'Custom') {
      const tb = page.getByText(ms.tab, { exact: true });
      if (await tb.isVisible().catch(() => false)) await tb.click();
      await page.waitForTimeout(300);
    }
    if (ms.tab === 'Custom') {
      const ct = page.getByText('Custom', { exact: true });
      if (await ct.isVisible().catch(() => false)) await ct.click();
      await page.locator('input[id^="customSizeInput"]').first().fill(ms.label);
      await page.locator('button:has-text("Save")').first().click();
    } else {
      const sb = page.locator(`button:has-text("${ms.label}")`).first();
      if (await sb.isVisible().catch(() => false)) await sb.click();
      else {
        const si = page.locator('input[placeholder*="size" i], input[placeholder*="Size"]').first();
        if (await si.isVisible().catch(() => false)) { await si.fill(ms.label); await page.waitForTimeout(300); }
      }
    }
    await clickIfVisible(page, 'button:has-text("Done"):visible');
    await page.waitForTimeout(500);
  }

  // Condition
  try {
    const cd = page.locator('text=Select Condition').locator('xpath=ancestor::div[@data-test="dropdown"][1]');
    await cd.click();
    await page.waitForTimeout(300);
    const condMap: Record<string, string> = { nwt: 'New With Tags (NWT)', nwot: 'Like New', like_new: 'Like New', good: 'Good', fair: 'Fair' };
    await page.getByText(condMap[row[8] ?? 'good'] ?? 'Good', { exact: true }).click();
    await page.waitForTimeout(500);
  } catch {}

  // Price
  const price = Number(row[12]) || 0;
  const lp = page.locator('input[data-vv-name="listingPrice"], input.listing-price-input').first();
  await lp.fill(String(price));

  await clickIfVisible(page, 'button:has-text("Yes"):visible');
  await clickIfVisible(page, 'button:has-text("Done"):visible');
  await clickIfVisible(page, 'button:has-text("Ok"):visible');
  await clickIfVisible(page, 'button:has-text("Got it!"):visible');

  // Click Next and capture result
  await page.getByText('Next', { exact: true }).click();
  await page.waitForTimeout(3000);

  // Snapshot after Next
  const afterNextActions = await page.locator('button:visible, a:visible').evaluateAll((els: Element[]) =>
    els.map((el) => ({ tag: (el as HTMLElement).tagName, text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120), href: (el as HTMLAnchorElement).href || null }))
      .filter((x: any) => x.text || x.href).slice(0, 30)
  ).catch(() => []);

  const bodyAfterNext = ((await page.textContent('body')) || '').replace(/\s+/g, ' ').slice(0, 3000);
  const urlAfterNext = page.url();

  // Click List This Item if present, then capture again
  const listBtn = page.locator('button:has-text("List This Item")');
  const hasListBtn = await listBtn.isVisible().catch(() => false);
  if (hasListBtn) {
    await listBtn.click();
    await page.waitForTimeout(3000);
  }

  const finalActions = await page.locator('button:visible, a:visible').evaluateAll((els: Element[]) =>
    els.map((el) => ({ tag: (el as HTMLElement).tagName, text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120), href: (el as HTMLAnchorElement).href || null }))
      .filter((x: any) => x.text || x.href).slice(0, 30)
  ).catch(() => []);

  const finalUrl = page.url();

  console.log(JSON.stringify({ urlAfterNext, afterNextActions, finalUrl, finalActions, bodySnippet: finalUrl.includes('listing') ? bodyAfterNext.slice(0, 500) : bodyAfterNext.slice(0, 1000) }, null, 2));
  await page.screenshot({ path: '/tmp/nike-after-list.png', fullPage: true }).catch(() => {});
  console.log('/tmp/nike-after-list.png');
  await context.close();
  await closeBrowser();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : String(e));
  await closeBrowser();
  process.exit(1);
});
