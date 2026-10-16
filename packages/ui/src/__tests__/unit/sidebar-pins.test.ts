import { describe, expect, it } from "vitest";

import {
  movePin,
  pinnedFirst,
  stepPin,
  togglePin,
} from "../../modules/agents/lib/sidebar-pins.js";

// TEST_OVERVIEW: The user pins Agents to the top of the sidebar, and Sessions to the top of their Agent's list. Pinned items come first, in the user's order; the rest keep their recency order. The pin icon adds an item at the end of the pinned items, or takes it out. A drag pins the item it carries: dropped on a pinned item it lands before or after it, dropped anywhere else it joins the end of the pinned items.

const byId = (id: string) => id;

describe("pinnedFirst", () => {
  it("puts pinned items first in pin order, the rest in their own order", () => {
    const { items, pinned } = pinnedFirst(
      ["new", "mid", "old", "oldest"],
      ["old", "new"],
      byId,
    );
    expect(items).toEqual(["old", "new", "mid", "oldest"]);
    expect([...pinned]).toEqual(["old", "new"]);
  });

  // TEST_SCENARIO: a pin can name an Agent that was deleted, or a Session not loaded yet. Such a pin shows nothing and does not count as pinned.
  it("skips pins that name no item", () => {
    const { items, pinned } = pinnedFirst(["a", "b"], ["gone", "b"], byId);
    expect(items).toEqual(["b", "a"]);
    expect([...pinned]).toEqual(["b"]);
  });
});

describe("togglePin", () => {
  it("adds an unpinned item at the end of the pinned items", () => {
    expect(togglePin(["a", "b"], "c")).toEqual(["a", "b", "c"]);
  });

  it("takes a pinned item out and keeps the others in order", () => {
    expect(togglePin(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });
});

describe("movePin", () => {
  it("drops before or after a pinned item", () => {
    expect(movePin(["a", "b", "c"], "c", { id: "a", after: false })).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(movePin(["a", "b", "c"], "a", { id: "b", after: true })).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  // TEST_SCENARIO: starting a drag on an unpinned item pins it. Dropped on a pinned item, it joins the pinned items at that place.
  it("pins an unpinned item where it is dropped", () => {
    expect(movePin(["a", "b"], "x", { id: "b", after: false })).toEqual([
      "a",
      "x",
      "b",
    ]);
  });

  // TEST_SCENARIO: pinned items always stay above unpinned ones. A drop on an unpinned item, or a drag that ends outside any row, puts an unpinned item at the end of the pinned items. A pinned item dropped outside any row keeps its place.
  it("puts an item dropped outside the pinned items at their end", () => {
    expect(movePin(["a", "b"], "x", { id: "y", after: false })).toEqual([
      "a",
      "b",
      "x",
    ]);
    expect(movePin(["a", "b"], "a", { id: "y", after: true })).toEqual([
      "b",
      "a",
    ]);
    expect(movePin(["a", "b"], "x", null)).toEqual(["a", "b", "x"]);
    expect(movePin(["a", "b"], "a", null)).toEqual(["a", "b"]);
  });

  it("leaves the order alone when an item is dropped on itself", () => {
    expect(movePin(["a", "b"], "b", { id: "b", after: false })).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("stepPin", () => {
  const shown = new Set(["a", "b", "c"]);

  // TEST_SCENARIO: Alt+Up on an unpinned row pins it at the end; Alt+Up and Alt+Down then move it one pinned row at a time, and Alt+Down past the last pinned row unpins it.
  it("pins, moves and unpins one step at a time", () => {
    expect(stepPin(["a", "b"], "c", -1, shown)).toEqual(["a", "b", "c"]);
    expect(stepPin(["a", "b"], "c", 1, shown)).toEqual(["a", "b"]);
    expect(stepPin(["a", "b", "c"], "c", -1, shown)).toEqual(["a", "c", "b"]);
    expect(stepPin(["a", "b", "c"], "a", 1, shown)).toEqual(["b", "a", "c"]);
    expect(stepPin(["a", "b", "c"], "a", -1, shown)).toEqual(["a", "b", "c"]);
    expect(stepPin(["a", "b", "c"], "c", 1, shown)).toEqual(["a", "b"]);
  });

  // TEST_SCENARIO: a step passes over pins that name nothing listed, so every key press moves the row on screen, and keeps those pins.
  it("steps over pins that are not shown", () => {
    expect(stepPin(["a", "gone", "b"], "b", -1, shown)).toEqual([
      "b",
      "a",
      "gone",
    ]);
    expect(stepPin(["a", "gone"], "a", 1, shown)).toEqual(["gone"]);
  });
});
