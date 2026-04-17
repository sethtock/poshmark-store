// Poshmark sub-agent — callable from main Seth agent

import { loadEnv } from '../lib/env.js';
import { getDriveClient, listFolders, folderToItem, cleanupTempPhotos, getAuth } from '../lib/drive.js';
import { getSheetsClient, getSpreadsheetId, readExistingIds, writeItem, updateItem, refreshSummary, getFolderIdToItemIdMap } from '../lib/sheets.js';
import { analyzeItemPhotos } from '../lib/vision.js';
import { analyzeItem } from '../lib/pricing.js';
import { createListing, closeBrowser } from '../lib/poshmark.js';
import { generateListingTitle } from '../lib/listing-text.js';
import { notifyPendingReview, notifyItemPosted, notifyReadyToPost, notifyError, notifyRunSummary } from '../lib/telegram.js';
import type { Item } from '../types.js';

loadEnv();

function normalizeNullableText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^(null|n\/a|na|none|unknown)$/i.test(trimmed)) return null;
  return trimmed;
}

export async function run(): Promise<void> {
  const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID;
  if (!DRIVE_FOLDER_ID) throw new Error('DRIVE_FOLDER_ID not set');

  console.log('🚀 Starting Poshmark sub-agent run...');

  const [drive, sheets, auth] = await Promise.all([getDriveClient(), getSheetsClient(), getAuth()]);
  const spreadsheetId = getSpreadsheetId();

  const existingIds = await readExistingIds(sheets, spreadsheetId);
  console.log(`Found ${existingIds.size} existing items in sheet`);

  // Read processed folder IDs from sheet to avoid reprocessing
  const folderIdToItemId = await getFolderIdToItemIdMap(sheets, spreadsheetId);
  const processedFolderIds = new Set(folderIdToItemId.keys());
  console.log(`Found ${processedFolderIds.size} processed folder IDs`);

  const folders = await listFolders(drive, DRIVE_FOLDER_ID);
  console.log(`Found ${folders.length} folders in Drive`);

  // Filter out already-processed folders (by folder ID, not name)
  const newFolders = folders.filter((f) => !processedFolderIds.has(f.id));

  const results = {
    processed: 0,
    posted: 0,
    pendingReview: 0,
    readyToPost: 0,
    sold: 0,
    errors: 0,
    errorsList: [] as string[],
  };

  for (const folder of newFolders) {
    console.log(`Processing folder: ${folder.name}`);
    results.processed++;

    try {
      const item = await folderToItem(drive, auth, folder, existingIds);
      if (!item) continue;
      existingIds.add(item.id);

      await writeItem(sheets, spreadsheetId, item);

      // Use localPhotoPaths (converted to JPEG) for vision analysis
      const photosToAnalyze = item.localPhotoPaths.length > 0 ? item.localPhotoPaths : item.photoUrls;
      if (photosToAnalyze.length > 0) {
        const vision = await analyzeItemPhotos(photosToAnalyze);
        item.brand = normalizeNullableText(vision.brand);
        item.size = normalizeNullableText(vision.size);
        item.color = normalizeNullableText(vision.color);
        item.condition = vision.condition;
        item.category = normalizeNullableText(vision.category);
        if (vision.rawDescription) item.notes = vision.rawDescription;
      }

      const analysis = await analyzeItem(item);
      item.title = generateListingTitle(item);
      item.description = analysis.item.description;
      item.initialPrice = analysis.pricing.price;
      item.currentPrice = analysis.pricing.price;

      // Store pricing details in the item
      item.pricingReasoning = analysis.pricing.reasoning;
      item.pricingConfidence = analysis.pricing.confidence;

      if (analysis.needsReview) {
        item.status = 'pending_review';
        item.notes = (item.notes ? item.notes + ' | ' : '') + (analysis.reviewReason ?? 'Needs review');
        item.lastUpdated = new Date().toISOString();
        await updateItem(sheets, spreadsheetId, item);
        await notifyPendingReview(item, analysis.pricing, analysis.reviewReason ?? 'Needs review');
        results.pendingReview++;
        continue;
      }

      // Only postable items go to ready_to_post. Missing brand/size or other uncertain items stay pending_review.
      item.status = 'ready_to_post';
      item.lastUpdated = new Date().toISOString();
      await updateItem(sheets, spreadsheetId, item);
      await notifyReadyToPost(item, analysis.pricing);
      results.readyToPost++;
      continue;
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
  await cleanupTempPhotos();
  await notifyRunSummary(results.processed, results.posted, results.pendingReview, results.readyToPost, results.sold, results.errors);

  console.log('✅ Run complete:', JSON.stringify(results, null, 2));
}
