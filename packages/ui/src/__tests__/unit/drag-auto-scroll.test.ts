import { describe, expect, test } from "vitest";

import { edgeScrollStep } from "../../modules/artifacts/lib/drag-auto-scroll.js";

const list = { top: 100, bottom: 900, left: 0, right: 600 };

/**
 * TEST_OVERVIEW: the per-frame scroll step while an artifact is dragged over
 * the artifact list. Holding the drag in a band at the top or bottom edge
 * scrolls the list toward that edge, faster the deeper into the band, so a
 * folder off screen can still take the drop. Anywhere else the list stays put.
 */
describe("edgeScrollStep", () => {
  test("does not scroll in the middle of the list", () => {
    expect(edgeScrollStep({ x: 300, y: 500 }, list)).toBe(0);
  });

  test("scrolls up near the top edge and down near the bottom edge", () => {
    expect(edgeScrollStep({ x: 300, y: 110 }, list)).toBeLessThan(0);
    expect(edgeScrollStep({ x: 300, y: 890 }, list)).toBeGreaterThan(0);
  });

  test("scrolls faster the closer the pointer is to the edge", () => {
    const shallow = edgeScrollStep({ x: 300, y: 150 }, list);
    const deep = edgeScrollStep({ x: 300, y: 105 }, list);
    expect(Math.abs(deep)).toBeGreaterThan(Math.abs(shallow));
  });

  /**
   * TEST_SCENARIO: the pointer leaves the list past its top edge, onto a
   * header above it or out of the window. The last known position is past
   * the edge, and the list must keep scrolling at full speed, not reverse
   * or speed up.
   */
  test("caps the speed past the edge", () => {
    expect(edgeScrollStep({ x: 300, y: 0 }, list)).toBe(
      edgeScrollStep({ x: 300, y: 100 }, list),
    );
    expect(edgeScrollStep({ x: 300, y: 2000 }, list)).toBe(
      edgeScrollStep({ x: 300, y: 900 }, list),
    );
  });

  test("does not scroll when the pointer is beside the list", () => {
    expect(edgeScrollStep({ x: 700, y: 110 }, list)).toBe(0);
    expect(edgeScrollStep({ x: -10, y: 890 }, list)).toBe(0);
  });

  /**
   * TEST_SCENARIO: a short list, like the chat sidebar's artifacts section,
   * would be all edge band with a fixed band size. The band shrinks to a
   * quarter of the height so the middle of the list still holds still.
   */
  test("keeps a still middle in a short list", () => {
    const short = { top: 0, bottom: 120, left: 0, right: 300 };
    expect(edgeScrollStep({ x: 100, y: 60 }, short)).toBe(0);
    expect(edgeScrollStep({ x: 100, y: 5 }, short)).toBeLessThan(0);
  });

  test("does not scroll a list with no height", () => {
    const empty = { top: 50, bottom: 50, left: 0, right: 300 };
    expect(edgeScrollStep({ x: 100, y: 50 }, empty)).toBe(0);
  });
});
