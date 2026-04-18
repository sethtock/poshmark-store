import { loadEnv } from './lib/env.js';
import { ALL_ITEMS_DATA_RANGE, SHEET_COLUMN, getSheetsClient, getSpreadsheetId, refreshSummary, updateItem } from './lib/sheets.js';
import { createListing, closeBrowser } from './lib/poshmark.js';
import { getAuth, getDriveClient, listPhotosInFolder, getPhotoUrl, downloadAndConvertPhoto } from './lib/drive.js';
import { generateListingTitle } from './lib/listing-text.js';
import type { Item } from './types.js';

loadEnv();

async function getFirstReadyItem(): Promise<Item> {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: ALL_ITEMS_DATA_RANGE,
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = response.data.values ?? [];
  const row = rows.find((r) => r[SHEET_COLUMN.status] === 'ready_to_post');
  if (!row) throw new Error('No ready_to_post items found');

  const folderUrl = row[SHEET_COLUMN.driveFolder] ?? '';
  const folderIdMatch = folderUrl.match(/folders\/([a-zA-Z0-9_-]+)/);
  const folderId = folderIdMatch?.[1];
  if (!folderId) throw new Error(`Could not parse folder ID from ${folderUrl}`);

  const drive = await getDriveClient();
  const auth = await getAuth();
  const photos = await listPhotosInFolder(drive, folderId);
  const photoUrls = photos.map((p) => getPhotoUrl(p.id));
  const localPhotoPaths = await Promise.all(photos.map((photo) => downloadAndConvertPhoto(drive, photo, auth)));

  return {
    id: row[SHEET_COLUMN.itemId] ?? '',
    dateAdded: row[SHEET_COLUMN.dateAdded] ? new Date(`${row[SHEET_COLUMN.dateAdded]}T00:00:00.000Z`).toISOString() : new Date().toISOString(),
    folderName: row[SHEET_COLUMN.folderName] ?? '',
    folderId,
    title: row[SHEET_COLUMN.title] ?? '',
    description: row[SHEET_COLUMN.description] ?? '',
    brand: row[SHEET_COLUMN.brand] || null,
    size: row[SHEET_COLUMN.size] || null,
    condition: (row[SHEET_COLUMN.condition] as Item['condition']) || 'good',
    category: row[SHEET_COLUMN.category] || null,
    photoUrls,
    localPhotoPaths,
    initialPrice: row[SHEET_COLUMN.listPrice] ? Number(row[SHEET_COLUMN.listPrice]) : null,
    currentPrice: row[SHEET_COLUMN.currentPrice] ? Number(row[SHEET_COLUMN.currentPrice]) : null,
    acceptedSellPrice: row[SHEET_COLUMN.acceptedSellPrice] ? Number(row[SHEET_COLUMN.acceptedSellPrice]) : null,
    poshmarkUrl: row[SHEET_COLUMN.poshmarkUrl] || null,
    status: (row[SHEET_COLUMN.status] as Item['status']) || 'ready_to_post',
    pricingReasoning: row[SHEET_COLUMN.pricingReasoning] ?? '',
    pricingConfidence: (row[SHEET_COLUMN.confidence] as Item['pricingConfidence']) || 'medium',
    notes: row[SHEET_COLUMN.notes] ?? '',
    color: null,
    lastUpdated: new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  const item = await getFirstReadyItem();
  console.log(`Posting ${item.id} (${item.brand ?? 'Unknown'} / ${item.category ?? 'Unknown'})`);
  console.log(`Using ${item.photoUrls.length} photo(s)`);

  const listingUrl = await createListing({
    title: item.title || generateListingTitle(item),
    description: item.description,
    category: item.category ?? 'Kids',
    brand: item.brand,
    size: item.size,
    condition: item.condition,
    price: item.currentPrice ?? item.initialPrice ?? 0,
    photoUrls: item.localPhotoPaths.length ? item.localPhotoPaths : item.photoUrls,
  });

  console.log(`Posted: ${listingUrl}`);

  item.poshmarkUrl = listingUrl;
  item.status = 'posted';
  item.lastUpdated = new Date().toISOString();

  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  await updateItem(sheets, spreadsheetId, item);
  await refreshSummary(sheets, spreadsheetId);
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
