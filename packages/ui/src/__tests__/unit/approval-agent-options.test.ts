import type { AcpPermissionOption, ApprovalView } from "api-server-api";
import { describe, expect, it } from "vitest";

import type { ApprovalActionId } from "../../modules/approvals/hooks/use-approval-actions.js";
import { offeredByAgent } from "../../modules/approvals/lib/agent-options.js";

// TEST_OVERVIEW: an approval card on Home offers the same actions for every request, but a tool approval reaches the agent only as one of the options the agent offered; the server cancels the tool call when the chosen kind is missing (#5924). These specs cover which actions a tool approval keeps.

const ALL: ApprovalActionId[] = [
  "allow-once",
  "allow-permanent",
  "allow-host",
  "dismiss",
  "deny-forever",
];

function toolApproval(
  options: AcpPermissionOption[] | undefined,
  optionsWhole?: true,
): ApprovalView {
  return {
    id: "ap-1",
    type: "acp_native",
    agentId: "a-1",
    sessionId: "s-1",
    payload: {
      kind: "acp_native",
      toolName: "write_file",
      rpcId: 7,
      ...(options !== undefined && { options }),
      ...(optionsWhole && { optionsWhole }),
    },
    createdAt: "2026-10-26T10:00:00Z",
    expiresAt: "2026-10-26T10:20:00Z",
    resolvedAt: null,
    verdict: null,
    status: "pending",
  };
}

const offered = (row: ApprovalView) =>
  ALL.filter((id) => offeredByAgent(row, id));

describe("offeredByAgent", () => {
  // TEST_SCENARIO: the reported bug. Bob offers only "Allow once" and "Reject" for a write to its own settings, so the card offers Allow once and Deny, and no always choice that would cancel the call.
  it("keeps only the once choices a protected Bob write offers", () => {
    const row = toolApproval([
      { optionId: "proceed_once", kind: "allow_once" },
      { optionId: "cancel", kind: "reject_once" },
    ]);
    expect(offered(row)).toEqual(["allow-once", "dismiss"]);
  });

  // TEST_SCENARIO: a request that offers an always choice of each direction keeps Always allow and Always deny.
  it("keeps the always choices the agent offers", () => {
    const row = toolApproval([
      { optionId: "once", kind: "allow_once" },
      { optionId: "always", kind: "allow_always" },
      { optionId: "no", kind: "reject_once" },
      { optionId: "never", kind: "reject_always" },
    ]);
    expect(offered(row)).toEqual([
      "allow-once",
      "allow-permanent",
      "allow-host",
      "dismiss",
      "deny-forever",
    ]);
  });

  // TEST_SCENARIO: a row recorded before option ids were kept whole answers only an id below the old bound, as the server does, so an option it would cancel is not offered.
  it("drops an option the server would not answer on a legacy row", () => {
    const long = "x".repeat(512);
    const legacy = toolApproval([
      { optionId: "once", kind: "allow_once" },
      { optionId: long, kind: "allow_always" },
    ]);
    const whole = toolApproval(
      [
        { optionId: "once", kind: "allow_once" },
        { optionId: long, kind: "allow_always" },
      ],
      true,
    );
    expect(offeredByAgent(legacy, "allow-permanent")).toBe(false);
    expect(offeredByAgent(whole, "allow-permanent")).toBe(true);
  });

  // TEST_SCENARIO: a network approval has no agent options, so every action stays.
  it("keeps every action of a network approval", () => {
    const row: ApprovalView = {
      ...toolApproval(undefined),
      type: "ext_authz",
      payload: {
        kind: "ext_authz",
        host: "example.com",
        method: "GET",
        path: "/",
      },
    };
    expect(offered(row)).toEqual(ALL);
  });
});
