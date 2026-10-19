import { SIDEBAR_ORDER_MAX } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  manualOrder,
  orderAfterMove,
  orderAfterStep,
} from "../../modules/agents/lib/sidebar-order.js";

// TEST_OVERVIEW: The sidebar lists Agents in one manual order that the user sets by drag and drop or with Alt+Up and Alt+Down. Agents the stored order does not name yet, a new Agent, go to the bottom, oldest first, so activity never moves anything. A move stores the whole list as the user sees it, so the order stays put when new Agents arrive.

interface Item {
  id: string;
  createdAt?: string | null;
}

const item = (id: string, createdAt?: string | null): Item => ({
  id,
  createdAt,
});
const ids = (items: readonly Item[]) => items.map((i) => i.id);
const order = (items: readonly Item[], stored: readonly string[]) =>
  ids(
    manualOrder(
      items,
      stored,
      (i) => i.id,
      (i) => i.createdAt,
    ),
  );

describe("manualOrder", () => {
  it("lists the items in the stored order", () => {
    expect(order([item("a"), item("b"), item("c")], ["c", "a", "b"])).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  // TEST_SCENARIO: a new Agent is not in the stored order yet. It goes to the bottom, and the Agents already there keep their places.
  it("puts items the order does not name at the bottom, oldest first", () => {
    const items = [
      item("new", "2026-10-16T12:00:00Z"),
      item("b", "2026-10-01T00:00:00Z"),
      item("older", "2026-10-15T12:00:00Z"),
      item("a", "2026-10-02T00:00:00Z"),
    ];
    expect(order(items, ["b", "a"])).toEqual(["b", "a", "older", "new"]);
  });

  // TEST_SCENARIO: an item with no creation time, or one that does not parse, goes after the dated ones, by id, so the order is the same on every render.
  it("puts items with no creation time last, by id", () => {
    const items = [
      item("z", null),
      item("y", "not a date"),
      item("x", "2026-10-16T12:00:00Z"),
    ];
    expect(order(items, [])).toEqual(["x", "y", "z"]);
  });

  // TEST_SCENARIO: an id in the order that names nothing the list holds, a deleted Agent, shows nothing and moves nothing.
  it("skips ids that name no item", () => {
    expect(order([item("a"), item("b")], ["gone", "b", "a"])).toEqual([
      "b",
      "a",
    ]);
  });
});

describe("orderAfterMove", () => {
  it("puts the item before or after the row it is dropped on", () => {
    const shown = ["a", "b", "c"];
    expect(
      orderAfterMove(shown, shown, "c", { id: "a", after: false }),
    ).toEqual(["c", "a", "b"]);
    expect(orderAfterMove(shown, shown, "a", { id: "b", after: true })).toEqual(
      ["b", "a", "c"],
    );
    expect(orderAfterMove(shown, shown, "a", { id: "c", after: true })).toEqual(
      ["b", "c", "a"],
    );
  });

  // TEST_SCENARIO: the first drag of a user with no stored order stores the whole list as shown, so the rows the user did not touch keep their places too.
  it("stores every shown item, the ones the order did not name included", () => {
    expect(
      orderAfterMove([], ["a", "b", "c"], "c", { id: "b", after: false }),
    ).toEqual(["a", "c", "b"]);
    expect(
      orderAfterMove(["b"], ["b", "a", "c"], "c", { id: "b", after: false }),
    ).toEqual(["c", "b", "a"]);
  });

  // TEST_SCENARIO: ids of items not listed now, an Agent filtered out of the list, stay in the order where they were.
  it("keeps stored ids that are not shown", () => {
    expect(
      orderAfterMove(["a", "hidden", "b"], ["a", "b"], "b", {
        id: "a",
        after: false,
      }),
    ).toEqual(["b", "a", "hidden"]);
  });

  it("changes nothing for a drop on the item itself or on an unknown row", () => {
    expect(
      orderAfterMove(["a", "b"], ["a", "b"], "a", { id: "a", after: true }),
    ).toBeNull();
    expect(
      orderAfterMove(["a", "b"], ["a", "b"], "a", { id: "x", after: true }),
    ).toBeNull();
  });

  // TEST_SCENARIO: the api-server takes at most SIDEBAR_ORDER_MAX ids per list. A longer order drops ids that are not shown first, then the last ones, so the save never fails.
  it("keeps the order within the api-server's limit", () => {
    const hidden = Array.from({ length: SIDEBAR_ORDER_MAX }, (_, i) => `h${i}`);
    const next = orderAfterMove(hidden, ["a", "b"], "b", {
      id: "a",
      after: false,
    });
    expect(next).toHaveLength(SIDEBAR_ORDER_MAX);
    expect(next?.slice(0, 2)).toEqual(["h0", "h1"]);
    expect(next).toContain("a");
    expect(next).toContain("b");
  });
});

describe("orderAfterStep", () => {
  const shown = ["a", "b", "c"];

  // TEST_SCENARIO: Alt+Up and Alt+Down move the focused row one place among the rows on screen, and do nothing at the ends.
  it("moves a row one place up or down, and stops at the ends", () => {
    expect(orderAfterStep([], shown, "b", -1)).toEqual(["b", "a", "c"]);
    expect(orderAfterStep([], shown, "b", 1)).toEqual(["a", "c", "b"]);
    expect(orderAfterStep([], shown, "a", -1)).toBeNull();
    expect(orderAfterStep([], shown, "c", 1)).toBeNull();
  });

  it("steps over stored ids that are not shown", () => {
    expect(orderAfterStep(["a", "gone", "b"], ["a", "b"], "b", -1)).toEqual([
      "b",
      "a",
      "gone",
    ]);
  });
});
