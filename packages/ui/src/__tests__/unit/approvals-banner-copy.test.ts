import { describe, expect, it } from "vitest";

import { approvalsBannerCopy } from "../../modules/home/lib/approval-copy.js";

// TEST_OVERVIEW: the Home banner counts waiting approvals in its title and the distinct agents behind them in its detail line, so several approvals from one agent never read as several agents.

describe("approvals banner copy", () => {
  it("TEST_SCENARIO: counts agents, not approvals, in the detail line", () => {
    const approvals = ["a", "a", "a", "b", "b"].map((agentId) => ({ agentId }));
    expect(approvalsBannerCopy(approvals)).toEqual({
      title: "5 approvals waiting",
      detail: "2 agents need your decision",
    });
  });

  it("TEST_SCENARIO: one agent with several approvals is one agent", () => {
    expect(approvalsBannerCopy([{ agentId: "a" }, { agentId: "a" }])).toEqual({
      title: "2 approvals waiting",
      detail: "An agent needs your decision",
    });
  });

  it("TEST_SCENARIO: a single approval reads in the singular", () => {
    expect(approvalsBannerCopy([{ agentId: "a" }])).toEqual({
      title: "1 approval waiting",
      detail: "An agent needs your decision",
    });
  });
});
