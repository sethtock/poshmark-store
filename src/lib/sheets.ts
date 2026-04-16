// Google Sheets integration — read/write tracking spreadsheet

import { google, sheets_v4 } from 'googleapis';
import type { Item, ItemStatus } from '../types.js';
import type { JWTInput } from 'google-auth-library';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

async function getAuth() {
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyPath) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY not set');

  let keyContent: string;
  try {
    keyContent = JSON.parse(keyPath);
  } catch {
    const fs = await import('fs/promises');
    keyContent = await fs.readFile(keyPath, 'utf-8');
  }

  const credentials: JWTInput = JSON.parse(keyContent);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: SCOPES,
  });
  return auth;
}

export async function getSheetsClient(): Promise<sheets_v4.Sheets> {
  const auth = await getAuth();
  return google.sheets({ version: 'v4', auth });
}

export function getSpreadsheetId(): string {
  const id = process.env.SPREADSHEET_ID;
  if (!id) throw new Error('SPREADSHEET_ID not set');
  return id;
}

const HEADERS = [
  'Item ID', 'Date Added', 'Folder Name', 'Drive Folder', 'Title', 'Description', 'Brand', 'Size',
  'Condition', 'Category', 'Photo Links', 'Initial Price', 'Current Price',
  'Poshmark URL', 'Status', 'Pricing Reasoning', 'Confidence', 'Notes',
];
const HEADER_COUNT = 18; // A through R

const STATUS_COLORS: Record<ItemStatus, string> = {
  pending_review: '#FFF3CD',
  ready_to_post: '#E2E3E5',
  posted: '#CCE5FF',
  needs_shipped: '#FFD4A3',
  shipped: '#D1ECF1',
  sold: '#D4EDDA',
  error: '#F8D7DA',
};

/** Get the tab name → sheet ID mapping */
async function getSheetsMap(sheets: sheets_v4.Sheets, spreadsheetId: string): Promise<Record<string, number>> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, includeGridData: false });
  const sheetsMap: Record<string, number> = {};
  for (const s of meta.data.sheets ?? []) {
    if (s.properties?.sheetId != null && s.properties?.title) {
      sheetsMap[s.properties.title] = s.properties.sheetId;
    }
  }
  return sheetsMap;
}

/**
 * Create the spreadsheet with all tabs and headers.
 * Call this once to set up the tracker.
 */
export async function createSpreadsheet(sheets: sheets_v4.Sheets, title: string) {
  const spreadsheet = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title },
      sheets: [
        { properties: { title: 'All Items', sheetType: 'GRID', gridProperties: { rowCount: 1000, columnCount: 18 } } },
        { properties: { title: 'Summary', sheetType: 'GRID', gridProperties: { rowCount: 50, columnCount: 6 } } },
      ],
    },
    fields: 'spreadsheetId, sheets.properties',
  });

  const spreadsheetId = spreadsheet.data.spreadsheetId!;
  const allItemsSheet = spreadsheet.data.sheets?.[0];
  const summarySheet = spreadsheet.data.sheets?.[1];

  // Write headers to All Items
  if (allItemsSheet?.properties?.sheetId != null) {
    const sheetId = allItemsSheet.properties.sheetId;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'All Items!A1:R1',
      valueInputOption: 'RAW',
      requestBody: { values: [HEADERS] },
    });
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
              cell: { userEnteredFormat: { backgroundColor: { red: 0.2, green: 0.2, blue: 0.2 }, textFormat: { bold: true } } },
              fields: 'userEnteredFormat(backgroundColor,textFormat)',
            },
          },
          { autoResizeDimensions: { dimensions: { sheetId, dimension: 'COLUMNS' } } },
        ],
      },
    });
  }

  // Write Summary headers
  if (summarySheet?.properties?.sheetId != null) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Summary!A1:F1',
      valueInputOption: 'RAW',
      requestBody: { values: [['Metric', 'Value']] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Summary!A2',
      valueInputOption: 'RAW',
      requestBody: { values: [['Total Items Processed'], [0]] },
    });
  }

  return spreadsheetId;
}

/** Read all existing Item IDs from the sheet */
export async function readExistingIds(sheets: sheets_v4.Sheets, spreadsheetId: string): Promise<Set<string>> {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'All Items!A2:A',
    valueRenderOption: 'FORMATTED_VALUE',
  });
  const ids = (response.data.values ?? []).flat();
  return new Set(ids.filter(Boolean));
}

/**
 * Read processed folder IDs from the sheet to avoid reprocessing.
 * Maps folder ID → item ID for quick lookup.
 */
export async function readProcessedFolderIds(sheets: sheets_v4.Sheets, spreadsheetId: string): Promise<Set<string>> {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'All Items!B2:B',
    valueRenderOption: 'FORMATTED_VALUE',
  });
  // Column B is "Date Added" — we actually need folder IDs tracked differently.
  // Since folder IDs aren't in the sheet yet, we'll track via a Drive folder URL column.
  // For now, read column C (Folder Name) - but we really need folder ID.
  // Return empty set; agent will use its own processedFolderIds tracking.
  return new Set<string>();
}

/**
 * Get a map of folder ID → item ID for processed folders.
 * Reads the Drive Folder column (D) which contains URLs with folder IDs.
 */
export async function getFolderIdToItemIdMap(sheets: sheets_v4.Sheets, spreadsheetId: string): Promise<Map<string, string>> {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'All Items!A:D',
    valueRenderOption: 'FORMATTED_VALUE',
  });
  const rows = response.data.values ?? [];
  const map = new Map<string, string>();
  for (const row of rows) {
    const itemId = row[0]; // Column A: Item ID
    const driveFolderUrl = row[3]; // Column D: Drive Folder URL
    if (itemId && driveFolderUrl) {
      // Extract folder ID from URL like https://drive.google.com/drive/folders/XXX
      const match = driveFolderUrl.match(/folders\/([a-zA-Z0-9_-]+)/);
      if (match) {
        map.set(match[1], itemId);
      }
    }
  }
  return map;
}

/** Write a new item row to the All Items tab */
export async function writeItem(sheets: sheets_v4.Sheets, spreadsheetId: string, item: Item) {
  const driveFolderUrl = `https://drive.google.com/drive/folders/${item.folderId}`;
  const row = [
    item.id,
    item.dateAdded.split('T')[0],
    item.folderName,
    driveFolderUrl,
    item.title,
    item.description,
    item.brand ?? '',
    item.size ?? '',
    item.condition,
    item.category ?? '',
    item.photoUrls.join('\n'),
    item.initialPrice ?? '',
    item.currentPrice ?? '',
    item.poshmarkUrl ?? '',
    item.status,
    item.pricingReasoning ?? '',
    item.pricingConfidence ?? '',
    item.notes,
  ];

  const response = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'All Items!A:R',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
  return response.data;
}

/** Update an existing item row by Item ID */
export async function updateItem(sheets: sheets_v4.Sheets, spreadsheetId: string, item: Item) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'All Items!A:A',
    valueRenderOption: 'FORMATTED_VALUE',
  });
  const rows = response.data.values ?? [];
  const rowIndex = rows.findIndex((r) => r[0] === item.id);
  if (rowIndex === -1) throw new Error(`Item ${item.id} not found in sheet`);

  const actualRow = rowIndex + 1; // A:A includes the header row at A1

  const driveFolderUrl = `https://drive.google.com/drive/folders/${item.folderId}`;
  const row = [
    item.id,
    item.dateAdded.split('T')[0],
    item.folderName,
    driveFolderUrl,
    item.title,
    item.description,
    item.brand ?? '',
    item.size ?? '',
    item.condition,
    item.category ?? '',
    item.photoUrls.join('\n'),
    item.initialPrice ?? '',
    item.currentPrice ?? '',
    item.poshmarkUrl ?? '',
    item.status,
    item.pricingReasoning ?? '',
    item.pricingConfidence ?? '',
    item.notes,
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `All Items!A${actualRow}:R${actualRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: [row] },
  });

  // Color-code the status cell (column N = index 13)
  const sheetsMap = await getSheetsMap(sheets, spreadsheetId);
  const allItemsSheetId = sheetsMap['All Items'];
  if (allItemsSheetId != null) {
    const rgb = hexToRgb(STATUS_COLORS[item.status] ?? '#FFFFFF');
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: { sheetId: allItemsSheetId, startRowIndex: actualRow - 1, endRowIndex: actualRow, startColumnIndex: 14, endColumnIndex: 15 },
              cell: { userEnteredFormat: { backgroundColor: rgb } },
              fields: 'userEnteredFormat(backgroundColor)',
            },
          },
        ],
      },
    });
  }
}

function hexToRgb(hex: string): { red: number; green: number; blue: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return { red: r, green: g, blue: b };
}

/** Refresh the Summary tab */
export async function refreshSummary(sheets: sheets_v4.Sheets, spreadsheetId: string) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'All Items!A2:R',
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = response.data.values ?? [];
  const allItems = rows.map((r) => ({
    status: r[14] as ItemStatus,
    price: parseFloat(r[12]) || 0,
    initialPrice: parseFloat(r[11]) || 0,
  }));

  const total = allItems.length;
  const byStatus = allItems.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  const totalListed = allItems.filter((r) => ['posted', 'needs_shipped', 'shipped', 'sold'].includes(r.status)).reduce((s, r) => s + r.initialPrice, 0);
  const totalSold = allItems.filter((r) => r.status === 'sold').reduce((s, r) => s + r.price, 0);
  const soldItems = allItems.filter((r) => r.status === 'sold');
  const avgSellPrice = soldItems.length > 0 ? soldItems.reduce((s, r) => s + r.price, 0) / soldItems.length : NaN;

  const summaryRows = [
    ['Metric', 'Value'],
    ['Total Items Processed', total],
    ['Items Ready to Post', byStatus['ready_to_post'] ?? 0],
    ['Items Pending Review', byStatus['pending_review'] ?? 0],
    ['Items Posted', byStatus['posted'] ?? 0],
    ['Items Sold', byStatus['sold'] ?? 0],
    ['Items Needs Shipped', byStatus['needs_shipped'] ?? 0],
    ['Items Shipped', byStatus['shipped'] ?? 0],
    ['Items with Errors', byStatus['error'] ?? 0],
    ['Total Listed Value', `$${totalListed.toFixed(2)}`],
    ['Total Sold Value', `$${totalSold.toFixed(2)}`],
    ['Avg Sell Price', isNaN(avgSellPrice) ? '—' : `$${avgSellPrice.toFixed(2)}`],
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Summary!A1:B12',
    valueInputOption: 'RAW',
    requestBody: { values: summaryRows },
  });
}
