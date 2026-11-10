// TEST_OVERVIEW: the one avatar celebration the assistant's chat plays. An Agent
// TEST_OVERVIEW: the platform made finishes the checklist's first task and leaves
// TEST_OVERVIEW: it unseen, so the chat the person lands in meets them with it; the
// TEST_OVERVIEW: Get started panel keeps every other unlock, and a seen one is not
// TEST_OVERVIEW: played again.
import type { AvatarUnlock, GettingStartedProgress } from "api-server-api";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../auth.js", () => ({
  getUser: () => ({ profile: { sub: "owner-1" } }),
}));

const { assistantUnlockToCelebrate } =
  await import("../../modules/assistants/lib/assistant-unlock.js");

const unlock = (
  task: AvatarUnlock["task"],
  character: AvatarUnlock["character"],
  seen: boolean,
): AvatarUnlock => ({
  task,
  character,
  seen,
  fresh: false,
  unlockedAt: "2026-01-01",
});

const progress = (unlocks: AvatarUnlock[]): GettingStartedProgress => ({
  unlocks,
  dismissed: false,
});

describe("the celebration in the assistant's chat", () => {
  // TEST_SCENARIO: the Agent the platform made unlocked the first avatar and nobody has seen it, so the chat plays it.
  it("plays the first-agent unlock the platform made, unseen", () => {
    expect(
      assistantUnlockToCelebrate(
        progress([unlock("create-agent", "tower", false)]),
      ),
    ).toMatchObject({
      variant: "first-agent",
      unlock: { task: "create-agent" },
    });
  });

  // TEST_SCENARIO: once seen — by this celebration or in the Get started panel — it does not play again, and neither does any other task's unlock, which the panel keeps.
  it("plays nothing else", () => {
    expect(
      assistantUnlockToCelebrate(
        progress([unlock("create-agent", "tower", true)]),
      ),
    ).toBeNull();
    expect(
      assistantUnlockToCelebrate(
        progress([
          unlock("create-agent", "tower", true),
          unlock("send-message", "wave", false),
        ]),
      ),
    ).toBeNull();
    expect(assistantUnlockToCelebrate(undefined)).toBeNull();
  });
});
