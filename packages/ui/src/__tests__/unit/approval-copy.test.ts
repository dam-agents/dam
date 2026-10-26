// TEST_OVERVIEW: a spend-limit question is not a command approval: allowing it raises the day's limit, so the copy names the amount, whose limit it is, and the UTC day it lasts. The 0.2.23 buttons said "Allow once" and "Deny permanently", which read as a one-request or a permanent permission.
import { describe, expect, it } from "vitest";

import {
  approvalDetail,
  spendLimitAmount,
  spendLimitDetail,
  spendLimitScopeLabel,
} from "../../modules/home/lib/approval-copy.js";

const payload = {
  kind: "spend_limit" as const,
  limitId: "limit-1",
  scope: { kind: "owner" as const },
  unit: "usd" as const,
  day: "2026-10-26",
  amountMicros: 10_000_000,
  extensions: 1,
};

describe("a spend-limit approval", () => {
  // TEST_SCENARIO: the question names the limit it is about and the amount, so nobody approves more spend believing it is one request.
  it("says whose limit it is and how much it is", () => {
    expect(spendLimitDetail(payload)).toBe(
      "Your limit for all agents reached $10.00 today",
    );
    expect(
      approvalDetail({
        id: "a1",
        agentId: "agent-1",
        type: "spend_limit",
        payload,
      } as Parameters<typeof approvalDetail>[0]),
    ).toBe("Your limit for all agents reached $10.00 today");
  });

  // TEST_SCENARIO: the three scopes read as the person sees them, and Bobcoins are not printed with a dollar sign.
  it("names each scope and each unit", () => {
    expect(spendLimitScopeLabel({ kind: "agent", agentId: "agent-1" })).toBe(
      "This agent's limit",
    );
    expect(
      spendLimitScopeLabel({ kind: "owner-connection", connectionId: "c" }),
    ).toBe("Your provider limit");
    expect(spendLimitAmount(2_500_000, "usd")).toBe("$2.50");
    expect(spendLimitAmount(2_500_000, "bobcoin")).toBe("2.50 Bobcoins");
  });
});
