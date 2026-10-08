import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
try {
  // Check which port the user might be on
  for (const port of [5181, 5182, 5183, 5184, 5185, 5186]) {
    try {
      const resp = await page.goto(`http://localhost:${port}/`, { timeout: 3000 });
      if (resp?.ok()) {
        await page.waitForTimeout(2000);
        await page.screenshot({ path: `/tmp/mock-port-${port}.png` });
        console.log(`✓ Port ${port}: page loaded, screenshot saved`);
      }
    } catch {
      console.log(`✗ Port ${port}: failed to load`);
    }
  }
} finally {
  await browser.close();
}
