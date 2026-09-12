// TEST_OVERVIEW: whether a user is told their share of a busy node has been tilted away from an even split. A user who is being slowed and not told concludes the platform is slow; the figure has to appear when it is real, stay hidden when it is not, and report the worst of the places the user is running rather than an average that hides one bad node.
import { describe, expect, it } from "vitest";

import { shareTilt } from "../../modules/budgets/lib/slots.js";
import type { AgentView } from "../../types.js";

const agent = (shareWeight?: number) =>
  ({
    id: `a${String(shareWeight ?? "none")}`,
    usage: shareWeight === undefined ? {} : { shareWeight },
  }) as AgentView;

describe("telling a user their share has been tilted", () => {
  it("says nothing when nothing is tilted", () => {
    expect(shareTilt([agent(100), agent(100)])).toBeNull();
  });

  it("says nothing when no agent has reported yet", () => {
    expect(shareTilt([agent(), agent()])).toBeNull();
    expect(shareTilt([])).toBeNull();
  });

  it("reports the tilt when there is one", () => {
    expect(shareTilt([agent(57)])).toBe(57);
  });

  // TEST_SCENARIO: a user running on two nodes, throttled on one of them. An average would report a mild tilt on both; the user's question is how they are being treated, and the answer is the worse of the two.
  it("reports the worst node a user is running on", () => {
    expect(shareTilt([agent(100), agent(38), agent(100)])).toBe(38);
  });
});
