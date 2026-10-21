import { chromium } from "@playwright/test";

import { baseUrl } from "../src/config.js";
import { acceptTerms, loginViaUi } from "../src/lib/auth.js";
import { createRefreshingApiClient } from "../src/lib/api-client.js";
import { refreshingToken } from "../src/lib/backend.js";

const OUT = "/tmp/janui-shots";
const api = createRefreshingApiClient(refreshingToken());
await acceptTerms(api);
await api.features.setFlag.mutate({ feature: "new-layout", enabled: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1100, height: 760 },
  deviceScaleFactor: 2,
});
await loginViaUi(page);
await page.goto(baseUrl);
await page.getByTestId("sidebar-tree").waitFor();

await page.screenshot({
  path: `${OUT}/f3-header.png`,
  clip: { x: 0, y: 0, width: 340, height: 70 },
});

await page.getByRole("button", { name: "Collapse navigation" }).click();
await page.getByTestId("sidebar-rail").waitFor();
await page.screenshot({
  path: `${OUT}/f3-header-collapsed.png`,
  clip: { x: 0, y: 0, width: 340, height: 70 },
});

const tile = page.locator('[data-testid="sidebar-rail-agent"]').first();
await tile.hover();
await page.waitForTimeout(600);
await page.screenshot({
  path: `${OUT}/f2-hover-popover.png`,
  clip: { x: 0, y: 0, width: 560, height: 420 },
});
const actions = await page
  .locator('[data-testid="sidebar-agent-new-session"], [data-testid="sidebar-agent-menu"], [data-testid="sidebar-agent-session-filter"]')
  .count();
console.log("popover action buttons:", actions);
await page.screenshot({
  path: `${OUT}/f2-hover-bar.png`,
  clip: { x: 0, y: 60, width: 560, height: 160 },
});

await page.mouse.move(700, 400);
await page.waitForTimeout(500);
console.log("after leaving:", await page.locator('[data-radix-popper-content-wrapper]').count());

const urlBefore = page.url();
await tile.click();
await page.waitForTimeout(1500);
console.log("url changed:", page.url() !== urlBefore, "->", page.url());
await page.screenshot({
  path: `${OUT}/f4-click-new-session.png`,
  clip: { x: 0, y: 0, width: 700, height: 500 },
});
await browser.close();
