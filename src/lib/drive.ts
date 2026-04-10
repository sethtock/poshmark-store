// Google Drive integration — scan folders, list photos, share links

import { google, drive_v3 } from 'googleapis';
import type { Item } from '../types.js';
import type { JWTInput } from 'google-auth-library';

const SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];

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

export async function getDriveClient() {
  const auth = await getAuth();
  return google.drive({ version: 'v3', auth });
}

export interface DriveFolder {
  id: string;
  name: string;
}

/**
 * List folders inside a Drive folder (non-trashed).
 */
export async function listFolders(drive: drive_v3.Drive, parentId: string): Promise<DriveFolder[]> {
  const response = await drive.files.list({
    q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
    orderBy: 'createdTime asc',
  });
  return (response.data.files ?? []) as DriveFolder[];
}

/**
 * List all photo files (image/*) inside a folder, sorted by name.
 */
export async function listPhotosInFolder(drive: drive_v3.Drive, folderId: string): Promise<string[]> {
  const response = await drive.files.list({
    q: `'${folderId}' in parents and mimeType contains 'image/' and trashed=false`,
    fields: 'files(id, name)',
    orderBy: 'name asc',
  });
  return (response.data.files ?? []).map((f) => f.id!);
}

/**
 * Get a public-facing download URL for a file (for passing to Playwright / vision APIs).
 */
export function getPhotoUrl(fileId: string): string {
  return `https://drive.google.com/uc?export=view&id=${fileId}`;
}

/**
 * Build an Item object from a Drive folder.
 */
export async function folderToItem(
  drive: drive_v3.Drive,
  folder: DriveFolder,
  existingIds: Set<string>,
): Promise<Item | null> {
  const photoIds = await listPhotosInFolder(drive, folder.id);

  // Generate next sequential ID
  let counter = 1;
  let id = `item-${String(counter).padStart(3, '0')}`;
  while (existingIds.has(id)) {
    counter++;
    id = `item-${String(counter).padStart(3, '0')}`;
  }

  const photoUrls = photoIds.map(getPhotoUrl);

  return {
    id,
    folderName: folder.name,
    folderId: folder.id,
    photoUrls,
    description: '',
    brand: null,
    size: null,
    color: null,
    condition: 'good',
    category: null,
    initialPrice: null,
    currentPrice: null,
    poshmarkUrl: null,
    status: 'pending_review',
    notes: '',
    pricingReasoning: '',
    pricingConfidence: 'low',
    dateAdded: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };
}
