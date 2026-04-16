import type { Browser, BrowserContext, Page } from 'playwright';
import { access, mkdir } from 'fs/promises';
import { dirname } from 'path';

const STORAGE_STATE_PATH = new URL('../../data/poshmark-storage-state.json', import.meta.url).pathname;

async function ensureSessionDir(): Promise<void> {
  await mkdir(dirname(STORAGE_STATE_PATH), { recursive: true });
}

export function getStorageStatePath(): string {
  return STORAGE_STATE_PATH;
}

export async function createPoshmarkContext(browser: Browser, options?: { fresh?: boolean }): Promise<BrowserContext> {
  await ensureSessionDir();

  const fresh = options?.fresh ?? false;
  const hasStorageState = fresh
    ? false
    : await access(STORAGE_STATE_PATH).then(() => true).catch(() => false);

  return browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
    ...(hasStorageState ? { storageState: STORAGE_STATE_PATH } : {}),
  });
}

export async function savePoshmarkSession(context: BrowserContext): Promise<void> {
  await ensureSessionDir();
  await context.storageState({ path: STORAGE_STATE_PATH });
}

export async function pageLooksLoggedIn(page: Page): Promise<boolean> {
  const url = page.url();
  if (url.includes('/login')) return false;

  const authState = await page.evaluate(() => {
    const current = globalThis as { __INITIAL_STATE__?: { auth?: { isUserLoggedIn?: boolean } } };
    return Boolean(current.__INITIAL_STATE__?.auth?.isUserLoggedIn);
  }).catch(() => false);

  return authState;
}
