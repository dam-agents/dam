import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createFileDocumentStoreBackend,
  type DocumentStoreBackend,
} from "../../../../../core/document-store.js";
import { createActiveTurnStore } from "../../../infrastructure/active-turn-store.js";
import type { SessionMetadataStore } from "../../../infrastructure/session-metadata-store.js";
import {
  MAX_RESUME_ATTEMPTS,
  recoverInterruptedTurns,
} from "../../interrupted-turn-recovery.js";
import { createTriggerSessionDriver } from "../../trigger-session-driver.js";
import {
  createSessionMetadata,
  createWorld,
  frames,
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
  const world = createWorld({ activeTurns, sessionMetadata });
  const recovery = recoverInterruptedTurns({
    store: activeTurns,
    sessionMetadata,
    triggerDriver: createTriggerSessionDriver({ acpRuntime: world.runtime }),
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
