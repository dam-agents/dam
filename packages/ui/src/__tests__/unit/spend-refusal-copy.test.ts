// TEST_OVERVIEW: When a spend limit stops a model call, the chat says what to do next. The owner continues the agent on Home. An Agent Editor cannot, so their chat names the owner by email to ask, and adds "or raise this agent's spend limit" only when the agent's own limit is the one reached. Everyone reads when the limit resets.
import type { SpendStatus } from "api-server-api";
import { describe, expect, it } from "vitest";

import { describeSendError, isSpendRefusal } from "../../modules/acp/errors.js";
import { agentLimitReached } from "../../modules/spend/lib/agent-limit.js";

const SOFT = "Spend quota exceeded for today. The owner can approve more.";
const CEILING =
  "Spend quota exceeded for today. Ask the platform operator for a higher ceiling.";
const OWNER = "jordan@example.com";

const editor = (agentLimit: boolean) =>
  ({ role: "editor", owner: OWNER, agentLimitReached: agentLimit }) as const;

describe("a spend limit in the chat", () => {
  // TEST_SCENARIO: the owner's text is the one they always had: continue on Home, or wait for the reset.
  it("tells the owner to continue on Home", () => {
    expect(describeSendError(SOFT, { role: "owner" }).message).toMatch(
      /^This agent reached a daily spend limit, so its model calls stop\. Continue it on Home, or wait until .+ your time\.$/,
    );
  });

  // TEST_SCENARIO: an owner-wide or connection limit stopped the call, so the editor is told only to ask the owner, by email.
  it("tells an editor to ask the owner", () => {
    expect(describeSendError(SOFT, editor(false)).message).toMatch(
      /^This agent reached a daily spend limit, so its model calls stop\. Ask jordan@example\.com to continue, or wait until .+ your time\.$/,
    );
  });

  // TEST_SCENARIO: the agent's own limit stopped the call, so the editor may also ask the owner to raise it.
  it("adds raising the agent's limit when that limit is reached", () => {
    expect(describeSendError(SOFT, editor(true)).message).toMatch(
      /Ask jordan@example\.com to continue or raise this agent's spend limit, or wait until .+ your time\.$/,
    );
  });

  // TEST_SCENARIO: the operator's ceiling stops the owner, and neither the owner nor the editor can lift it in the app, so the editor reads whose ceiling it is and when it resets.
  it("names the owner's ceiling to an editor", () => {
    const { title, message } = describeSendError(CEILING, editor(false));
    expect(title).toBe("Spend ceiling reached:");
    expect(message).toMatch(
      /^jordan@example\.com reached the daily spend ceiling that the operator set/,
    );
    expect(message).not.toMatch(/^You /);
  });

  // TEST_SCENARIO: only a spend refusal asks for the editor wording; other errors are left alone.
  it("recognises a spend refusal", () => {
    expect(isSpendRefusal(SOFT)).toBe(true);
    expect(isSpendRefusal("API error: 429 rate limit")).toBe(false);
  });
});

describe("whether the agent's own limit is reached", () => {
  const status = (
    limits: { kind: "agent" | "owner"; agentId?: string; state: string }[],
  ) =>
    ({
      limits: limits.map(({ kind, agentId, state }) => ({
        scope: kind === "agent" ? { kind, agentId } : { kind },
        state,
      })),
    }) as unknown as SpendStatus;

  // TEST_SCENARIO: the agent's own limit reads as reached only when its own state says so; an owner-wide limit or another agent's limit does not count.
  it("reads the agent's own limit", () => {
    expect(
      agentLimitReached(
        status([{ kind: "agent", agentId: "a-1", state: "reached" }]),
        "a-1",
      ),
    ).toBe(true);
    expect(
      agentLimitReached(
        status([
          { kind: "owner", state: "reached" },
          { kind: "agent", agentId: "a-2", state: "reached" },
          { kind: "agent", agentId: "a-1", state: "warn" },
        ]),
        "a-1",
      ),
    ).toBe(false);
  });

  // TEST_SCENARIO: while the spend status has not loaded, the scope is unknown, so the editor gets the owner-wide wording.
  it("falls back to not reached while the status is unknown", () => {
    expect(agentLimitReached(undefined, "a-1")).toBe(false);
  });
});
