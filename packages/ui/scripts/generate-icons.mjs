#!/usr/bin/env node
// Rasterize favicon.svg to PWA / Apple-touch icons with built-in safe-area
// padding. iOS home screens and Android launchers paint the artwork edge-to-edge,
// so the PNGs need padding baked in; the raw favicon.svg stays edge-to-edge for
// the browser tab where that's what we want.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, "..", "public");

const SAFE_AREA = 0.72;  // artwork occupies 72% of the square (14% padding each side)
const BG_LIGHT = "#fafaf9";

const rawSvg = await readFile(resolve(publicDir, "favicon.svg"), "utf8");
// Extract just the <svg …>…</svg> inner content — we re-wrap it with a transform
const inner = rawSvg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
const srcViewBox = rawSvg.match(/viewBox="([^"]+)"/i)?.[1] ?? "0 0 512 512";
const [, , srcW, srcH] = srcViewBox.split(/\s+/).map(Number);
const SRC = Math.max(srcW, srcH);
const VIEW = 512;
const scale = SAFE_AREA * (VIEW / SRC);
const offset = ((1 - SAFE_AREA) / 2) * VIEW;

const paddedSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW} ${VIEW}" fill="none">
  <rect width="${VIEW}" height="${VIEW}" fill="${BG_LIGHT}"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})">${inner}</g>
</svg>`;

const targets = [
  { name: "apple-touch-icon-180x180.png", size: 180 },
  { name: "pwa-192x192.png", size: 192 },
  { name: "pwa-512x512.png", size: 512 },
];

for (const { name, size } of targets) {
  await sharp(Buffer.from(paddedSvg))
    .resize(size, size)
    .png()
    .toFile(resolve(publicDir, name));
  console.log(`  ✓ ${name} (${size}x${size})`);
}
