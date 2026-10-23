import { describe, expect, it } from "vitest";

import { halfRowHeight } from "../../components/ui/dropdown-menu.js";

const rows = (tops: number[], height: number) =>
  tops.map((top) => ({ top, height }));

describe("halfRowHeight", () => {
  it("cuts the row after the last whole one in half", () => {
    expect(
      halfRowHeight(
        { available: 400, height: 424 },
        rows([4, 64, 124, 184, 244, 304, 364], 60),
      ),
    ).toBe(394);
  });

  it("caps a menu whose rows all fit at nothing", () => {
    expect(
      halfRowHeight(
        { available: 500, height: 424 },
        rows([4, 64, 124, 184, 244, 304, 364], 60),
      ),
    ).toBeNull();
  });

  it("uses each row's own height", () => {
    expect(
      halfRowHeight({ available: 250, height: 302 }, [
        { top: 4, height: 74 },
        { top: 78, height: 74 },
        { top: 152, height: 74 },
        { top: 226, height: 36 },
        { top: 262, height: 36 },
      ]),
    ).toBe(244);
  });

  it("caps nothing when no row is cut", () => {
    expect(
      halfRowHeight({ available: 300, height: 302 }, [
        { top: 4, height: 74 },
        { top: 78, height: 74 },
        { top: 152, height: 74 },
        { top: 226, height: 36 },
        { top: 262, height: 36 },
      ]),
    ).toBeNull();
  });

  it("caps nothing in a menu without rows", () => {
    expect(halfRowHeight({ available: 100, height: 200 }, [])).toBeNull();
  });

  it("cuts the first row in half when no whole row fits", () => {
    expect(
      halfRowHeight({ available: 50, height: 400 }, rows([4, 64, 124], 60)),
    ).toBe(34);
  });
});
