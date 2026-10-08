import { chromium } from './node_modules/playwright/index.mjs';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:5181/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

// 1. Home with collapsed sidebar
await page.screenshot({ path: '/tmp/banner-collapsed.png', fullPage: false });
console.log('1. Home with collapsed sidebar');

// 2. Expand sidebar via hamburger
const toggleBtn = page.locator('header button[aria-label="Expand sidebar"]');
if (await toggleBtn.count() > 0) {
  await toggleBtn.click();
  await page.waitForTimeout(500);
}
await page.screenshot({ path: '/tmp/banner-expanded.png', fullPage: false });
console.log('2. Home with expanded sidebar');

// 3. Open search
const searchBar = page.locator('header button').filter({ hasText: 'Search' });
if (await searchBar.count() > 0) {
  await searchBar.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/banner-search-open.png', fullPage: false });
  console.log('3. Search open (empty)');

  // Type a query
  const searchInput = page.locator('input[placeholder*="Search agents"]');
  if (await searchInput.count() > 0) {
    await searchInput.fill('ci');
    await page.waitForTimeout(300);
    await page.screenshot({ path: '/tmp/banner-search-results.png', fullPage: false });
    console.log('4. Search results for "ci"');
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

// 5. Navigate to chat
const agentRow = page.locator('[role="button"]').filter({ hasText: 'ci-pipeline' }).first();
if (await agentRow.count() > 0) {
  await agentRow.click({ force: true });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/tmp/banner-chat.png', fullPage: false });
  console.log('5. Chat view with global banner (no toggle, no search in chat)');
}

await browser.close();
console.log('Done!');
