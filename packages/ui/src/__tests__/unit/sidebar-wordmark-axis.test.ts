// TEST_OVERVIEW: The wordmark reads D, A, M, and the A is its axis. The A must sit on the horizontal centre of the logo's viewBox, so a box-centred logo puts the A on the icon column of the navigation rail.
import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

const source = readFileSync(
  new URL("../../components/brand-logo.tsx", import.meta.url),
  "utf8",
);

function xExtent(d: string): [number, number] {
  const xs = [...d.matchAll(/([A-Z])([^A-Z]*)/g)].flatMap(([, cmd, args]) => {
    const n = args?.match(/-?\d*\.?\d+/g)?.map(Number) ?? [];
    if (cmd === "H") return n;
    if (cmd === "M" || cmd === "L") return n.filter((_, i) => i % 2 === 0);
    return [];
  });
  return [Math.min(...xs), Math.max(...xs)];
}

// TEST_SCENARIO: The viewBox is shifted so the A, the second path written in the component, is centred in the box. A verbatim glyph set puts the A's axis at 14.96 of 32, which draws the wordmark left of the box centre and so left of the icons.
it("puts the A on the viewBox centre", () => {
  const box = source
    .match(/viewBox="([^"]+)"/)?.[1]
    ?.split(/\s+/)
    .map(Number);
  expect(box).toHaveLength(4);
  const [minX, , width] = box!;
  const paths = [...source.matchAll(/\sd="([^"]+)"/g)].map(([, d]) => d!);
  expect(paths).toHaveLength(3);
  const [min, max] = xExtent(paths[1]!);
  const centre = (min + max) / 2 - minX!;
  expect(Math.abs(centre - width! / 2)).toBeLessThan(0.05);
});
