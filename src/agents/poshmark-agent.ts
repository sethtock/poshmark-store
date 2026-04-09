// Poshmark sub-agent — callable from main Seth agent

import { loadEnv } from '../lib/env.js';
import { getDriveClient, listFolders, folderToItem } from '../lib/drive.js';
import { getSheetsClient, getSpreadsheetId, readExistingIds, writeItem, updateItem, refreshSummary } from '../lib/sheets.js';
import { analyzeItemPhotos } from '../lib/vision.js';
import { analyzeItem } from '../lib/pricing.js';
import { createListing, closeBrowser } from '../lib/poshmark.js';
import { notifyPendingReview, notifyItemPosted, notifyError, notifyRunSummary } from '../lib/telegram.js';
import type { Item } from '../types.js';

loadEnv();

export async function run(): Promise<void> {
  const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID;
  if (!DRIVE_FOLDER_ID) throw new Error('DRIVE_FOLDER_ID not set');

  console.log('🚀 Starting Poshmark sub-agent run...');

  const [drive, sheets] = await Promise.all([getDriveClient(), getSheetsClient()]);
  const spreadsheetId = getSpreadsheetId();

  const existingIds = await readExistingIds(sheets, spreadsheetId);
  console.log(`Found ${existingIds.size} existing items in sheet`);

  const folders = await listFolders(drive, DRIVE_FOLDER_ID);
  console.log(`Found ${folders.length} folders in Drive`);

  const newFolders = folders.filter((f) => !existingIds.has(f.name));

  const results = {
    processed: 0,
    posted: 0,
    pendingReview: 0,
    sold: 0,
    errors: 0,
    errorsList: [] as string[],
  };

  for (const folder of newFolders) {
    console.log(`Processing folder: ${folder.name}`);
    results.processed++;

    try {
      const item = await folderToItem(drive, folder, existingIds);
      if (!item) continue;
      existingIds.add(item.id);

      await writeItem(sheets, spreadsheetId, item);

      if (item.photoUrls.length > 0) {
        const vision = await analyzeItemPhotos(item.photoUrls);
        item.brand = vision.brand;
        item.size = vision.size;
        item.color = vision.color;
        item.condition = vision.condition;
        item.category = vision.category;
        if (vision.rawDescription) item.notes = vision.rawDescription;
      }

      const analysis = await analyzeItem(item);
      item.description = analysis.item.description;
      item.initialPrice = analysis.pricing.price;
      item.currentPrice = analysis.pricing.price;

      if (analysis.needsReview) {
        item.status = 'pending_review';
        item.notes = (item.notes ? item.notes + ' | ' : '') + (analysis.reviewReason ?? 'Needs review');
        await updateItem(sheets, spreadsheetId, item);
        await notifyPendingReview(item, analysis.pricing, analysis.reviewReason ?? 'Needs review');
        results.pendingReview++;
        continue;
      }

      item.status = 'draft';
      await updateItem(sheets, spreadsheetId, item);

      try {
        const listingUrl = await createListing({
          title: buildTitle(item),
          description: item.description,
          category: item.category ?? 'Kids',
          brand: item.brand,
          size: item.size,
          condition: item.condition,
          price: item.currentPrice!,
          photoUrls: item.photoUrls,
        });

        item.poshmarkUrl = listingUrl;
        item.status = 'posted';
        item.lastUpdated = new Date().toISOString();
        await updateItem(sheets, spreadsheetId, item);
        await notifyItemPosted(item);
        results.posted++;
      } catch (postError) {
        const errorMsg = postError instanceof Error ? postError.message : String(postError);
        item.status = 'error';
        item.notes = `Post error: ${errorMsg}`;
        await updateItem(sheets, spreadsheetId, item);
        await notifyError(item.id, errorMsg);
        results.errors++;
        results.errorsList.push(`${item.id}: ${errorMsg}`);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      results.errors++;
      results.errorsList.push(`${folder.name}: ${errorMsg}`);
    }
  }

  try {
    await refreshSummary(sheets, spreadsheetId);
  } catch (e) {
    console.error('Error refreshing summary:', e);
  }

  await closeBrowser();
  await notifyRunSummary(results.processed, results.posted, results.pendingReview, results.sold, results.errors);

  console.log('✅ Run complete:', JSON.stringify(results, null, 2));
}

function buildTitle(item: Item): string {
  return [item.category, item.brand, item.size, item.color].filter(Boolean).join(' ') || `Kids Item ${item.id}`;
}
