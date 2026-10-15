import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileDocumentStoreBackend } from "../../core/document-store.js";
import { createActiveTurnStore } from "../../modules/acp/infrastructure/active-turn-store.js";
import { createSessionMetadataStore } from "../../modules/acp/infrastructure/session-metadata-store.js";
import {
  INTERRUPTION_NOTICE,
  STOPPED_NOTICE,
  recoverInterruptedTurns,
} from "../../modules/acp/services/interrupted-turn-recovery.js";
import type { TriggerSessionDriver } from "../../modules/acp/services/trigger-session-driver.js";

/**
 * TEST_OVERVIEW: boot recovery resumes, with an interruption notice, each
 * Session whose turn the previous process died in. It runs a few seconds after
 * boot, so by then the new process may already be running a turn of its own —
 * a person's first chat message after a restart. That turn must not be
 * resumed: the notice would queue behind it and the harness would answer the
 * person twice.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "recovery-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function recoveryWorld(onResume: (sessionId: string) => void = () => {}) {
  const backend = createFileDocumentStoreBackend(dir);
  const resumed: string[] = [];
  const tasks: string[] = [];
  const triggerDriver: TriggerSessionDriver = {
    start({ task, resumeSessionId }) {
      if (resumeSessionId) {
        resumed.push(resumeSessionId);
        tasks.push(task);
        onResume(resumeSessionId);
      }
      return Promise.resolve({
        sessionId: resumeSessionId ?? "fresh",
        openedOn: null,
      });
    },
  };
  return {
    backend,
    resumed,
    tasks,
    recover: (store: ReturnType<typeof createActiveTurnStore>) =>
      recoverInterruptedTurns({
        store,
        sessionMetadata: createSessionMetadataStore(backend),
        triggerDriver,
        log: () => {},
      }),
  };
}

describe("interrupted-turn recovery", () => {
  /**
   * TEST_SCENARIO: the previous process died with a turn running in
   * `interrupted`; the new process has since started a turn in `live` that is
   * still running when recovery reads the markers. Only `interrupted` is
   * resumed.
   */
  it("resumes the previous process's turn but not a live one", async () => {
    const world = recoveryWorld();
    createActiveTurnStore(world.backend).record("interrupted");

    const booted = createActiveTurnStore(world.backend);
    booted.record("live");
    await world.recover(booted);

    expect(world.resumed).toEqual(["interrupted"]);
  });

  /**
   * TEST_SCENARIO: the previous process died with turns running in `first` and
   * `second`. While recovery is resuming `first`, a person sends a message in
   * `second`, so a live turn takes it over. Recovery must not resume `second`
   * from the list it read before that happened.
   */
  it("skips a session that goes live while an earlier one is resumed", async () => {
    let booted: ReturnType<typeof createActiveTurnStore> | undefined;
    const world = recoveryWorld((sessionId) => {
      if (sessionId === "first") booted?.record("second");
    });
    const previous = createActiveTurnStore(world.backend);
    previous.record("first");
    previous.record("second");

    booted = createActiveTurnStore(world.backend);
    await world.recover(booted);

    expect(world.resumed).toEqual(["first"]);
  });

  /**
   * TEST_SCENARIO: the harness was killed mid-tool, so on resume it records
   * the running tool call as rejected by the user and tells the agent to stop
   * and wait. The resumed turn's notice must say that record is the restart's,
   * not a person's, so the agent carries on instead of waiting.
   */
  it("tells the resumed turn the interrupted tool call was not rejected by a person", async () => {
    const world = recoveryWorld();
    createActiveTurnStore(world.backend).record("interrupted");

    await world.recover(createActiveTurnStore(world.backend));

    expect(world.tasks).toEqual([INTERRUPTION_NOTICE]);
    expect(INTERRUPTION_NOTICE).toContain(
      "The user doesn't want to proceed with this tool use",
    );
    expect(INTERRUPTION_NOTICE).toContain("Nobody rejected it");
    expect(INTERRUPTION_NOTICE).toContain(
      "Do not stop or wait for the user because of it.",
    );
  });

  /**
   * TEST_SCENARIO: a Sleep stops the agent with SIGTERM while `slept` runs a
   * turn. That shutdown marks the turn stopped, so the next boot resumes it
   * with a notice naming the stop, not memory. A turn of the previous boot
   * that recovery has not resumed yet keeps the cause it had.
   */
  it("tells a turn the platform stopped that it was stopped, not out of memory", async () => {
    const world = recoveryWorld();
    createActiveTurnStore(world.backend).record("killed");
    const sleeping = createActiveTurnStore(world.backend);
    sleeping.record("slept");
    sleeping.markStopped();

    await world.recover(createActiveTurnStore(world.backend));

    expect(world.resumed).toEqual(["killed", "slept"]);
    expect(world.tasks).toEqual([INTERRUPTION_NOTICE, STOPPED_NOTICE]);
    expect(STOPPED_NOTICE).toContain("put to sleep");
    expect(STOPPED_NOTICE).not.toContain("memory");
    expect(STOPPED_NOTICE).toContain("Nobody rejected it");
  });
});
