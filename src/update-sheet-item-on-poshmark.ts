import { loadEnv } from './lib/env.js';
import { ALL_ITEMS_DATA_RANGE, SHEET_COLUMN, getSheetsClient, getSpreadsheetId, updateItem } from './lib/sheets.js';
import { closeBrowser, updateListing } from './lib/poshmark.js';
import type { Item } from './types.js';

loadEnv();

function sanitizeCell(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^(null|n\/a|na|none|unknown)$/i.test(trimmed)) return null;
  return trimmed;
}

async function getItemById(itemId: string): Promise<Item> {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: ALL_ITEMS_DATA_RANGE,
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = response.data.values ?? [];
  const row = rows.find((r) => r[SHEET_COLUMN.itemId] === itemId);
  if (!row) throw new Error(`Item ${itemId} not found in sheet`);

  const folderUrl = row[SHEET_COLUMN.driveFolder] ?? '';
  const folderId = folderUrl.match(/folders\/([a-zA-Z0-9_-]+)/)?.[1] ?? '';

  return {
    id: row[SHEET_COLUMN.itemId] ?? '',
    dateAdded: row[SHEET_COLUMN.dateAdded] ? new Date(`${row[SHEET_COLUMN.dateAdded]}T00:00:00.000Z`).toISOString() : new Date().toISOString(),
    folderName: row[SHEET_COLUMN.folderName] ?? '',
    folderId,
    photoUrls: [],
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

async function main(): Promise<void> {
  const itemId = process.argv[2];
  if (!itemId) throw new Error('Usage: tsx src/update-sheet-item-on-poshmark.ts <item-id>');

  const item = await getItemById(itemId);
  if (!item.poshmarkUrl) throw new Error(`${itemId} has no Poshmark URL in the sheet`);

  await updateListing({
    listingIdOrUrl: item.poshmarkUrl,
    title: item.title,
    description: item.description,
    category: item.category,
    brand: item.brand,
    size: item.size,
    condition: item.condition,
    price: item.currentPrice,
    originalPrice: item.initialPrice,
  });

  item.lastUpdated = new Date().toISOString();

  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  await updateItem(sheets, spreadsheetId, item);
  console.log(`Updated ${item.id} on Poshmark`);
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
