import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileDocumentStoreBackend } from "../../core/document-store.js";
import { createActiveTurnStore } from "../../modules/acp/infrastructure/active-turn-store.js";
import { createSessionMetadataStore } from "../../modules/acp/infrastructure/session-metadata-store.js";
import { recoverInterruptedTurns } from "../../modules/acp/services/interrupted-turn-recovery.js";
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
  const triggerDriver: TriggerSessionDriver = {
    start({ resumeSessionId }) {
      if (resumeSessionId) {
        resumed.push(resumeSessionId);
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
});
