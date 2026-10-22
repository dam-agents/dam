import { describe, expect, it } from "vitest";

import { overflowEdges } from "../../components/ui/dropdown-menu.js";

const box = (
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
) => ({
  scrollTop,
  clientHeight,
  scrollHeight,
});

describe("overflowEdges", () => {
  it("reports a fade only at the bottom while the list starts at the top", () => {
    expect(overflowEdges(box(0, 288, 414))).toEqual({
      above: false,
      below: true,
    });
  });

  it("reports both edges in the middle of a scroll", () => {
    expect(overflowEdges(box(60, 288, 414))).toEqual({
      above: true,
      below: true,
    });
  });

  it("reports no fade at the end of the list", () => {
    expect(overflowEdges(box(126, 288, 414))).toEqual({
      above: true,
      below: false,
    });
  });

  it("reports no fade for a list that fits", () => {
    expect(overflowEdges(box(0, 288, 288))).toEqual({
      above: false,
      below: false,
    });
  });

  it("ignores the sub-pixel slack a scroll position can leave", () => {
    expect(overflowEdges(box(0, 288, 289))).toEqual({
      above: false,
      below: false,
    });
  });
});
