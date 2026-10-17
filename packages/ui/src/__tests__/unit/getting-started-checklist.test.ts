// TEST_OVERVIEW: the Get started checklist shows the user's progress through the eight tasks that unlock avatar characters. An unlock the user has not seen is celebrated before it counts as done, one at a time. A new agent gets an unlocked character, and a user with none unlocked yet gets the one their first agent will unlock.
import type { AvatarUnlock, GettingStartedProgress } from "api-server-api";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../auth.js", () => ({
  getUser: () => ({ profile: { sub: "owner-1" } }),
}));

const { deriveChecklist } =
  await import("../../modules/getting-started/lib/derive-checklist.js");
const { defaultAvatar } =
  await import("../../modules/agents/lib/default-avatar.js");
const { newestAgent } =
  await import("../../modules/getting-started/lib/newest-agent.js");
const { resolveCharacter } =
  await import("../../modules/agents/components/avatar/agent-avatar.js");

const unlock = (
  task: AvatarUnlock["task"],
  character: AvatarUnlock["character"],
  seen: boolean,
): AvatarUnlock => ({
  task,
  character,
  seen,
  fresh: !seen,
  unlockedAt: "2026-01-01",
});

const progress = (
  unlocks: AvatarUnlock[],
  dismissed = false,
): GettingStartedProgress => ({ unlocks, dismissed });

describe("deriveChecklist", () => {
  // TEST_SCENARIO: a new user sees all eight tasks open and nothing to celebrate.
  it("starts with every task open", () => {
    const c = deriveChecklist(progress([]));
    expect(c.rows).toHaveLength(8);
    expect(c.rows.every((r) => r.reward === null)).toBe(true);
    expect(c.celebrating).toBeNull();
    expect(c.complete).toBe(false);
  });

  // TEST_SCENARIO: the first agent's unlock says the character is now on that agent, and it is not done until the celebration ends.
  it("celebrates the first agent before counting it", () => {
    const c = deriveChecklist(
      progress([{ ...unlock("create-agent", "lens", false), fresh: false }]),
    );
    expect(c.celebrating?.variant).toBe("first-agent");
    expect(c.unlocked).toEqual([]);
    expect(c.rows[0]!.reward).toBeNull();
  });

  // TEST_SCENARIO: when the first agent's own character was already unlocked by another task, its unlock is a different character that is not on the agent, so the message must not say it is.
  it("does not claim a random first-agent unlock is on the agent", () => {
    const c = deriveChecklist(
      progress([
        unlock("create-connection", "lens", true),
        unlock("create-agent", "wave", false),
      ]),
    );
    expect(c.celebrating?.variant).toBe("new");
  });

  // TEST_SCENARIO: a starter kit can finish several tasks at once; they are celebrated oldest first, one at a time.
  it("celebrates one unseen unlock at a time, oldest first", () => {
    const c = deriveChecklist(
      progress([
        unlock("create-agent", "lens", true),
        unlock("create-schedule", "wave", false),
        unlock("connect-slack", "tower", false),
      ]),
    );
    expect(c.celebrating?.unlock.task).toBe("create-schedule");
    expect(c.celebrating?.variant).toBe("new");
    expect(c.unlocked).toEqual(["lens"]);
  });

  // TEST_SCENARIO: the eighth unlock says the set is complete, and once it is seen the checklist is gone for good.
  it("marks the last unlock and then completes", () => {
    const tasks = [
      ["create-agent", "lens"],
      ["send-message", "wave"],
      ["create-connection", "tower"],
      ["add-skill", "stack"],
      ["apply-starter-kit", "shield"],
      ["create-schedule", "roller"],
      ["create-artifact", "compass"],
      ["connect-slack", "spark"],
    ] as const;
    const last = deriveChecklist(
      progress(tasks.map(([t, ch], i) => unlock(t, ch, i < 7))),
    );
    expect(last.celebrating?.variant).toBe("last");
    expect(last.complete).toBe(false);
    const done = deriveChecklist(
      progress(tasks.map(([t, ch]) => unlock(t, ch, true))),
    );
    expect(done.complete).toBe(true);
  });
});

describe("defaultAvatar", () => {
  // TEST_SCENARIO: with nothing unlocked the first agent keeps the character its name gives it, which the server then unlocks as the reward.
  it("uses the name's character when nothing is unlocked", () => {
    expect(defaultAvatar("agent-7", [], [])).toBe(
      resolveCharacter("agent-7", null),
    );
  });

  // TEST_SCENARIO: a new agent only gets a character the user has unlocked, the one they use least.
  it("picks the least used unlocked character", () => {
    expect(
      defaultAvatar("x", ["lens", "wave"], [{ name: "a", avatar: "lens" }]),
    ).toBe("wave");
  });
});

describe("newestAgent", () => {
  // TEST_SCENARIO: a task on an agent opens the one the user created last.
  it("returns the agent created last", () => {
    const agents = [
      { id: "a", createdAt: "2026-01-01" },
      { id: "b", createdAt: "2026-03-01" },
      { id: "c" },
    ];
    expect(newestAgent(agents)?.id).toBe("b");
  });
});
