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
  'Item ID', 'Date Added', 'Folder Name', 'Description', 'Brand', 'Size',
  'Condition', 'Category', 'Photo Links', 'Initial Price', 'Current Price',
  'Poshmark URL', 'Status', 'Notes',
];

const STATUS_COLORS: Record<ItemStatus, string> = {
  pending_review: '#FFF3CD',
  draft: '#E2E3E5',
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
        { properties: { title: 'All Items', sheetType: 'GRID', gridProperties: { rowCount: 1000, columnCount: 14 } } },
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
      range: 'All Items!A1:N1',
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

/** Write a new item row to the All Items tab */
export async function writeItem(sheets: sheets_v4.Sheets, spreadsheetId: string, item: Item) {
  const row = [
    item.id,
    item.dateAdded.split('T')[0],
    item.folderName,
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
    item.notes,
  ];

  const response = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'All Items!A:N',
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

  const actualRow = rowIndex + 2; // 1-indexed + header row

  const row = [
    item.id,
    item.dateAdded.split('T')[0],
    item.folderName,
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
    item.notes,
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `All Items!A${actualRow}:N${actualRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: [row] },
  });

  // Color-code the status cell (column M = index 12)
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
              range: { sheetId: allItemsSheetId, startRowIndex: actualRow - 1, endRowIndex: actualRow, startColumnIndex: 12, endColumnIndex: 13 },
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
    range: 'All Items!A2:M',
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = response.data.values ?? [];
  const allItems = rows.map((r) => ({
    status: r[12] as ItemStatus,
    price: parseFloat(r[10]) || 0,
    initialPrice: parseFloat(r[9]) || 0,
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
    ['Items Posted', byStatus['posted'] ?? 0],
    ['Items Pending Review', byStatus['pending_review'] ?? 0],
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
    range: 'Summary!A1:B11',
    valueInputOption: 'RAW',
    requestBody: { values: summaryRows },
  });
}
