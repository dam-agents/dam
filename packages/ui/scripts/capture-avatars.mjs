/**
 * Capture avatar animation frames using Playwright hover simulation.
 * Run: node packages/ui/scripts/capture-avatars.mjs
 * Requires dev server at http://localhost:5202
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const CHARS = [
  "stack", "shield", "roller", "tower",
  "wave", "compass", "spark", "lens",
];
const SIZE = 128;
const FPS = 20;
const ANIM_DURATION_MS = 1500;
const PAUSE_MS = 3000;
const FRAME_INTERVAL = 1000 / FPS;

const OUT = join(import.meta.dirname, "..", "avatar-gifs", "frames");
mkdirSync(OUT, { recursive: true });

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 800, height: 800 },
    deviceScaleFactor: 2,
  });

  const page = await context.newPage();
  await page.goto("http://localhost:5202", { waitUntil: "networkidle" });

  // Wait for the avatar sheet to load
  await page.waitForSelector(".bee-avatar", { timeout: 10000 });

  // Strip all CSS backgrounds from tile wrappers so only the SVG avatar is captured.
  // Without this, the card surface and hover backgrounds leak into frames.
  await page.addStyleTag({
    content: `.group, .group > * { background: transparent !important; }`,
  });

  for (const charName of CHARS) {
    console.log(`Capturing ${charName}...`);

    // Find the first character tile in the "Awake" section — it's in a .group wrapper
    const tileSelector = `.group .bee-avatar[data-icon="${charName}"].bee-awake`;
    const tile = page.locator(tileSelector).first();

    // Make sure it's visible
    await tile.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);

    const charDir = join(OUT, charName);
    mkdirSync(charDir, { recursive: true });

    let frameIdx = 0;

    // Helper: capture N frames at FPS interval
    async function captureFrames(count) {
      for (let i = 0; i < count; i++) {
        const box = await tile.boundingBox();
        if (!box) break;
        // Capture the avatar with some padding
        const pad = 4;
        const buf = await page.screenshot({
          type: "png",
          omitBackground: true,
          clip: {
            x: Math.max(0, box.x - pad),
            y: Math.max(0, box.y - pad),
            width: box.width + pad * 2,
            height: box.height + pad * 2,
          },
        });
        writeFileSync(
          join(charDir, `frame_${String(frameIdx).padStart(4, "0")}.png`),
          buf,
        );
        frameIdx++;
        await page.waitForTimeout(FRAME_INTERVAL);
      }
    }

    // Helper: capture a single still frame repeated N times
    async function captureStillFrames(count) {
      const box = await tile.boundingBox();
      if (!box) return;
      const pad = 4;
      const buf = await page.screenshot({
        type: "png",
        omitBackground: true,
        clip: {
          x: Math.max(0, box.x - pad),
          y: Math.max(0, box.y - pad),
          width: box.width + pad * 2,
          height: box.height + pad * 2,
        },
      });
      for (let i = 0; i < count; i++) {
        writeFileSync(
          join(charDir, `frame_${String(frameIdx).padStart(4, "0")}.png`),
          buf,
        );
        frameIdx++;
      }
    }

    const animFrames = Math.ceil(ANIM_DURATION_MS / FRAME_INTERVAL);
    const pauseFrames = Math.ceil(PAUSE_MS / FRAME_INTERVAL);

    // First animation: hover to trigger
    await tile.hover();
    await page.waitForTimeout(50);
    await captureFrames(animFrames);

    // Move mouse away, capture pause
    await page.mouse.move(0, 0);
    await page.waitForTimeout(100);
    await captureStillFrames(pauseFrames);

    // Second animation: hover again
    await tile.hover();
    await page.waitForTimeout(50);
    await captureFrames(animFrames);

    // Move away
    await page.mouse.move(0, 0);
    await page.waitForTimeout(100);

    console.log(`  ${frameIdx} frames captured for ${charName}`);
  }

  await browser.close();
  console.log(`\nFrames saved to ${OUT}`);
  console.log("Run: python3 packages/ui/scripts/assemble-gifs.py");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
