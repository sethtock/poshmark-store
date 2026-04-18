import { loadEnv } from './lib/env.js';
import { ALL_ITEMS_DATA_RANGE, SHEET_COLUMN, getSheetsClient, getSpreadsheetId, updateItem } from './lib/sheets.js';
import { generateListingDescription, generateListingTitle } from './lib/listing-text.js';
import { closeBrowser, updateListing } from './lib/poshmark.js';
import type { Item } from './types.js';

loadEnv();

const STOCK_DESCRIPTIONS = new Set([
  'Excellent condition with little to no visible wear.\nReady to ship same or next business day! 🚀\nHappy to answer any questions!',
  'Gently used and still in great shape.\nReady to ship same or next business day! 🚀\nHappy to answer any questions!',
  'Pre-loved with visible wear, priced accordingly.\nReady to ship same or next business day! 🚀\nHappy to answer any questions!',
  'Pre-loved and ready for a new home.\nReady to ship same or next business day! 🚀\nHappy to answer any questions!',
]);

function sanitizeCell(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^(null|n\/a|na|none|unknown)$/i.test(trimmed)) return null;
  return trimmed;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').replace(/\r\n/g, '\n').trim();
}

function rowToItem(row: string[]): Item {
  const folderUrl = row[SHEET_COLUMN.driveFolder] ?? '';
  const folderId = folderUrl.match(/folders\/([a-zA-Z0-9_-]+)/)?.[1] ?? '';

  return {
    id: row[SHEET_COLUMN.itemId] ?? '',
    dateAdded: row[SHEET_COLUMN.dateAdded] ? new Date(`${row[SHEET_COLUMN.dateAdded]}T00:00:00.000Z`).toISOString() : new Date().toISOString(),
    folderName: row[SHEET_COLUMN.folderName] ?? '',
    folderId,
    photoUrls: normalizeText(row[SHEET_COLUMN.photoLinks]).split('\n').filter(Boolean),
    localPhotoPaths: [],
    title: row[SHEET_COLUMN.title] ?? '',
    description: row[SHEET_COLUMN.description] ?? '',
    brand: sanitizeCell(row[SHEET_COLUMN.brand]),
    size: sanitizeCell(row[SHEET_COLUMN.size]),
    color: null,
    condition: (row[SHEET_COLUMN.condition] as Item['condition']) || 'good',
    category: sanitizeCell(row[SHEET_COLUMN.category]),
    initialPrice: row[SHEET_COLUMN.listPrice] ? Number(row[SHEET_COLUMN.listPrice]) : null,
    currentPrice: row[SHEET_COLUMN.currentPrice] ? Number(row[SHEET_COLUMN.currentPrice]) : null,
    acceptedSellPrice: row[SHEET_COLUMN.acceptedSellPrice] ? Number(row[SHEET_COLUMN.acceptedSellPrice]) : null,
    poshmarkUrl: sanitizeCell(row[SHEET_COLUMN.poshmarkUrl]),
    status: (row[SHEET_COLUMN.status] as Item['status']) || 'pending_review',
    notes: row[SHEET_COLUMN.notes] ?? '',
    pricingReasoning: row[SHEET_COLUMN.pricingReasoning] ?? '',
    pricingConfidence: (row[SHEET_COLUMN.confidence] as Item['pricingConfidence']) || 'medium',
    lastUpdated: new Date().toISOString(),
  };
}

function needsRefresh(item: Item): boolean {
  const title = normalizeText(item.title);
  const description = normalizeText(item.description);

  return /\bfootwear\b/i.test(title)
    || STOCK_DESCRIPTIONS.has(description)
    || /visible in (?:the )?photos/i.test(description)
    || /little to no visible wear/i.test(description)
    || /pre-loved with visible wear/i.test(description);
}

async function main(): Promise<void> {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: ALL_ITEMS_DATA_RANGE,
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = response.data.values ?? [];
  const candidates = rows
    .filter((row) => row[SHEET_COLUMN.status] === 'posted' && row[SHEET_COLUMN.poshmarkUrl])
    .map(rowToItem)
    .filter(needsRefresh);

  const updated: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];

  console.log(`Refreshing ${candidates.length} posted listing(s)`);

  for (const item of candidates) {
    try {
      let nextTitle = /\bfootwear\b/i.test(item.title)
        ? generateListingTitle(item)
        : item.title;
      let nextDescription = generateListingDescription(item);


      // If title or description would come out empty, skip this item
      if (!nextTitle.trim() || !nextDescription.trim()) {
        console.warn(`Skipping ${item.id}: generated empty title or description (brand=${item.brand}, category=${item.category})`);
        continue;
      }

      item.title = nextTitle;
      item.description = nextDescription;
      item.lastUpdated = new Date().toISOString();

      await updateItem(sheets, spreadsheetId, item);
      await updateListing({
        listingIdOrUrl: item.poshmarkUrl!,
        title: item.title,
        description: item.description,
        brand: item.brand,
        condition: item.condition,
        price: item.currentPrice,
        originalPrice: item.initialPrice,
      });

      updated.push(item.id);
      console.log(`Updated ${item.id}: ${item.title}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failed.push({ id: item.id, reason });
      console.error(`Failed ${item.id}: ${reason}`);
    }
  }

  console.log(JSON.stringify({ updated, failed }, null, 2));
}

main()
  .then(async () => {
    await closeBrowser();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    await closeBrowser();
    process.exit(1);
  });
