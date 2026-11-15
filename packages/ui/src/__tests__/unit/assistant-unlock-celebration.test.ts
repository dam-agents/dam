// TEST_OVERVIEW: the one avatar celebration the assistant's chat plays. An Agent
// TEST_OVERVIEW: the platform made finishes the checklist's first task and leaves
// TEST_OVERVIEW: it unseen, so the chat the person lands in meets them with it; the
// TEST_OVERVIEW: Get started panel keeps every other unlock, and a seen one is not
// TEST_OVERVIEW: played again.
// @vitest-environment happy-dom
import type { AvatarUnlock, GettingStartedProgress } from "api-server-api";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  progress: { unlocks: [], dismissed: false } as GettingStartedProgress,
  seen: vi.fn(),
}));

vi.mock("../../modules/getting-started/api/queries.js", () => ({
  useGettingStarted: () => ({ data: fake.progress }),
}));
vi.mock("../../modules/getting-started/api/mutations.js", () => ({
  useMarkUnlockSeen: () => ({ mutate: fake.seen }),
}));

vi.mock("../../auth.js", () => ({
  getUser: () => ({ profile: { sub: "owner-1" } }),
}));

const { assistantUnlockToCelebrate } =
  await import("../../modules/assistants/lib/assistant-unlock.js");
const { AssistantUnlockCelebration } =
  await import("../../modules/assistants/components/assistant-unlock-celebration.js");

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

describe("the celebration the first chat mounts", () => {
  let root: Root | undefined;
  let container: HTMLElement | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    fake.progress = { unlocks: [], dismissed: false };
    fake.seen.mockClear();
  });

  // TEST_SCENARIO: the reset leaves its create task unseen, so the chat the person lands in mounts the celebration and names it — the same words the design draws beside the composer.
  it("plays what a reset left unseen", () => {
    fake.progress = progress([unlock("create-agent", "tower", false)]);
    act(() => root!.render(createElement(AssistantUnlockCelebration)));
    expect(
      container!.textContent?.includes("You unlocked your first agent avatar!"),
    ).toBe(true);
  });

  // TEST_SCENARIO: nothing unseen means nothing to play, so a second landing is quiet and the chat keeps its ordinary page.
  it("plays nothing once the task is seen", () => {
    fake.progress = progress([unlock("create-agent", "tower", true)]);
    act(() => root!.render(createElement(AssistantUnlockCelebration)));
    expect(container!.querySelector("[data-testid]")).toBeNull();
  });

  // TEST_SCENARIO: an account with no provider meets the prompt for one over the chat, so nothing is mounted behind it — neither the reveal's animation nor the countdown that marks the unlock seen runs where nobody can see the celebration — and it plays in full once the prompt closes.
  it("mounts nothing behind a cover, and plays once it lifts", () => {
    vi.useFakeTimers();
    try {
      fake.progress = progress([unlock("create-agent", "tower", false)]);
      act(() =>
        root!.render(
          createElement(AssistantUnlockCelebration, { covered: true }),
        ),
      );
      expect(container!.querySelector("[data-testid]")).toBeNull();
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(fake.seen).not.toHaveBeenCalled();

      act(() =>
        root!.render(
          createElement(AssistantUnlockCelebration, { covered: false }),
        ),
      );
      expect(
        container!.textContent?.includes(
          "You unlocked your first agent avatar!",
        ),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
