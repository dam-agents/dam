import type { ApprovalView } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  deniableApprovalIds,
  denyAllPrompt,
  denyBatches,
} from "../../modules/approvals/lib/deny-all.js";
import { denyOnceOption } from "../../modules/sessions/lib/permission-deny-all.js";

// TEST_OVERVIEW: an agent that hits one blocked host again and again can pile up dozens of pending approvals (#4716). Deny all, in the Activity approvals view and on the session prompts, denies every waiting request once, after one confirmation. These specs cover what it sends, in how many calls, and what the confirmation says.

function approval(
  id: string,
  overrides: Partial<ApprovalView> = {},
): ApprovalView {
  return {
    id,
    type: "ext_authz",
    agentId: "a-1",
    sessionId: null,
    payload: {
      kind: "ext_authz",
      host: "127.0.0.1",
      method: "GET",
      path: "/api/version",
    },
    createdAt: "2026-10-13T10:00:00Z",
    expiresAt: "2026-10-13T10:20:00Z",
    resolvedAt: null,
    verdict: null,
    status: "pending",
    ...overrides,
  };
}

describe("deniableApprovalIds", () => {
  // TEST_SCENARIO: only a pending approval can still be denied. One already answered or expired is left out, so the confirmation counts only what the action changes.
  it("keeps only pending approvals", () => {
    expect(
      deniableApprovalIds([
        approval("waiting"),
        approval("answered", { status: "resolved", verdict: "allow_once" }),
        approval("expired", { status: "expired" }),
      ]),
    ).toEqual(["waiting"]);
  });
});

describe("denyBatches", () => {
  // TEST_SCENARIO: approvals.dismissMany takes at most 500 ids, so a larger backlog goes in several calls and no id is lost or sent twice.
  it("splits the ids into calls of at most 500", () => {
    const ids = Array.from({ length: 1001 }, (_, i) => `ap-${String(i)}`);
    const batches = denyBatches(ids);
    expect(batches.map((b) => b.length)).toEqual([500, 500, 1]);
    expect(batches.flat()).toEqual(ids);
  });

  it("sends nothing for no ids", () => {
    expect(denyBatches([])).toEqual([]);
  });
});

describe("denyAllPrompt", () => {
  // TEST_SCENARIO: the confirmation names how many requests it denies, and says that the agent may ask again, because a once-only deny writes no rule.
  it("names the count and says the agent may ask again", () => {
    const prompt = denyAllPrompt(82);
    expect(prompt.title).toBe("Deny 82 requests?");
    expect(prompt.confirmLabel).toBe("Deny 82");
    expect(prompt.message).toContain("asks again");
  });

  it("reads in the singular for one request", () => {
    expect(denyAllPrompt(1).title).toBe("Deny 1 request?");
  });
});

describe("denyOnceOption", () => {
  // TEST_SCENARIO: Deny all on the tool permission prompt answers each tool call with its deny-once option, never with an always-deny that the harness would remember.
  it("picks the deny-once option", () => {
    expect(
      denyOnceOption([
        { optionId: "yes", name: "Allow", kind: "allow_once" },
        { optionId: "never", name: "Always deny", kind: "reject_always" },
        { optionId: "no", name: "Deny", kind: "reject_once" },
      ])?.optionId,
    ).toBe("no");
  });

  // TEST_SCENARIO: a tool call that offers no deny-once option is left for the user to answer one by one.
  it("finds nothing when no option denies once", () => {
    expect(
      denyOnceOption([
        { optionId: "yes", name: "Allow", kind: "allow_once" },
        { optionId: "never", name: "Always deny", kind: "reject_always" },
      ]),
    ).toBeUndefined();
  });
});
