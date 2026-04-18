import { loadEnv } from './lib/env.js';
import { ALL_ITEMS_DATA_RANGE, SHEET_COLUMN, getSheetsClient, getSpreadsheetId, refreshSummary, updateItem } from './lib/sheets.js';
import { createListing, closeBrowser } from './lib/poshmark.js';
import { getAuth, getDriveClient, listPhotosInFolder, getPhotoUrl, downloadAndConvertPhoto } from './lib/drive.js';
import { getListingTitle } from './lib/listing-text.js';
import type { Item } from './types.js';

loadEnv();

function sanitizeCell(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^(null|n\/a|na|none|unknown)$/i.test(trimmed)) return null;
  return trimmed;
}

function rowToDate(value: string | null | undefined): string {
  return value ? new Date(`${value}T00:00:00.000Z`).toISOString() : new Date().toISOString();
}

async function getReadyItems(): Promise<Item[]> {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: ALL_ITEMS_DATA_RANGE,
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = response.data.values ?? [];
  const readyRows = rows.filter((row) => row[SHEET_COLUMN.status] === 'ready_to_post');
  const drive = await getDriveClient();
  const auth = await getAuth();

  const items: Item[] = [];
  for (const row of readyRows) {
    const folderUrl = row[SHEET_COLUMN.driveFolder] ?? '';
    const folderIdMatch = folderUrl.match(/folders\/([a-zA-Z0-9_-]+)/);
    const folderId = folderIdMatch?.[1];
    if (!folderId) {
      console.warn(`Skipping ${row[0] ?? 'unknown'}: could not parse folder ID`);
      continue;
    }

    const photos = await listPhotosInFolder(drive, folderId);
    const photoUrls = photos.map((photo) => getPhotoUrl(photo.id));
    const localPhotoPaths = await Promise.all(photos.map((photo) => downloadAndConvertPhoto(drive, photo, auth)));

    items.push({
      id: row[SHEET_COLUMN.itemId] ?? '',
      dateAdded: rowToDate(row[SHEET_COLUMN.dateAdded]),
      folderName: row[SHEET_COLUMN.folderName] ?? '',
      folderId,
      title: row[SHEET_COLUMN.title] ?? '',
      description: row[SHEET_COLUMN.description] ?? '',
      brand: sanitizeCell(row[SHEET_COLUMN.brand]),
      size: sanitizeCell(row[SHEET_COLUMN.size]),
      condition: (row[SHEET_COLUMN.condition] as Item['condition']) || 'good',
      category: sanitizeCell(row[SHEET_COLUMN.category]),
      photoUrls,
      localPhotoPaths,
      initialPrice: row[SHEET_COLUMN.listPrice] ? Number(row[SHEET_COLUMN.listPrice]) : null,
      currentPrice: row[SHEET_COLUMN.currentPrice] ? Number(row[SHEET_COLUMN.currentPrice]) : null,
      acceptedSellPrice: row[SHEET_COLUMN.acceptedSellPrice] ? Number(row[SHEET_COLUMN.acceptedSellPrice]) : null,
      poshmarkUrl: sanitizeCell(row[SHEET_COLUMN.poshmarkUrl]),
      status: (row[SHEET_COLUMN.status] as Item['status']) || 'ready_to_post',
      pricingReasoning: row[SHEET_COLUMN.pricingReasoning] ?? '',
      pricingConfidence: (row[SHEET_COLUMN.confidence] as Item['pricingConfidence']) || 'medium',
      notes: row[SHEET_COLUMN.notes] ?? '',
      color: null,
      lastUpdated: new Date().toISOString(),
    });
  }

  return items;
}

function validateForPosting(item: Item): string | null {
  if (!item.id) return 'missing item id';
  if (!item.description?.trim()) return 'missing description';
  if (!item.photoUrls.length) return 'missing photos';
  if ((item.currentPrice ?? item.initialPrice ?? 0) <= 0) return 'missing price';
  if (!item.size) return 'missing size';
  return null;
}

async function main(): Promise<void> {
  const items = await getReadyItems();
  console.log(`Found ${items.length} ready_to_post item(s)`);

  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const posted: Array<{ id: string; url: string }> = [];
  const blocked: Array<{ id: string; reason: string }> = [];
  const failed: Array<{ id: string; reason: string }> = [];

  for (const item of items) {
    const validationError = validateForPosting(item);
    if (validationError) {
      blocked.push({ id: item.id, reason: validationError });
      console.log(`Blocked ${item.id}: ${validationError}`);
      continue;
    }

    try {
      const title = getListingTitle(item);
      console.log(`Posting ${item.id}: ${title}`);
      const listingUrl = await createListing({
        title,
        description: item.description,
        category: item.category ?? 'Kids',
        brand: item.brand,
        size: item.size,
        condition: item.condition,
        price: item.currentPrice ?? item.initialPrice ?? 0,
        photoUrls: item.localPhotoPaths.length ? item.localPhotoPaths : item.photoUrls,
      });

      item.title = title;
      item.poshmarkUrl = listingUrl;
      item.status = 'posted';
      item.lastUpdated = new Date().toISOString();
      await updateItem(sheets, spreadsheetId, item);
      posted.push({ id: item.id, url: listingUrl });
      console.log(`Posted ${item.id}: ${listingUrl}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failed.push({ id: item.id, reason });
      console.error(`Failed ${item.id}: ${reason}`);
    }
  }

  await refreshSummary(sheets, spreadsheetId);
  console.log(JSON.stringify({ posted, blocked, failed }, null, 2));
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
