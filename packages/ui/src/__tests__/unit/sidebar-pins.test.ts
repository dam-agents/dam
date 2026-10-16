import { describe, expect, it } from "vitest";

import {
  movePin,
  pinnedFirst,
  stepPin,
  togglePin,
} from "../../modules/agents/lib/sidebar-pins.js";

// TEST_OVERVIEW: The user pins Agents to the top of the sidebar, and Sessions to the top of their Agent's list. Pinned items come first, in the user's order; the rest keep their recency order. The pin icon adds an item at the end of the pinned items, or takes it out. Dragging is how the user orders pins: an item dropped on a pinned item lands before or after it and is pinned, an item dropped on the "Drop to pin" area at the top is pinned first, and a drop anywhere else changes nothing.

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

  // TEST_SCENARIO: an unpinned item dropped on a pinned item joins the pinned items at that place, so the drop position is where it lands.
  it("pins an unpinned item where it is dropped", () => {
    expect(movePin(["a", "b"], "x", { id: "b", after: false })).toEqual([
      "a",
      "x",
      "b",
    ]);
  });

  // TEST_SCENARIO: with nothing pinned yet, the "Drop to pin" area at the top of the list is the drop target. A drop there pins the item first.
  it("pins an item dropped at the top first", () => {
    expect(movePin([], "x", "top")).toEqual(["x"]);
    expect(movePin(["a", "b"], "b", "top")).toEqual(["b", "a"]);
  });

  // TEST_SCENARIO: only pinned items take a drop. A drop on an unpinned item cancels the drag: nothing moves and nothing is pinned.
  it("changes nothing when the item is dropped on an unpinned item", () => {
    expect(movePin(["a", "b"], "x", { id: "y", after: false })).toEqual([
      "a",
      "b",
    ]);
    expect(movePin(["a", "b"], "a", { id: "y", after: true })).toEqual([
      "a",
      "b",
    ]);
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
