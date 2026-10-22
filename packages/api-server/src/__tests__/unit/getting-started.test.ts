// TEST_OVERVIEW: the Getting Started checklist gives a user one avatar character for each task they finish. A task is done when its domain event arrives. The first Agent's character is the one it was created with. A user who owned an Agent before they first met the checklist gets every character at once. An unlock is kept, shown once as new, and opens a dismissed checklist again.
import { AVATAR_CHARACTERS } from "api-server-api/avatar/svg";
import { GETTING_STARTED_TASKS, type GettingStartedTask } from "api-server-api";
import type { AvatarCharacter } from "api-server-api/avatar/svg";
import { firstValueFrom, take, toArray } from "rxjs";
import { afterEach, describe, expect, it } from "vitest";

import {
  type AvatarUnlocked,
  emit,
  events$,
  EventType,
  ofType,
} from "../../events.js";
import {
  chooseCharacter,
  toProgress,
} from "../../modules/getting-started/domain/unlocks.js";
import type { Checklist } from "../../modules/getting-started/domain/unlocks.js";
import type { GettingStartedRepository } from "../../modules/getting-started/infrastructure/getting-started-repository.js";
import { startUnlockAvatarsSaga } from "../../modules/getting-started/sagas/unlock-avatars.js";
import { createEnrollment } from "../../modules/getting-started/services/enrollment.js";
import { createGettingStartedService } from "../../modules/getting-started/services/getting-started-service.js";
import { createUnlockRecorder } from "../../modules/getting-started/services/unlock-recorder.js";

function memoryRepo(): GettingStartedRepository & {
  checklists: Map<string, Checklist>;
} {
  const checklists = new Map<string, Checklist>();
  let clock = 0;
  const tick = () => new Date(Date.UTC(2026, 0, 1, 0, 0, clock++));
  return {
    checklists,
    async find(owner) {
      return checklists.get(owner) ?? null;
    },
    async enroll(owner, unlocked) {
      if (checklists.has(owner)) return;
      checklists.set(owner, {
        dismissedAt: null,
        unlocks: unlocked.map((u) => ({
          ...u,
          unlockedAt: tick(),
          seenAt: tick(),
          pickedAt: tick(),
        })),
      });
    },
    async unlock(owner, task, choose) {
      const c = checklists.get(owner)!;
      if (c.unlocks.some((u) => u.task === task)) return null;
      const chosen = choose(new Set(c.unlocks.map((u) => u.character)));
      if (!chosen) return null;
      const unlock = {
        task,
        character: chosen.character,
        unlockedAt: tick(),
        seenAt: null,
        pickedAt: chosen.picked ? tick() : null,
      };
      checklists.set(owner, {
        dismissedAt: null,
        unlocks: [...c.unlocks, unlock],
      });
      return unlock;
    },
    async markSeen(owner, task) {
      const c = checklists.get(owner)!;
      checklists.set(owner, {
        ...c,
        unlocks: c.unlocks.map((u) =>
          u.task === task ? { ...u, seenAt: u.seenAt ?? tick() } : u,
        ),
      });
    },
    async markPicked(owner, character) {
      const c = checklists.get(owner)!;
      checklists.set(owner, {
        ...c,
        unlocks: c.unlocks.map((u) =>
          u.character === character
            ? { ...u, pickedAt: u.pickedAt ?? tick() }
            : u,
        ),
      });
    },
    async setDismissed(owner, dismissed) {
      const c = checklists.get(owner)!;
      checklists.set(owner, { ...c, dismissedAt: dismissed ? tick() : null });
    },
    async reset(owner) {
      checklists.set(owner, { dismissedAt: null, unlocks: [] });
    },
  };
}

function setup(owned: Record<string, string[]> = {}) {
  const repo = memoryRepo();
  const enrollment = createEnrollment({
    repo,
    ownedAgentIds: async (owner) => owned[owner] ?? [],
  });
  const recorder = createUnlockRecorder({
    repo,
    enrollment,
    random: () => 0,
  });
  const service = (owner: string) =>
    createGettingStartedService({ repo, enrollment, owner });
  return { repo, recorder, service };
}

async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

describe("chooseCharacter", () => {
  /** TEST_SCENARIO: the first Agent keeps the character it was created with, so the avatar the user sees on it is the one they unlocked. */
  it("keeps the preferred character while it is still locked", () => {
    expect(chooseCharacter(new Set(), "lens", () => 0.99)).toBe("lens");
  });

  /** TEST_SCENARIO: a user who unlocked the first Agent's character by another task gets a different character, because each task unlocks a new one. */
  it("picks a locked character when the preferred one is taken", () => {
    const taken = new Set<AvatarCharacter>(["lens", "stack"]);
    const picked = chooseCharacter(taken, "lens", () => 0);
    expect(picked).not.toBeNull();
    expect(taken.has(picked!)).toBe(false);
  });

  /** TEST_SCENARIO: with every character unlocked there is nothing left to give. */
  it("returns null when every character is unlocked", () => {
    expect(
      chooseCharacter(new Set(AVATAR_CHARACTERS), undefined, () => 0),
    ).toBeNull();
  });
});

describe("toProgress", () => {
  /** TEST_SCENARIO: the checklist's avatar row fills in the order the user unlocked the characters. */
  it("lists unlocks oldest first and reports seen and dismissed", () => {
    const progress = toProgress({
      dismissedAt: new Date(),
      unlocks: [
        {
          task: "send-message",
          character: "wave",
          unlockedAt: new Date(2000),
          seenAt: null,
          pickedAt: null,
        },
        {
          task: "create-agent",
          character: "lens",
          unlockedAt: new Date(1000),
          seenAt: new Date(1500),
          pickedAt: new Date(1500),
        },
      ],
    });
    expect(progress.dismissed).toBe(true);
    expect(progress.unlocks.map((u) => [u.task, u.seen, u.fresh])).toEqual([
      ["create-agent", true, false],
      ["send-message", false, true],
    ]);
  });
});

describe("enrollment", () => {
  /** TEST_SCENARIO: a user who already owns an Agent used the product before the checklist, so they keep every avatar and see no checklist and no celebration. */
  it("gives an existing user every character, already seen", async () => {
    const { service } = setup({ alice: ["agent-1"] });
    const progress = await service("alice").progress();
    expect(progress.unlocks).toHaveLength(GETTING_STARTED_TASKS.length);
    expect(new Set(progress.unlocks.map((u) => u.character)).size).toBe(
      AVATAR_CHARACTERS.length,
    );
    expect(progress.unlocks.every((u) => u.seen && !u.fresh)).toBe(true);
  });

  /** TEST_SCENARIO: a new user starts with nothing unlocked. */
  it("starts a new user with an empty checklist", async () => {
    const { service } = setup();
    expect(await service("bob").progress()).toEqual({
      unlocks: [],
      dismissed: false,
    });
  });

  /** TEST_SCENARIO: when the first contact is the create of the user's first Agent, that Agent does not make them an existing user. */
  it("does not count the Agent whose create is the first contact", async () => {
    const { recorder, service } = setup({ bob: ["agent-1"] });
    await recorder.record("bob", "create-agent", {
      agentId: "agent-1",
      character: "tower",
    });
    const progress = await service("bob").progress();
    expect(progress.unlocks).toEqual([
      expect.objectContaining({ task: "create-agent", character: "tower" }),
    ]);
  });
});

describe("unlock avatars saga", () => {
  let stop: (() => void) | null = null;
  afterEach(() => {
    stop?.();
    stop = null;
  });

  function start(owned: Record<string, string[]> = {}) {
    const ctx = setup(owned);
    const sub = startUnlockAvatarsSaga(ctx.recorder);
    stop = () => sub.unsubscribe();
    return ctx;
  }

  const taskEvents: Array<[GettingStartedTask, () => void]> = [
    [
      "create-agent",
      () =>
        emit({
          type: EventType.AgentCreated,
          agentId: "a1",
          ownerSub: "u1",
          character: "spark",
        }),
    ],
    [
      "send-message",
      () =>
        emit({
          type: EventType.SessionTurnRelayed,
          agentId: "a1",
          actorSub: "u1",
          surface: "web",
        }),
    ],
    [
      "create-connection",
      () =>
        emit({
          type: EventType.ConnectionCreated,
          actorSub: "u1",
          connectionKey: "github",
          templateId: "github",
          kind: "oauth_app",
        }),
    ],
    [
      "add-skill",
      () =>
        emit({
          type: EventType.AgentSkillChanged,
          action: "installed",
          agentId: "a1",
          actorSub: "u1",
          surface: "web",
          origin: "source",
          name: "review",
        }),
    ],
    [
      "apply-starter-kit",
      () =>
        emit({
          type: EventType.StarterKitApplied,
          agentId: "a1",
          actorSub: "u1",
          surface: "web",
          catalog: "builtin",
          kitId: "kit",
          version: "1",
        }),
    ],
    [
      "create-schedule",
      () =>
        emit({
          type: EventType.ScheduleCreated,
          scheduleId: "s1",
          agentId: "a1",
          ownerSub: "u1",
        }),
    ],
    [
      "create-artifact",
      () =>
        emit({
          type: EventType.ArtifactCreated,
          artifactId: "art1",
          ownerSub: "u1",
        }),
    ],
    [
      "connect-slack",
      () =>
        emit({
          type: EventType.SlackConnected,
          agentId: "a1",
          slackChannelId: "C1",
          ownerSub: "u1",
        }),
    ],
  ];

  /** TEST_SCENARIO: every checklist task has one domain event that marks it done, and each unlock is announced so the owner's open UI refreshes at once. */
  it("unlocks a distinct character for each task's event", async () => {
    const ctx = start({ u1: ["a1"] });
    const announced = firstValueFrom(
      events$().pipe(
        ofType<AvatarUnlocked>(EventType.AvatarUnlocked),
        take(taskEvents.length),
        toArray(),
      ),
    );
    for (const [, fire] of taskEvents) fire();
    const unlocked = await announced;
    expect(unlocked.map((e) => e.task)).toEqual(taskEvents.map(([t]) => t));
    expect(unlocked[0]!.character).toBe("spark");
    expect(new Set(unlocked.map((e) => e.character)).size).toBe(
      taskEvents.length,
    );
    expect((await ctx.service("u1").progress()).unlocks).toHaveLength(
      taskEvents.length,
    );
  });

  /** TEST_SCENARIO: the deployment connects its CurveBender for every user, so it finishes nothing on the checklist, while the user's own Connection still does. */
  it("ignores the deployment's own CurveBender connection", async () => {
    const ctx = start();
    await ctx.service("u1").progress();

    emit({
      type: EventType.ConnectionCreated,
      actorSub: "u1",
      connectionKey: "cb",
      templateId: "curve-bender-deployment",
      kind: "oauth_app",
    });
    await settle();
    expect((await ctx.service("u1").progress()).unlocks).toHaveLength(0);

    emit({
      type: EventType.ConnectionCreated,
      actorSub: "u1",
      connectionKey: "cb-mine",
      templateId: "curve-bender",
      kind: "oauth_app",
    });
    await settle();
    expect(
      (await ctx.service("u1").progress()).unlocks.map((u) => u.task),
    ).toEqual(["create-connection"]);
  });

  /** TEST_SCENARIO: removing a skill or a Slack bind with no known owner does not finish a task. */
  it("ignores an uninstall and a Slack bind without an owner", async () => {
    const { service } = start();
    await service("u1").progress();
    emit({
      type: EventType.AgentSkillChanged,
      action: "uninstalled",
      agentId: "a1",
      actorSub: "u1",
      surface: "web",
      origin: "source",
      name: "review",
    });
    emit({
      type: EventType.SlackConnected,
      agentId: "a1",
      slackChannelId: "C1",
      ownerSub: null,
    });
    await settle();
    expect((await service("u1").progress()).unlocks).toEqual([]);
  });

  /** TEST_SCENARIO: a new unlock opens a dismissed checklist again, so the user sees the celebration; marking it seen stops it from playing twice. */
  it("reopens a dismissed checklist and remembers a seen unlock", async () => {
    const { service } = start();
    await service("u1").setDismissed(true);
    emit({
      type: EventType.ScheduleCreated,
      scheduleId: "s1",
      agentId: "a1",
      ownerSub: "u1",
    });
    await settle();
    const progress = await service("u1").progress();
    expect(progress.dismissed).toBe(false);
    expect(progress.unlocks).toEqual([
      expect.objectContaining({ task: "create-schedule", seen: false }),
    ]);
    const seen = await service("u1").markUnlockSeen("create-schedule");
    expect(seen.unlocks[0]!.seen).toBe(true);
  });

  /** TEST_SCENARIO: a new character stays marked new in the avatar picker until the user picks it; the first Agent's own character is already in use, so it is never marked new. */
  it("keeps an unlock new until its character is picked", async () => {
    const { service } = start();
    await service("u1").progress();
    emit({
      type: EventType.AgentCreated,
      agentId: "a1",
      ownerSub: "u1",
      character: "lens",
    });
    emit({
      type: EventType.ScheduleCreated,
      scheduleId: "s1",
      agentId: "a1",
      ownerSub: "u1",
    });
    await settle();
    const before = await service("u1").progress();
    expect(before.unlocks.map((u) => [u.task, u.fresh])).toEqual([
      ["create-agent", false],
      ["create-schedule", true],
    ]);
    const after = await service("u1").markAvatarPicked(
      before.unlocks[1]!.character,
    );
    expect(after.unlocks.every((u) => !u.fresh)).toBe(true);
  });

  /** TEST_SCENARIO: resetting locks every character and reopens the checklist, and a task done again unlocks again even on the replica that recorded it before. */
  it("locks everything on reset and unlocks a repeated task again", async () => {
    const { service } = start();
    const schedule = () =>
      emit({
        type: EventType.ScheduleCreated,
        scheduleId: "s1",
        agentId: "a1",
        ownerSub: "u1",
      });
    schedule();
    await settle();
    await service("u1").setDismissed(true);
    const reset = await service("u1").reset();
    expect(reset).toEqual({ unlocks: [], dismissed: false });
    schedule();
    await settle();
    expect((await service("u1").progress()).unlocks).toEqual([
      expect.objectContaining({ task: "create-schedule" }),
    ]);
  });
});
