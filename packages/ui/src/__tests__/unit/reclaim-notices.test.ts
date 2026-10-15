// TEST_OVERVIEW: which agent-list refreshes tell the user that the platform put an agent to sleep early. A reclaim seen on first load raises nothing, since the user may have seen it already; a reclaim that appears or changes on a later refresh raises one notice, and the same reclaim seen again raises nothing.
import { describe, expect, it } from "vitest";

import { nextReclaimNotices } from "../../modules/agents/lib/reclaim-notices.js";

type Watched = Parameters<typeof nextReclaimNotices>[1][number];

const awake: Watched = { id: "a1", name: "Scout" };
const reclaimed = (at: string): Watched => ({
  ...awake,
  reclaimed: { at, for: "memory" },
});

function replay(...snapshots: Watched[][]) {
  let marks: ReadonlyMap<string, string | null> = new Map();
  return snapshots.map((agents) => {
    const next = nextReclaimNotices(marks, agents);
    marks = next.marks;
    return next.toasts.map((t) => t.message);
  });
}

describe("nextReclaimNotices", () => {
  it("announces a reclaim once, after first load", () => {
    expect(replay([awake], [reclaimed("t1")], [reclaimed("t1")])).toEqual([
      [],
      [
        "Scout was put to sleep automatically to free memory for your other agents",
      ],
      [],
    ]);
  });

  it("stays quiet about a reclaim already standing on first load", () => {
    expect(replay([reclaimed("t1")], [reclaimed("t1")])).toEqual([[], []]);
  });

  it("announces a later reclaim of the same agent", () => {
    expect(
      replay([reclaimed("t1")], [awake], [reclaimed("t2")]).map(
        (m) => m.length,
      ),
    ).toEqual([0, 0, 1]);
  });
});
