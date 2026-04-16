import { chromium } from 'playwright';
import { config } from 'dotenv';
config({ path: '/home/openclaw/.openclaw/workspace/projects/poshmark-store/.env' });

(async () => {
  const email = process.env.POSHMARK_EMAIL!;
  const password = process.env.POSHMARK_PASSWORD!;

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('poshmark.com') && (url.includes('access_token') || url.includes('entry_tokens') || url.includes('otp') || url.includes('/login'))) {
      let text = '';
      try { text = await resp.text(); } catch {}
      console.log('RESP', resp.status(), url, text.slice(0, 500));
    }
  });

  await page.goto('https://poshmark.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.locator('input[name="login_form[username_email]"], input[type="email"], input[name="email"]').first().fill(email);
  await page.locator('input[name="login_form[password]"], input[type="password"]').first().fill(password);
  await page.locator('button[type="submit"], button:has-text("Log In"), button:has-text("Login")').first().click();
  await page.waitForTimeout(5000);

  console.log('URL', page.url());
  console.log('TITLE', await page.title());

  const inputs = await page.locator('input').evaluateAll((els) => els.map((el) => ({
    type: el.getAttribute('type'),
    name: el.getAttribute('name'),
    id: el.getAttribute('id'),
    placeholder: el.getAttribute('placeholder'),
    inputmode: el.getAttribute('inputmode'),
    autocomplete: el.getAttribute('autocomplete'),
    ariaLabel: el.getAttribute('aria-label'),
    value: (el as { value?: string }).value ?? '',
  })));
  console.log('INPUTS', JSON.stringify(inputs, null, 2));

  const buttons = await page.locator('button').evaluateAll((els) => els.map((el) => ({
    text: (el.textContent || '').trim(),
    type: el.getAttribute('type'),
    id: el.getAttribute('id'),
    ariaLabel: el.getAttribute('aria-label'),
  })));
  console.log('BUTTONS', JSON.stringify(buttons.slice(0, 20), null, 2));

  const body = await page.textContent('body');
  console.log('BODY', (body || '').slice(0, 2500));
  await page.screenshot({ path: '/tmp/pm-login-probe.png', fullPage: true });
  await browser.close();
})();
