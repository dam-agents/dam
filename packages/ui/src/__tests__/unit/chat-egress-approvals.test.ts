import type { ApprovalView } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  approvalGroupKey,
  groupBy,
} from "../../modules/approvals/lib/group-approvals.js";
import { egressApprovalsWaiting } from "../../modules/approvals/lib/waiting-egress.js";
import { approvalDetail } from "../../modules/home/lib/approval-copy.js";
import { approvalToastChanges } from "../../modules/home/lib/approval-toasts.js";

// TEST_OVERVIEW: the web chat shows an agent's waiting network approvals in whichever conversation of that agent is open. A held request has no session of its own, and a retry joins the approval an earlier request opened, so the chat reads the approvals the api-server holds rather than the in-session frame. Answering one removes it from that list, and its toast goes with it.

const NOW = new Date("2026-10-05T12:00:00Z");

function egress(overrides: Partial<ApprovalView> = {}): ApprovalView {
  return {
    id: "ap-1",
    type: "ext_authz",
    agentId: "a-1",
    sessionId: null,
    payload: {
      kind: "ext_authz",
      host: "s3.example.com",
      method: "GET",
      path: "/bucket",
    },
    createdAt: "2026-10-05T11:50:00Z",
    expiresAt: "2026-10-05T12:20:00Z",
    resolvedAt: null,
    verdict: null,
    status: "pending",
    ...overrides,
  };
}

describe("egressApprovalsWaiting", () => {
  // TEST_SCENARIO: the issue's reproduction. The first request's prompt went to a conversation the user has left; the retry joined that same approval, so no new row and no new frame exist. The open approval must still show in the conversation the user is in now.
  it("shows an approval an earlier request opened, in any conversation of the agent", () => {
    const joined = egress({ createdAt: "2026-10-05T11:31:00Z" });
    expect(egressApprovalsWaiting([joined], "a-1", NOW)).toEqual([joined]);
  });

  // TEST_SCENARIO: approvals of another agent, command approvals the in-session prompt already shows, and approvals someone already answered stay out of the chat.
  it("keeps out other agents, command approvals and answered approvals", () => {
    const rows = [
      egress({ id: "other-agent", agentId: "a-2" }),
      egress({
        id: "command",
        type: "acp_native",
        payload: { kind: "acp_native", toolName: "Bash" },
      }),
      egress({ id: "answered", status: "resolved", verdict: "allow_once" }),
    ];
    expect(egressApprovalsWaiting(rows, "a-1", NOW)).toEqual([]);
  });

  // TEST_SCENARIO: after the hold window the gate has denied the request, so nothing waits on the approval any more, even while its row still reads pending.
  it("drops an approval whose hold window has passed", () => {
    const expired = egress({ expiresAt: "2026-10-05T11:59:59Z" });
    expect(egressApprovalsWaiting([expired], "a-1", NOW)).toEqual([]);
  });

  // TEST_SCENARIO: the chat shows one approval at a time, the one that has waited longest.
  it("orders the waiting approvals oldest first", () => {
    const newer = egress({ id: "newer", createdAt: "2026-10-05T11:55:00Z" });
    const older = egress({ id: "older", createdAt: "2026-10-05T11:40:00Z" });
    expect(
      egressApprovalsWaiting([newer, older], "a-1", NOW).map((a) => a.id),
    ).toEqual(["older", "newer"]);
  });
});

describe("approvalToastChanges", () => {
  // TEST_SCENARIO: a retry that joins an open approval reuses its id, so it must not raise a second toast for the same approval.
  it("raises a toast only for an approval it has not seen", () => {
    expect(
      approvalToastChanges(new Set(["ap-1"]), new Set(["ap-1", "ap-2"])),
    ).toEqual({ raise: ["ap-2"], clear: [] });
  });

  // TEST_SCENARIO: an approval answered in a conversation leaves the pending list, and its toast must close too, so it does not invite a second answer.
  it("clears the toast of an approval that is no longer pending", () => {
    expect(
      approvalToastChanges(new Set(["ap-1", "ap-2"]), new Set(["ap-2"])),
    ).toEqual({ raise: [], clear: ["ap-1"] });
  });
});

describe("approvalDetail", () => {
  // TEST_SCENARIO: an HTTPS request reaches the gate with no method or path, both "*". The card reads "pi.dev (any path)" instead of "* pi.dev*"; a plain HTTP request keeps its method and path.
  it("reads an HTTPS host as any path and keeps a known method and path", () => {
    expect(
      approvalDetail(
        egress({
          payload: {
            kind: "ext_authz",
            host: "pi.dev",
            method: "*",
            path: "*",
          },
        }),
      ),
    ).toBe("pi.dev (any path)");
    expect(approvalDetail(egress())).toBe("GET s3.example.com/bucket");
  });

  // TEST_SCENARIO: a request from one of the agent's Environments shows on the agent's card and names the Environment it came from, so the owner knows what asked.
  it("names the Environment a request came from", () => {
    expect(
      approvalDetail(
        egress({
          payload: {
            kind: "ext_authz",
            host: "registry.npmjs.org",
            method: "*",
            path: "*",
            viaAgentId: "agent-env",
            viaEnvironment: "pr-42",
          },
        }),
      ),
    ).toBe("registry.npmjs.org (any path), from its Environment pr-42");
  });
});

describe("approvalGroupKey", () => {
  // TEST_SCENARIO: a browser opens several connections to one host at once, and each files its own approval. They merge into one card, oldest first, while another host, another path or another agent stays its own card.
  it("merges the agent's waiting requests for one host and scope", () => {
    const https = (id: string, host: string, agentId = "a-1") =>
      egress({
        id,
        agentId,
        payload: { kind: "ext_authz", host, method: "*", path: "*" },
      });
    const rows = [
      https("d1", "d27-a.sdn.cz"),
      https("other-host", "h.seznam.cz"),
      https("d2", "D27-A.sdn.cz"),
      https("other-agent", "d27-a.sdn.cz", "a-2"),
      egress({ id: "path-1" }),
      egress({
        id: "path-2",
        payload: {
          kind: "ext_authz",
          host: "s3.example.com",
          method: "GET",
          path: "/other",
        },
      }),
      https("d3", "d27-a.sdn.cz"),
    ];
    expect(
      groupBy(rows, approvalGroupKey).map((g) => g.map((a) => a.id)),
    ).toEqual([
      ["d1", "d2", "d3"],
      ["other-host"],
      ["other-agent"],
      ["path-1"],
      ["path-2"],
    ]);
  });
});
