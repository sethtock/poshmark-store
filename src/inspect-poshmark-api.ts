import { appendFile, mkdir, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import type { Page, Request, Response } from 'playwright';
import { loadEnv } from './lib/env.js';
import { getBrowser } from './lib/poshmark.js';
import { PoshmarkApiClient } from './lib/poshmark-api.js';
import { createPoshmarkContext, getStorageStatePath, pageLooksLoggedIn, savePoshmarkSession } from './lib/poshmark-session.js';

loadEnv();

const CAPTURE_PATH = new URL('../data/poshmark-api-capture.jsonl', import.meta.url).pathname;

function redact(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/("password"\s*:\s*")([^"]+)(")/gi, '$1<redacted>$3')
    .replace(/(login_form\[password\]=)([^&]+)/gi, '$1<redacted>')
    .replace(/("verification_code"\s*:\s*")([^"]+)(")/gi, '$1<redacted>$3')
    .replace(/("otp"\s*:\s*")([^"]+)(")/gi, '$1<redacted>$3');
}

async function appendCapture(entry: unknown): Promise<void> {
  await mkdir(dirname(CAPTURE_PATH), { recursive: true });
  await appendFile(CAPTURE_PATH, `${JSON.stringify(entry)}\n`);
}

function shouldCapture(url: string): boolean {
  return url.includes('poshmark.com') && (
    url.includes('/login') ||
    url.includes('/modal/listing/create') ||
    url.includes('/posts') ||
    url.includes('/users/') ||
    url.includes('/post_attributes/')
  );
}

async function wireCapture(page: Page): Promise<void> {
  page.on('request', async (request: Request) => {
    const url = request.url();
    if (!shouldCapture(url)) return;
    await appendCapture({
      ts: new Date().toISOString(),
      kind: 'request',
      method: request.method(),
      resourceType: request.resourceType(),
      url,
      postData: redact(request.postData()),
    });
  });

  page.on('response', async (response: Response) => {
    const url = response.url();
    if (!shouldCapture(url)) return;
    const headers = response.headers();
    const contentType = headers['content-type'] ?? '';
    let body = '';
    if (contentType.includes('application/json') || contentType.includes('text/')) {
      body = redact((await response.text().catch(() => '')).slice(0, 4000));
    }
    await appendCapture({
      ts: new Date().toISOString(),
      kind: 'response',
      status: response.status(),
      url,
      contentType,
      body,
    });
  });
}

async function maybeHandlePhoneVerification(page: Page, rl: ReturnType<typeof createInterface>): Promise<void> {
  const bodyText = (await page.textContent('body').catch(() => ''))?.toLowerCase() ?? '';
  const hasPhoneGate = bodyText.includes('text me') || bodyText.includes('verification code') || bodyText.includes('phone number');
  if (!hasPhoneGate) return;

  const numericInput = page.locator('input[type="tel"], input[inputmode="numeric"], input[placeholder*="phone" i], input[placeholder*="code" i]').first();
  const textMeButton = page.locator('button:has-text("Text me"), button:has-text("Text Me")').first();

  if (await textMeButton.isVisible().catch(() => false)) {
    const phone = process.env.POSHMARK_PHONE || await rl.question('Poshmark phone number for verification: ');
    await numericInput.fill(phone.trim());
    await textMeButton.click();
    console.log('SMS requested. Waiting for code...');
  }

  const code = await rl.question('Enter the 6-digit Poshmark SMS code: ');
  await numericInput.fill(code.trim());

  const okButton = page.locator('button:has-text("Ok"), button:has-text("OK"), button:has-text("Verify"), button:has-text("Continue")').first();
  await okButton.click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2500);
}

async function ensureLoggedInForCreate(page: Page, rl: ReturnType<typeof createInterface>): Promise<void> {
  const email = process.env.POSHMARK_EMAIL;
  const password = process.env.POSHMARK_PASSWORD;
  if (!email || !password) throw new Error('POSHMARK_EMAIL / POSHMARK_PASSWORD not set');

  await page.goto('https://poshmark.com/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);
  if (await pageLooksLoggedIn(page)) return;

  await page.goto('https://poshmark.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1000);

  const emailInput = page.locator('input[name="login_form[username_email]"], input[name="username_email"], input[type="email"], input[name="email"]').first();
  const passwordInput = page.locator('input[name="login_form[password]"], input[name="password"], input[type="password"]').first();
  const submitButton = page.locator('button[type="submit"], button:has-text("Log In"), button:has-text("Login")').first();

  await emailInput.fill(email);
  await passwordInput.fill(password);
  await submitButton.click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2500);

  await page.goto('https://poshmark.com/modal/listing/create', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  await maybeHandlePhoneVerification(page, rl);
  await page.waitForTimeout(2000);

  if (!(await pageLooksLoggedIn(page))) {
    throw new Error('Still not authenticated after login/verification');
  }

  await savePoshmarkSession(page.context());
}

async function main(): Promise<void> {
  const rl = createInterface({ input, output });
  const browser = await getBrowser();
  const context = await createPoshmarkContext(browser);
  const page = await context.newPage();

  try {
    await writeFile(CAPTURE_PATH, '');
    await wireCapture(page);

    console.log('Checking saved Poshmark session...');
    await ensureLoggedInForCreate(page, rl);

    await page.goto('https://poshmark.com/modal/listing/create', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);

    const client = await PoshmarkApiClient.fromPage(page);
    const session = client.getSessionInfo();
    console.log(`Authenticated as user ${session.userId}${session.username ? ` (${session.username})` : ''}`);
    console.log(`Saved session: ${getStorageStatePath()}`);
    console.log(`API capture: ${CAPTURE_PATH}`);

    await appendCapture({
      ts: new Date().toISOString(),
      kind: 'session',
      userId: session.userId,
      username: session.username,
      storageStatePath: getStorageStatePath(),
    });
  } finally {
    rl.close();
    await context.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
