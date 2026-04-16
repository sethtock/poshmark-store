import { loadEnv } from './lib/env.js';
import { getSheetsClient, getSpreadsheetId, refreshSummary, updateItem } from './lib/sheets.js';
import { createListing, closeBrowser } from './lib/poshmark.js';
import { getAuth, getDriveClient, listPhotosInFolder, getPhotoUrl, downloadAndConvertPhoto } from './lib/drive.js';
import type { Item } from './types.js';

loadEnv();

function buildTitle(item: Item): string {
  const category = item.category?.replace(/^Girls\s+/i, '').replace(/^Boys\s+/i, '').trim() ?? 'Kids Item';
  const pieces = [item.brand, category, item.size, item.color].filter(Boolean);
  return pieces.join(' ').slice(0, 80) || item.id;
}

async function getFirstReadyItem(): Promise<Item> {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'All Items!A2:Q',
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = response.data.values ?? [];
  const row = rows.find((r) => r[13] === 'ready_to_post');
  if (!row) throw new Error('No ready_to_post items found');

  const folderUrl = row[3] ?? '';
  const folderIdMatch = folderUrl.match(/folders\/([a-zA-Z0-9_-]+)/);
  const folderId = folderIdMatch?.[1];
  if (!folderId) throw new Error(`Could not parse folder ID from ${folderUrl}`);

  const drive = await getDriveClient();
  const auth = await getAuth();
  const photos = await listPhotosInFolder(drive, folderId);
  const photoUrls = photos.map((p) => getPhotoUrl(p.id));
  const localPhotoPaths = await Promise.all(photos.map((photo) => downloadAndConvertPhoto(drive, photo, auth)));

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
    localPhotoPaths,
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
  console.log(`Posting ${item.id} (${item.brand ?? 'Unknown'} / ${item.category ?? 'Unknown'})`);
  console.log(`Using ${item.photoUrls.length} photo(s)`);

  const listingUrl = await createListing({
    title: buildTitle(item),
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
