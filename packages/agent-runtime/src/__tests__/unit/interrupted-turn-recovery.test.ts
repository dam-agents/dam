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
  const sessionMetadata = createSessionMetadataStore(backend);
  const resumed: string[] = [];
  const tasks: string[] = [];
  const fresh: { meta: unknown; unattended: boolean | undefined }[] = [];
  let minted = 0;
  const triggerDriver: TriggerSessionDriver = {
    start({ task, resumeSessionId, platformMeta, unattended }) {
      if (resumeSessionId) {
        resumed.push(resumeSessionId);
        tasks.push(task);
        onResume(resumeSessionId);
      } else {
        fresh.push({ meta: platformMeta, unattended });
        tasks.push(task);
      }
      const sessionId = resumeSessionId ?? `fresh-${String(++minted)}`;
      if (!resumeSessionId) sessionMetadata.set(sessionId, platformMeta ?? {});
      return Promise.resolve({ sessionId, openedOn: null });
    },
  };
  return {
    backend,
    sessionMetadata,
    resumed,
    tasks,
    fresh,
    recover: (store: ReturnType<typeof createActiveTurnStore>) =>
      recoverInterruptedTurns({
        store,
        sessionMetadata,
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
      "only a platform operator can raise their memory budget",
    );
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

  /**
   * TEST_SCENARIO: a schedule fires on a hibernated agent and the machine then
   * goes down while the new Session runs its first turn. A harness stores a
   * Session only during its first turn, so there is nothing to resume: the
   * fire's task must run anyway, unattended, in a fresh Session that keeps the
   * dead one's schedule metadata.
   */
  it("runs a scheduled fire's cut first turn again in a fresh session", async () => {
    const world = recoveryWorld();
    const meta = {
      mode: "chat",
      type: "schedule_once",
      scheduleId: "sched-1",
      model: "aws/claude-opus-5-5",
    };
    world.sessionMetadata.set("sched-run", meta);
    world.sessionMetadata.markUnstored("sched-run");
    createActiveTurnStore(world.backend).record("sched-run", {
      id: "prompt-1",
      recordedAt: new Date().toISOString(),
      blocks: [
        { type: "text", text: "append the current date to ~/qa-sched.txt" },
      ],
      droppedAttachments: [],
    });

    await world.recover(createActiveTurnStore(world.backend));

    expect(world.resumed).toEqual([]);
    expect(world.tasks).toEqual(["append the current date to ~/qa-sched.txt"]);
    expect(world.fresh).toEqual([{ meta, unattended: true }]);
    expect(world.sessionMetadata.get("fresh-1")?.meta).toEqual(meta);
    expect(world.sessionMetadata.isTombstoned("sched-run")).toBe(true);
  });

  /**
   * TEST_SCENARIO: a scheduled Session the harness has stored is cut on a
   * later turn. It is resumed as it always was: the harness has it, and the
   * resumed turn continues the conversation the task built.
   */
  it("still resumes a scheduled session the harness stored", async () => {
    const world = recoveryWorld();
    world.sessionMetadata.set("sched-run", {
      mode: "chat",
      type: "schedule_cron",
      scheduleId: "sched-1",
    });
    createActiveTurnStore(world.backend).record("sched-run", {
      id: "prompt-1",
      recordedAt: new Date().toISOString(),
      blocks: [{ type: "text", text: "check the queue" }],
      droppedAttachments: [],
    });

    await world.recover(createActiveTurnStore(world.backend));

    expect(world.resumed).toEqual(["sched-run"]);
    expect(world.fresh).toEqual([]);
  });
});
