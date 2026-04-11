// Google Drive integration — scan folders, list photos, share links

import { google, drive_v3 } from 'googleapis';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import axios from 'axios';
import type { Item } from '../types.js';
import type { JWTInput } from 'google-auth-library';

const SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];

export async function getAuth() {
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

export interface PhotoInfo {
  id: string;
  name: string;
  thumbnailLink: string;
  mimeType: string;
}

/**
 * List all photo files (image/*) inside a folder, sorted by name.
 * Returns full photo metadata including thumbnailLink for image conversion.
 */
export async function listPhotosInFolder(drive: drive_v3.Drive, folderId: string): Promise<PhotoInfo[]> {
  const response = await drive.files.list({
    q: `'${folderId}' in parents and mimeType contains 'image/' and trashed=false`,
    fields: 'files(id, name, mimeType, thumbnailLink)',
    orderBy: 'name asc',
  });
  return (response.data.files ?? []).map((f) => ({
    id: f.id!,
    name: f.name!,
    thumbnailLink: f.thumbnailLink!,
    mimeType: f.mimeType!,
  }));
}

/**
 * Get a public-facing download URL for a file (for passing to Playwright / vision APIs).
 */
export function getPhotoUrl(fileId: string): string {
  return `https://drive.google.com/uc?export=view&id=${fileId}`;
}

/**
 * Download a photo from Drive and convert to JPEG if needed.
 * Uses Drive's thumbnail CDN which automatically converts HEIC/HEIF → JPEG.
 * Returns the local path to the JPEG file.
 */
export async function downloadAndConvertPhoto(
  drive: drive_v3.Drive,
  photo: PhotoInfo,
  auth: InstanceType<typeof google.auth.GoogleAuth>,
): Promise<string> {
  // Ensure temp dir exists
  const poshmarkTmpDir = join(tmpdir(), 'poshmark-photos');
  await mkdir(poshmarkTmpDir, { recursive: true });

  const localPath = join(poshmarkTmpDir, `photo-${photo.id}.jpg`);

  // Drive's thumbnail CDN automatically converts any image format (including HEIC)
  // to JPEG. Strip the size suffix (=s\d+$) to get the full-resolution version.
  const thumbnailUrl = photo.thumbnailLink.replace(/=s\d+$/, '');

  const client = await auth.getClient();
  const tokenResult = await client.getAccessToken();
  const token = typeof tokenResult === 'string' ? tokenResult : tokenResult?.token;

  if (!token) {
    throw new Error(`No access token available for photo ${photo.id}`);
  }

  const response = await axios.get(thumbnailUrl, {
    responseType: 'arraybuffer',
    headers: { Authorization: `Bearer ${token}` },
    timeout: 30000,
  });

  const buffer = Buffer.from(response.data);

  // Verify it's actually a JPEG
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error(`Drive returned non-JPEG for photo ${photo.id}: ${buffer.slice(0, 8).toString('hex')}`);
  }

  await writeFile(localPath, buffer);
  return localPath;
}

/**
 * Clean up temp photo files (call after processing is done).
 */
export async function cleanupTempPhotos(): Promise<void> {
  try {
    const poshmarkTmpDir = join(tmpdir(), 'poshmark-photos');
    const fs = await import('fs/promises');
    const files = await fs.readdir(poshmarkTmpDir);
    await Promise.all(files.map((f) => unlink(join(poshmarkTmpDir, f))));
    console.log(`Cleaned up ${files.length} temp photo files`);
  } catch {
    // Directory doesn't exist or is empty — nothing to clean
  }
}

/**
 * Build an Item object from a Drive folder.
 * Uses Drive's thumbnail CDN for HEIC → JPEG conversion.
 */
export async function folderToItem(
  drive: drive_v3.Drive,
  auth: InstanceType<typeof google.auth.GoogleAuth>,
  folder: DriveFolder,
  existingIds: Set<string>,
): Promise<Item | null> {
  const photos = await listPhotosInFolder(drive, folder.id);

  // Generate next sequential ID
  let counter = 1;
  let id = `item-${String(counter).padStart(3, '0')}`;
  while (existingIds.has(id)) {
    counter++;
    id = `item-${String(counter).padStart(3, '0')}`;
  }

  // Store Drive URLs for Sheet links
  const photoUrls = photos.map((p) => getPhotoUrl(p.id));

  // Download photos via thumbnail CDN (converts HEIC/HEIF → JPEG automatically)
  const localPhotoPaths: string[] = [];
  for (const photo of photos) {
    try {
      const localPath = await downloadAndConvertPhoto(drive, photo, auth);
      localPhotoPaths.push(localPath);
      console.log(`  Downloaded: ${photo.name} -> ${localPath}`);
    } catch (err) {
      console.error(`  Failed to download ${photo.name}:`, err);
    }
  }

  return {
    id,
    folderName: folder.name,
    folderId: folder.id,
    photoUrls,
    localPhotoPaths,
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
