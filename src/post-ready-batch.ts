import { loadEnv } from './lib/env.js';
import { getSheetsClient, getSpreadsheetId, refreshSummary, updateItem } from './lib/sheets.js';
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
    range: 'All Items!A2:R',
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = response.data.values ?? [];
  const readyRows = rows.filter((row) => row[14] === 'ready_to_post');
  const drive = await getDriveClient();
  const auth = await getAuth();

  const items: Item[] = [];
  for (const row of readyRows) {
    const folderUrl = row[3] ?? '';
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
      id: row[0] ?? '',
      dateAdded: rowToDate(row[1]),
      folderName: row[2] ?? '',
      folderId,
      title: row[4] ?? '',
      description: row[5] ?? '',
      brand: sanitizeCell(row[6]),
      size: sanitizeCell(row[7]),
      condition: (row[8] as Item['condition']) || 'good',
      category: sanitizeCell(row[9]),
      photoUrls,
      localPhotoPaths,
      initialPrice: row[11] ? Number(row[11]) : null,
      currentPrice: row[12] ? Number(row[12]) : null,
      poshmarkUrl: sanitizeCell(row[13]),
      status: (row[14] as Item['status']) || 'ready_to_post',
      pricingReasoning: row[15] ?? '',
      pricingConfidence: (row[16] as Item['pricingConfidence']) || 'medium',
      notes: row[17] ?? '',
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
