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

let lastAccessTokenPayload: Record<string, unknown> | null = null;
let lastOtpRequestToken: string | null = null;

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

function tryParseJson(text: string | null | undefined): Record<string, unknown> | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function findTokenValue(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (typeof child === 'string' && key.toLowerCase().includes('token')) return child;
    const nested = findTokenValue(child);
    if (nested) return nested;
  }
  return null;
}

async function replayAccessTokenWithEntryToken(page: Page, entryToken: string): Promise<boolean> {
  if (!lastAccessTokenPayload) return false;

  const csrfToken = await page.locator('#csrftoken').getAttribute('content').catch(() => null);
  const candidateFields = ['entry_token', 'entryToken', 'phone_registration_entry_token', 'phoneRegistrationEntryToken'];

  for (const field of candidateFields) {
    const payload: Record<string, unknown> = {
      ...lastAccessTokenPayload,
      [field]: entryToken,
    };

    const response = await page.evaluate(async ({ payload, csrfToken }) => {
      const resp = await fetch('/vm-rest/auth/users/access_token?pm_version=2026.15.01', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
        body: JSON.stringify(payload),
      });
      const text = await resp.text();
      return {
        status: resp.status,
        ok: resp.ok,
        text,
      };
    }, { payload, csrfToken });

    await appendCapture({
      ts: new Date().toISOString(),
      kind: 'access-token-retry',
      field,
      status: response.status,
      body: redact(response.text.slice(0, 4000)),
    });

    const parsed = tryParseJson(response.text);
    if (response.ok && parsed && !parsed.error) {
      return true;
    }
  }

  return false;
}

function shouldCapture(url: string): boolean {
  return url.includes('poshmark.com') && (
    url.includes('/login') ||
    url.includes('/modal/listing/create') ||
    url.includes('/posts') ||
    url.includes('/users/') ||
    url.includes('/post_attributes/') ||
    url.includes('/auth/')
  );
}

async function wireCapture(page: Page): Promise<void> {
  page.on('request', async (request: Request) => {
    const url = request.url();
    const postData = request.postData();
    const parsed = tryParseJson(postData);
    if (url.includes('/auth/users/access_token') && parsed) {
      lastAccessTokenPayload = parsed;
    }
    if (!shouldCapture(url)) return;
    await appendCapture({
      ts: new Date().toISOString(),
      kind: 'request',
      method: request.method(),
      resourceType: request.resourceType(),
      url,
      postData: redact(postData),
    });
  });

  page.on('response', async (response: Response) => {
    const url = response.url();
    const headers = response.headers();
    const contentType = headers['content-type'] ?? '';
    let rawBody = '';
    if (contentType.includes('application/json') || contentType.includes('text/')) {
      rawBody = (await response.text().catch(() => '')).slice(0, 4000);
    }
    if (url.includes('/auth/otp_requests')) {
      const parsed = tryParseJson(rawBody);
      const token = parsed?.data && typeof parsed.data === 'object'
        ? (parsed.data as Record<string, unknown>).request_token
        : null;
      if (typeof token === 'string') lastOtpRequestToken = token;
    }
    if (!shouldCapture(url)) return;
    await appendCapture({
      ts: new Date().toISOString(),
      kind: 'response',
      status: response.status(),
      url,
      contentType,
      body: redact(rawBody),
    });
  });
}

function resolveOtpCode(rl: ReturnType<typeof createInterface>): Promise<string> {
  const provided = process.env.POSHMARK_OTP ?? process.argv[2];
  if (provided && provided.trim()) return Promise.resolve(provided.trim());
  return rl.question('Enter the 6-digit Poshmark SMS code: ').then((value) => value.trim());
}

async function maybeHandlePhoneVerification(page: Page, rl: ReturnType<typeof createInterface>): Promise<void> {
  const bodyText = (await page.textContent('body').catch(() => ''))?.toLowerCase() ?? '';
  const hasPhoneGate = bodyText.includes('text me') || bodyText.includes('verification code') || bodyText.includes('phone number');
  if (!hasPhoneGate) return;

  const numericInput = page.locator('input[name="otp"], input[type="number"], input[type="tel"], input[inputmode="numeric"], input[placeholder*="phone" i], input[placeholder*="code" i]').first();
  const textMeButton = page.locator('button:has-text("Text me"), button:has-text("Text Me")').first();

  if (await textMeButton.isVisible().catch(() => false)) {
    const phone = process.env.POSHMARK_PHONE || await rl.question('Poshmark phone number for verification: ');
    await numericInput.fill(phone.trim());
    await textMeButton.click();
    console.log('SMS requested. Waiting for code...');
    await page.waitForTimeout(2000);
  }

  const code = await resolveOtpCode(rl);
  await numericInput.fill(code);

  if (!lastOtpRequestToken) {
    await appendCapture({
      ts: new Date().toISOString(),
      kind: 'missing-request-token',
      url: page.url(),
    });
    throw new Error('Missing Poshmark OTP request token');
  }

  const verificationResponse = await page.evaluate(async ({ otp, requestToken }) => {
    const doc = (globalThis as { document?: { querySelector: (selector: string) => { content?: string } | null } }).document;
    const csrfToken = doc?.querySelector('#csrftoken')?.content ?? undefined;
    const resp = await fetch('/vm-rest/auth/entry_tokens?pm_version=2026.15.01', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
      },
      body: JSON.stringify({ otp, request_token: requestToken }),
    });
    const text = await resp.text();
    return { status: resp.status, url: resp.url, text };
  }, { otp: code, requestToken: lastOtpRequestToken });

  const parsed = tryParseJson(verificationResponse.text);
  await appendCapture({
    ts: new Date().toISOString(),
    kind: 'verification-response-inline',
    status: verificationResponse.status,
    url: verificationResponse.url,
    body: redact(verificationResponse.text.slice(0, 4000)),
  });

  const entryToken = findTokenValue(parsed?.data);
  if (entryToken) {
    await appendCapture({
      ts: new Date().toISOString(),
      kind: 'entry-token-detected',
      requestToken: lastOtpRequestToken,
    });
    await replayAccessTokenWithEntryToken(page, entryToken);
  }

  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  await page.waitForTimeout(4000);
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
  await page.waitForTimeout(3000);

  await maybeHandlePhoneVerification(page, rl);
  await page.waitForTimeout(3000);

  if (!(await pageLooksLoggedIn(page))) {
    await page.goto('https://poshmark.com/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => undefined);
    await page.waitForTimeout(3000);
  }

  if (!(await pageLooksLoggedIn(page))) {
    const bodyText = (await page.textContent('body').catch(() => '')) ?? '';
    await appendCapture({
      ts: new Date().toISOString(),
      kind: 'post-verification-state',
      url: page.url(),
      title: await page.title().catch(() => ''),
      body: redact(bodyText.slice(0, 4000)),
    });
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
