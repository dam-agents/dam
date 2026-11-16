import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createFileDocumentStoreBackend,
  type DocumentStoreBackend,
} from "../../../../../core/document-store.js";
import { createActiveTurnStore } from "../../../infrastructure/active-turn-store.js";
import {
  createSessionMetadataStore,
  type SessionMetadataStore,
} from "../../../infrastructure/session-metadata-store.js";
import {
  MAX_RESUME_ATTEMPTS,
  recoverInterruptedTurns,
} from "../../interrupted-turn-recovery.js";
import { createTriggerSessionDriver } from "../../trigger-session-driver.js";
import {
  createInMemoryUndeliveredStore,
  createSessionMetadata,
  createWorld,
  frames,
  memoryDocumentBackend,
  promptTextsOf,
  type Client,
  type World,
} from "./acp-world.js";

/**
 * TEST_OVERVIEW: boot recovery against a real runtime, across pod deaths. The
 * Active-Turn markers are the one thing that survives a death, so each boot
 * here is a fresh runtime over the same disk, and a turn the harness never
 * answers is one the pod died in.
 */

const SESSION = "sess-oom";

let dir: string;
let disk: DocumentStoreBackend;
let sessionMetadata: SessionMetadataStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "turn-recovery-"));
  disk = createFileDocumentStoreBackend(dir);
  sessionMetadata = createSessionMetadata().store;
  createActiveTurnStore(disk).record(SESSION);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function boot(resumes: boolean): Promise<World> {
  const activeTurns = createActiveTurnStore(disk);
  const undeliveredPrompts = createInMemoryUndeliveredStore();
  const world = createWorld({
    activeTurns,
    sessionMetadata,
    undeliveredPrompts,
  });
  const recovery = recoverInterruptedTurns({
    store: activeTurns,
    sessionMetadata,
    undeliveredPrompts,
    triggerDriver: createTriggerSessionDriver({
      acpRuntime: world.runtime,
      modelReady: async () => true,
      modelMissing: () => false,
    }),
    log: () => {},
  });
  if (resumes) {
    await vi.waitFor(() => world.harness().replyTo("initialize"));
    await vi.waitFor(() => world.harness().replyTo("session/load"));
  }
  await recovery;
  return world;
}

function openSession(world: World): Client {
  const client = world.connect();
  client.send(frames.initialize(1));
  client.send(frames.loadSession(2, SESSION));
  return client;
}

describe("acp-runtime: interrupted-turn recovery across boots", () => {
  /**
   * TEST_SCENARIO: a turn dies, recovery resumes it and the resumed turn
   * finishes. Later a person's next turn in the same Session dies too. That is
   * a new interruption, so the next boot resumes the Session again.
   */
  it("resumes a session again after an earlier resume finished", async () => {
    const second = await boot(true);
    expect(promptTextsOf(second.harness())).toHaveLength(1);
    second.harness().replyTo("session/prompt", { stopReason: "end_turn" });
    openSession(second).send(frames.prompt(3, SESSION, "next task"));
    expect(promptTextsOf(second.harness())).toHaveLength(2);

    const third = await boot(true);
    expect(promptTextsOf(third.harness())).toHaveLength(1);
  });

  /**
   * TEST_SCENARIO: a turn dies and every turn recovery resumes dies too. Each
   * boot resumes the continuation again, up to MAX_RESUME_ATTEMPTS times, and
   * the boot after that gives up rather than crash-loop. The attempts spent
   * belong to that interruption alone: when a person later starts a new turn
   * in the Session and that one dies, the next boot resumes it.
   */
  it("resumes a person's new turn after recovery gave up on an earlier one", async () => {
    for (let i = 0; i < MAX_RESUME_ATTEMPTS; i++) {
      const resumed = await boot(true);
      expect(promptTextsOf(resumed.harness())).toHaveLength(1);
    }

    const givenUp = await boot(false);
    expect(givenUp.harnessStarted()).toBe(false);
    const client = openSession(givenUp);
    givenUp.harness().replyTo("initialize");
    givenUp.harness().replyTo("session/load");
    client.send(frames.prompt(3, SESSION, "try again"));
    expect(promptTextsOf(givenUp.harness())).toEqual(["try again"]);

    const resumedAgain = await boot(true);
    expect(promptTextsOf(resumedAgain.harness())).toHaveLength(1);
  });
});

describe("acp-runtime: interrupted-turn recovery with nobody watching", () => {
  /**
   * TEST_SCENARIO: the image serves Session history, so recovery's resume is
   * answered from that history before the harness holds the Session, and
   * recovery's own connection is gone by the time the harness loads it. A
   * Sleep and wake leaves exactly this: nobody has the chat open. The notice
   * still reaches the harness once, and nothing is left behind.
   */
  it("resumes a session the harness loads after recovery has hung up", async () => {
    const activeTurns = createActiveTurnStore(disk);
    const undeliveredPrompts = createInMemoryUndeliveredStore();
    const world = createWorld({
      activeTurns,
      sessionMetadata,
      undeliveredPrompts,
      historyProvider: { fetch: () => Promise.resolve([]) },
    });
    const recovery = recoverInterruptedTurns({
      store: activeTurns,
      sessionMetadata,
      undeliveredPrompts,
      triggerDriver: createTriggerSessionDriver({
        acpRuntime: world.runtime,
        modelReady: async () => true,
        modelMissing: () => false,
      }),
      log: () => {},
    });
    await vi.waitFor(() => world.harness().replyTo("initialize"));
    await recovery;
    await vi.waitFor(() => world.harness().replyTo("session/load"));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(promptTextsOf(world.harness())).toHaveLength(1);
    expect(activeTurns.leftovers()).toEqual([]);
  });
});

describe("acp-runtime: interrupted-turn recovery of a scheduled first turn", () => {
  const RUN = "sess-sched";
  const TASK = "implement the next issue";

  beforeEach(() => {
    sessionMetadata = createSessionMetadataStore(memoryDocumentBackend());
  });

  function cutFirstTurn(): void {
    sessionMetadata.set(RUN, {
      mode: "chat",
      type: "schedule_cron",
      scheduleId: "sched-1",
    });
    sessionMetadata.markUnstored(RUN);
    createActiveTurnStore(disk).record(RUN, {
      id: "prompt-1",
      recordedAt: new Date().toISOString(),
      blocks: [{ type: "text", text: TASK }],
      droppedAttachments: [],
    });
  }

  function bootScheduled(): {
    world: World;
    recovery: Promise<void>;
    bound: string[];
  } {
    const activeTurns = createActiveTurnStore(disk);
    activeTurns.remove(SESSION);
    const undeliveredPrompts = createInMemoryUndeliveredStore();
    const world = createWorld({
      activeTurns,
      sessionMetadata,
      undeliveredPrompts,
    });
    const bound: string[] = [];
    const recovery = recoverInterruptedTurns({
      store: activeTurns,
      sessionMetadata,
      undeliveredPrompts,
      triggerDriver: createTriggerSessionDriver({
        acpRuntime: world.runtime,
        modelReady: async () => true,
        modelMissing: () => false,
      }),
      bindScheduleSession: (_scheduleId, sessionId) => bound.push(sessionId),
      log: () => {},
    });
    return { world, recovery, bound };
  }

  /**
   * TEST_SCENARIO: a scheduled run is hours into its first turn when the
   * machine restarts. The harness stored its conversation early in that turn,
   * so it loads, and the run is resumed in its own Session with the
   * interruption notice instead of starting its task over in a new one.
   */
  it("resumes a first turn the harness stored in its own session", async () => {
    cutFirstTurn();
    const { world, recovery, bound } = bootScheduled();
    await vi.waitFor(() => world.harness().replyTo("initialize"));
    await vi.waitFor(() => world.harness().replyTo("session/load"));
    await recovery;

    expect(world.harness().received("session/new")).toEqual([]);
    const prompts = world.harness().received("session/prompt");
    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.params).toMatchObject({ sessionId: RUN });
    expect(promptTextsOf(world.harness())[0]).toContain("<turn-interrupted>");
    expect(sessionMetadata.get(RUN)?.unstored).toBeUndefined();
    expect(sessionMetadata.isTombstoned(RUN)).toBe(false);
    expect(bound).toEqual([]);
  });

  /**
   * TEST_SCENARIO: the machine went down at the very start of a scheduled
   * run's first turn, before the harness stored the Session, so the harness
   * refuses to load it. Only then does the task run again, in a fresh Session
   * of the same schedule, and the dead Session is retired.
   */
  it("runs a first turn the harness never stored again in a fresh session", async () => {
    cutFirstTurn();
    const { world, recovery, bound } = bootScheduled();
    await vi.waitFor(() => world.harness().replyTo("initialize"));
    await vi.waitFor(() =>
      world.harness().refuseTo("session/load", {
        code: -32002,
        message: "Resource not found",
      }),
    );
    await vi.waitFor(() =>
      world.harness().replyTo("session/new", { sessionId: "sess-rerun" }),
    );
    await recovery;

    expect(promptTextsOf(world.harness())).toEqual([TASK]);
    expect(sessionMetadata.isTombstoned(RUN)).toBe(true);
    expect(sessionMetadata.get("sess-rerun")?.meta).toMatchObject({
      type: "schedule_cron",
      scheduleId: "sched-1",
    });
    expect(bound).toEqual(["sess-rerun"]);
  });
});
