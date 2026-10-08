import { chromium } from './node_modules/playwright/index.mjs';

const browser = await chromium.launch({ headless: true });

async function captureTheme(theme, suffix) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    colorScheme: theme,
  });
  await page.goto('http://localhost:5181/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Navigate to chat
  await page.locator('text=ci-pipeline').first().click();
  await page.waitForTimeout(2000);

  // 1. Chat baseline
  await page.screenshot({ path: `/tmp/plus-${suffix}-01-chat.png` });
  console.log(`${suffix}: 1. Chat view`);

  // 2. Open + menu
  const plusBtn = page.locator('button[aria-label="Add"]').first();
  await plusBtn.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `/tmp/plus-${suffix}-02-menu.png` });
  console.log(`${suffix}: 2. + menu open`);

  // Scope all sub-panel interactions within the popover content
  const popover = page.locator('[data-radix-popper-content-wrapper]');

  // 3. Skills panel
  const skillsBtn = popover.locator('button').filter({ hasText: 'Skills' }).first();
  await skillsBtn.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `/tmp/plus-${suffix}-03-skills.png` });
  console.log(`${suffix}: 3. Skills panel`);

  // Back to menu (scoped to popover)
  await popover.locator('button[aria-label="Back"]').click();
  await page.waitForTimeout(300);

  // 4. Schedules panel
  const schedBtn = popover.locator('button').filter({ hasText: 'Schedules' }).first();
  await schedBtn.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `/tmp/plus-${suffix}-04-schedules.png` });
  console.log(`${suffix}: 4. Schedules panel`);

  // Back to menu
  await popover.locator('button[aria-label="Back"]').click();
  await page.waitForTimeout(300);

  // 5. Connections panel
  const connBtn = popover.locator('button').filter({ hasText: 'Connections' }).first();
  await connBtn.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `/tmp/plus-${suffix}-05-connections.png` });
  console.log(`${suffix}: 5. Connections panel`);

  // 6. Toggle a connection switch
  const firstSwitch = popover.locator('button[role="switch"]').first();
  if (await firstSwitch.count() > 0) {
    await firstSwitch.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `/tmp/plus-${suffix}-06-toggle.png` });
    console.log(`${suffix}: 6. After toggle`);
  }

  await page.close();
}

await captureTheme('light', 'light');
await captureTheme('dark', 'dark');

await browser.close();
console.log('All screenshots captured!');
