// TEST_OVERVIEW: Avatar figures differ in outline (a hat, wheels, wings), so each SVG fits its viewBox to the figure it draws. Rendered to pixels, every figure fills the square along its longer side, less the requested margin, and sits centered on both axes.
import { Resvg } from "@resvg/resvg-js";
import { avatarSvg } from "api-server-api/avatar/svg";
import { describe, expect, it } from "vitest";

const PX = 200;
const MARGIN = 0.01;
const NAMES = Array.from({ length: 300 }, (_, i) => `agent-${i}`);

function inkBounds(svg: string) {
  const image = new Resvg(svg, {
    fitTo: { mode: "width", value: PX },
  }).render();
  const { pixels } = image;
  let [x0, y0, x1, y1] = [PX, PX, -1, -1];
  for (let y = 0; y < image.height; y++)
    for (let x = 0; x < image.width; x++)
      if (pixels[(y * image.width + x) * 4 + 3]! > 0) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x + 1);
        y1 = Math.max(y1, y + 1);
      }
  return { x0, y0, x1, y1 };
}

describe("avatar framing", () => {
  // TEST_SCENARIO: Whatever parts a figure has, its ink touches the margin on the longer axis and is centered on both, so no avatar floats in blank space or clips.
  it("fits and centers every figure within the margin", () => {
    const pad = PX * MARGIN;
    for (const name of NAMES) {
      const { x0, y0, x1, y1 } = inkBounds(avatarSvg(name, false, MARGIN));
      const gap = Math.min(x0, y0, PX - x1, PX - y1);
      expect(gap, name).toBeGreaterThanOrEqual(pad - 1);
      expect(gap, name).toBeLessThanOrEqual(pad + 1);
      expect(Math.abs(x0 - (PX - x1)), name).toBeLessThanOrEqual(1.5);
      expect(Math.abs(y0 - (PX - y1)), name).toBeLessThanOrEqual(1.5);
    }
  });
});
