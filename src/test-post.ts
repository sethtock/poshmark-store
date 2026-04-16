// One-off test: post the Jacadi snowsuit directly to Poshmark
// Run: cd poshmark-store && npm run test:post

import { chromium, type Browser, type Page } from 'playwright';
import { config } from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '..', '.env') });

const PHOTO_PATHS = [
  '/home/openclaw/.openclaw/media/inbound/file_1---50ba37bf-a882-4617-90f0-82d9d1e69055.jpg',
  '/home/openclaw/.openclaw/media/inbound/file_2---cda54736-26b3-45cb-ae00-818ff0a5b51d.jpg',
  '/home/openclaw/.openclaw/media/inbound/file_3---5f19a006-ada8-4bdd-b243-1c41e347d4f5.jpg',
];

const LISTING = {
  title: 'Jacadi Baby Snowsuit 6M Blue White Green NWT',
  description: `Brand: Jacadi
Size: 6M (67cm)
Color: Blue, White & Green
Condition: New with Tags

Premium baby snowsuit from Jacadi — French children's designer. Features a cozy teddy bear-style hood lining and insulated fill made from recycled plastic bottles. Zip front closure. Perfect for keeping your little one warm and stylish this season!

New with tags — never worn. Still has the original tags attached. Perfect condition, ready for a new home!

Ready to ship same or next business day! 🚀

Happy to answer any questions! 💬`,
  price: '75',
  brand: 'Jacadi',
  size: '6M',
};

async function snapshot(page: Page, label: string) {
  console.log(`\n📸 [${label}] Page snapshot:`);
  const url = page.url();
  const title = await page.title();
  console.log(`  URL: ${url}`);
  console.log(`  Title: ${title}`);
  const inputs = await page.locator('input').all();
  const textareas = await page.locator('textarea').all();
  const buttons = await page.locator('button').all();
  console.log(`  Inputs (${inputs.length}): ${await Promise.all(inputs.map(async i => `${await i.getAttribute('name') ?? await i.getAttribute('type') ?? '?'} [${await i.getAttribute('placeholder') ?? 'no-placeholder'}]`)).then(a => a.join(', '))}`);
  console.log(`  Textareas (${textareas.length}): ${await Promise.all(textareas.map(async t => `[${await t.getAttribute('placeholder') ?? 'no-placeholder'}]`)).then(a => a.join(', '))}`);
  console.log(`  Buttons (${buttons.length}): ${await Promise.all(buttons.slice(0, 8).map(async b => `[${await b.textContent().catch(() => '?').then(t => t?.trim().substring(0, 30))}]`)).then(a => a.join(', '))}`);
}

async function login(page: Page): Promise<void> {
  const email = process.env.POSHMARK_EMAIL!;
  const password = process.env.POSHMARK_PASSWORD!;
  if (!email || !password) throw new Error('Missing POSHMARK_EMAIL or POSHMARK_PASSWORD in .env');

  console.log('🔐 Logging into Poshmark...');

  // First check if already logged in by visiting dashboard
  await page.goto('https://poshmark.com/dashboard', { timeout: 30000 });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);

  const dashUrl = page.url();
  if (!dashUrl.includes('/login')) {
    console.log('✅ Already logged in (session found)');
    return;
  }

  // Need to log in
  await page.goto('https://poshmark.com/login', { timeout: 30000 });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);

  await snapshot(page, 'login page');

  // Try to fill using multiple strategies
  const emailInput = page.locator('input[name="login_form[username_email]"], input[name="username_email"], input[type="email"], input[name="email"]').first();
  const passwordInput = page.locator('input[name="login_form[password]"], input[name="password"], input[type="password"]').first();
  const submitBtn = page.locator('button[type="submit"]:has-text("Login"), button:has-text("Log In"), input[type="submit"]').first();

  console.log(`  Email input visible: ${await emailInput.isVisible().catch(() => false)}`);
  console.log(`  Password input visible: ${await passwordInput.isVisible().catch(() => false)}`);

  await emailInput.fill(email);
  await page.waitForTimeout(300);
  await passwordInput.fill(password);
  await page.waitForTimeout(300);
  await submitBtn.click();

  // Wait for redirect away from login page (up to 20s for email verification redirect)
  try {
    await page.waitForURL('**/dashboard**', { timeout: 20000 });
  } catch {
    // Could be email verification required — check current state
    await page.waitForTimeout(3000);
    const url = page.url();
    if (url.includes('/login')) {
      // Check if there's a verification screen
      const bodyText = await page.textContent('body').catch(() => '');
      const normalizedBodyText = (bodyText ?? '').toLowerCase();
      if (normalizedBodyText.includes('verify') || normalizedBodyText.includes('email')) {
        console.log('⚠️ Poshmark is asking for email verification. Check your email and complete the verification.');
        // Wait for manual verification
        await page.waitForURL('**/dashboard**', { timeout: 120000 });
      }
    }
  }

  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);

  const finalUrl = page.url();
  console.log(`  After login URL: ${finalUrl}`);

  if (!finalUrl.includes('/login')) {
    console.log('✅ Logged in');
  } else {
    console.log('⚠️ Still on login page — login may have failed');
    await snapshot(page, 'login state');
  }
}

async function createListing(): Promise<string> {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
  });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('  [browser error]:', msg.text().substring(0, 200));
  });

  try {
    await login(page);

    // Go to closet and try to find the list button
    console.log('\n📝 Navigating to closet...');
    await page.goto('https://poshmark.com/closet', { timeout: 30000 });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Try clicking "List an Item" or similar button
    const listBtn = page.locator('a:has-text("List"), a:has-text("Sell"), a:has-text("List an Item"), button:has-text("List"), button:has-text("List an Item")').first();
    if (await listBtn.isVisible().catch(() => false)) {
      const href = await listBtn.getAttribute('href').catch(() => '');
      console.log(`  Found list button: ${await listBtn.textContent()} → ${href}`);
      if (href) {
        const fullUrl = href.startsWith('http') ? href : `https://poshmark.com${href}`;
        await page.goto(fullUrl, { timeout: 30000 });
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(2000);
      }
    }

    await snapshot(page, 'after closet/list attempt');
    const url = page.url();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    await snapshot(page, 'create listing page');

    // --- Step 1: Upload photos ---
    console.log('\n📷 Uploading photos...');
    const fileInput = page.locator('input[type="file"]').first();
    for (let i = 0; i < PHOTO_PATHS.length; i++) {
      console.log(`  Uploading photo ${i + 1}: ${PHOTO_PATHS[i]}`);
      await fileInput.setInputFiles(PHOTO_PATHS[i]);
      await page.waitForTimeout(1500);
    }
    await page.waitForTimeout(2000);
    console.log('✅ Photos uploaded');

    await snapshot(page, 'after photo upload');

    // --- Step 2: Fill details ---
    console.log('\n✏️ Filling listing details...');

    // Title
    const titleField = page.locator(
      'input[name="title"], input[data-testid="title-input"], input[placeholder*="title" i], input[aria-label*="title" i]'
    ).first();
    if (await titleField.isVisible().catch(() => false)) {
      await titleField.fill(LISTING.title);
      console.log('  ✅ Title filled');
    } else {
      console.log('  ⚠️ Title field not found');
    }

    // Description
    const descField = page.locator(
      'textarea[name="description"], textarea[data-testid="description-input"], textarea[placeholder*="description" i]'
    ).first();
    if (await descField.isVisible().catch(() => false)) {
      await descField.fill(LISTING.description);
      console.log('  ✅ Description filled');
    } else {
      console.log('  ⚠️ Description field not found');
    }

    // Price
    const priceField = page.locator(
      'input[name="price"], input[data-testid="price-input"], input[placeholder*="price" i], input[aria-label*="price" i]'
    ).first();
    if (await priceField.isVisible().catch(() => false)) {
      await priceField.fill(LISTING.price);
      console.log('  ✅ Price filled');
    } else {
      console.log('  ⚠️ Price field not found');
    }

    // Brand
    const brandField = page.locator(
      'input[name="brand"], input[data-testid="brand-input"], input[placeholder*="brand" i]'
    ).first();
    if (await brandField.isVisible().catch(() => false)) {
      await brandField.fill(LISTING.brand);
      await page.waitForTimeout(800);
      // Accept autocomplete suggestion
      const suggestion = page.locator('[role="option"], [data-testid*="suggestion"], .autocomplete-item').first();
      if (await suggestion.isVisible().catch(() => false)) {
        await suggestion.click();
        console.log('  ✅ Brand filled with autocomplete');
      } else {
        console.log('  ✅ Brand filled');
      }
    } else {
      console.log('  ⚠️ Brand field not found');
    }

    // Size
    const sizeField = page.locator(
      'input[name="size"], input[data-testid="size-input"], input[placeholder*="size" i]'
    ).first();
    if (await sizeField.isVisible().catch(() => false)) {
      await sizeField.fill(LISTING.size);
      console.log('  ✅ Size filled');
    } else {
      console.log('  ⚠️ Size field not found');
    }

    // Condition
    try {
      const conditionBtn = page.locator('button:has-text("Condition"), button:has-text("Select Condition"), [data-testid*="condition"]').first();
      if (await conditionBtn.isVisible().catch(() => false)) {
        await conditionBtn.click();
        await page.waitForTimeout(500);
        const nwtBtn = page.locator('button:has-text("New with Tags"), [data-testid*="NWT"]').first();
        if (await nwtBtn.isVisible().catch(() => false)) {
          await nwtBtn.click();
          console.log('  ✅ Condition set to NWT');
        }
      }
    } catch (e) {
      console.log('  ⚠️ Condition selector not handled:', (e as Error).message);
    }

    await page.waitForTimeout(1500);
    await snapshot(page, 'after filling details');

    // --- Step 3: Submit ---
    console.log('\n🚀 Publishing listing...');

    const submitBtn = page.locator(
      'button[type="submit"]:not([disabled]), button[data-testid="publish-btn"], button:has-text("List Item"), button:has-text("Publish"), button:has-text("List for Sale")'
    ).first();

    if (await submitBtn.isVisible().catch(() => false)) {
      await submitBtn.click();
    } else {
      console.log('  ⚠️ Submit button not found — trying Enter...');
      await page.keyboard.press('Enter');
    }

    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(5000);

    const finalUrl = page.url();
    console.log(`\n📍 Final URL: ${finalUrl}`);

    if (finalUrl.includes('/listing/')) {
      console.log('✅ Listing created successfully!');
      return finalUrl;
    }

    // Try to find listing links
    const listingLinks = await page.locator('a[href*="/listing/"]').all();
    for (const link of listingLinks) {
      const href = await link.getAttribute('href');
      if (href && !href.includes('/create')) {
        const full = href.startsWith('http') ? href : `https://poshmark.com${href}`;
        console.log('✅ Found listing link:', full);
        return full;
      }
    }

    await snapshot(page, 'final state');
    throw new Error(`Could not confirm listing creation. Final URL: ${finalUrl}`);

  } finally {
    await context.close();
    await browser.close();
  }
}

createListing()
  .then((url) => {
    console.log('\n🎉 LISTING POSTED!');
    console.log('URL:', url);
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  });
