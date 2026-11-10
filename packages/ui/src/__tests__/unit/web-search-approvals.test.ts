import type { ApprovalView } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  approvalGroupKey,
  groupBy,
} from "../../modules/approvals/lib/group-approvals.js";
import { egressApprovalsWaiting } from "../../modules/approvals/lib/waiting-egress.js";
import { describeWebSearchControlRestart } from "../../modules/egress-rules/gateway-restart-copy.js";
import {
  approvalDetail,
  approvalHeadline,
  approvalPromptTitle,
  approvalReason,
} from "../../modules/home/lib/approval-copy.js";
import {
  ruleChoiceOf,
  verdictOfChoice,
} from "../../modules/web-search/lib/rule-choice.js";

// TEST_OVERVIEW: a held web search where the owner meets it: in the agent's chat beside its waiting network approvals, and on Home. It reads as a web search, shows the query or says the model chooses it, and says an allowed search can run more queries the model writes. Two requests for the same search are one approval with a count. The setting that turns control on warns that the gateway restarts, and its rule reads as ask, allow or deny.

const NOW = new Date("2026-11-10T12:00:00Z");

function search(overrides: Partial<ApprovalView> = {}): ApprovalView {
  return {
    id: "ws-1",
    type: "web_search",
    agentId: "a-1",
    sessionId: null,
    payload: {
      kind: "web_search",
      query: "dam release notes",
      key: "query:k1",
    },
    createdAt: "2026-11-10T11:59:00Z",
    expiresAt: "2026-11-10T12:20:00Z",
    resolvedAt: null,
    verdict: null,
    status: "pending",
    ...overrides,
  };
}

describe("a held web search", () => {
  // TEST_SCENARIO: the approval names the search and its query, and its note says how many more queries an allowed search may run.
  it("reads as a web search with its query", () => {
    const approval = search();
    expect(approvalHeadline(approval)).toBe("Wants to search the web");
    expect(approvalPromptTitle(approval)).toBe("Allow this web search?");
    expect(approvalDetail(approval)).toBe("dam release notes");
    expect(approvalReason(approval)).toContain("up to 2 more queries");
  });

  // TEST_SCENARIO: a search whose query the model writes itself says so instead of a query.
  it("says the model chooses the query when none is known", () => {
    const approval = search({
      payload: { kind: "web_search", query: null, key: "body:b" },
    });
    expect(approvalDetail(approval)).toBe("The model chooses the query");
  });

  // TEST_SCENARIO: the chat shows a waiting search beside the network approvals, and one from a scoped child on its parent's page.
  it("waits in the agent's chat", () => {
    const own = search();
    const child = search({
      id: "ws-child",
      agentId: "child-1",
      payload: {
        kind: "web_search",
        query: "q",
        key: "query:k2",
        forAgentId: "a-1",
      },
    });
    expect(egressApprovalsWaiting([own, child], "a-1", NOW)).toEqual([
      own,
      child,
    ]);
  });

  // TEST_SCENARIO: two requests for the same search are one approval with a count, and another search is its own.
  it("groups the same search together", () => {
    const groups = groupBy(
      [
        search({ id: "a" }),
        search({ id: "b" }),
        search({
          id: "c",
          payload: { kind: "web_search", query: "other", key: "query:k3" },
        }),
      ],
      approvalGroupKey,
    );
    expect(groups.map((g) => g.map((a) => a.id))).toEqual([["a", "b"], ["c"]]);
  });
});

describe("the web search setting", () => {
  // TEST_SCENARIO: turning control on or off warns that the agent's network access restarts, and says which way.
  it("warns of the gateway restart", () => {
    expect(describeWebSearchControlRestart(true)).toMatch(
      /^Network access restarts .* to start reading/,
    );
    expect(describeWebSearchControlRestart(false)).toContain("to stop reading");
  });

  // TEST_SCENARIO: no rule reads as asking each time, and choosing ask clears the rule.
  it("maps the rule to its choice and back", () => {
    expect(ruleChoiceOf(undefined)).toBe("ask");
    expect(ruleChoiceOf("allow")).toBe("allow");
    expect(verdictOfChoice("ask")).toBeNull();
    expect(verdictOfChoice("deny")).toBe("deny");
  });
});
