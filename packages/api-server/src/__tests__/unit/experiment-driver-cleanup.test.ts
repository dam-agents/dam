import { describe, expect, it, vi } from "vitest";

import type {
  ExperimentRow,
  ExperimentsRepository,
} from "../../modules/experiments/infrastructure/experiments-repository.js";
import { createExperimentDriverCleanup } from "../../modules/experiments/services/experiment-driver-cleanup.js";

/**
 * TEST_OVERVIEW: Deleting a driver Agent closes the ledger of every Experiment
 * it was still running, the same way Stop and the inactivity sweep do: the row
 * flips `running` → `failed` with a reason, and the terminal follow-up runs so
 * the run's Invocations are shed. Rows another path already closed are left
 * alone, and one failing row does not stop the others. Drafts bound to the
 * driver are removed: a draft cannot run without its driver.
 */
const DRIVER = "driver-1";

function runningRow(id: string): ExperimentRow {
  return {
    id,
    owner: "owner-1",
    driverAgentId: DRIVER,
    name: id,
    status: "running",
    skeleton: { stages: [] } as unknown as ExperimentRow["skeleton"],
    drift: [],
    customData: null,
    attachedArtifactIds: [],
    scriptPath: "loop.ts",
    scriptSha256: "sha",
    scriptArtifactId: "art",
    scriptVersion: 1,
    dashboardArtifactId: null,
    error: null,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    executedAt: new Date("2026-09-01T00:00:00Z"),
    finishedAt: null,
    lastActivityAt: null,
  };
}

function fakeRepo(
  rows: ExperimentRow[],
  transition: (id: string) => Promise<boolean>,
): {
  repo: ExperimentsRepository;
  transitions: string[];
  draftsDeletedFor: string[];
  spansEndedFor: string[];
} {
  const transitions: string[] = [];
  const draftsDeletedFor: string[] = [];
  const spansEndedFor: string[] = [];
  const repo = {
    listRunningByDriver: async (driverAgentId: string) =>
      rows.filter((r) => r.driverAgentId === driverAgentId),
    transition: async (id: string, from: string, to: string) => {
      transitions.push(`${id}:${from}->${to}`);
      return transition(id);
    },
    deleteDraftsByDriver: async (driverAgentId: string) => {
      draftsDeletedFor.push(driverAgentId);
    },
    endOpenSpans: async (experimentId: string) => {
      spansEndedFor.push(experimentId);
    },
  } as unknown as ExperimentsRepository;
  return { repo, transitions, draftsDeletedFor, spansEndedFor };
}

describe("experiment driver cleanup", () => {
  /**
   * TEST_SCENARIO: Two running experiments for the deleted driver. Both flip to
   * failed with their open spans ended, both reach the follow-up, and the
   * driver's drafts are removed.
   */
  it("fails every running experiment of the driver and runs the follow-up", async () => {
    const { repo, transitions, draftsDeletedFor, spansEndedFor } = fakeRepo(
      [runningRow("exp-1"), runningRow("exp-2")],
      async () => true,
    );
    const reaped: string[] = [];
    const cleanup = createExperimentDriverCleanup({
      repo,
      now: () => new Date("2026-09-08T00:00:00Z"),
      onReaped: async (row) => {
        reaped.push(row.id);
      },
    });

    await cleanup(DRIVER);

    expect(transitions).toEqual([
      "exp-1:running->failed",
      "exp-2:running->failed",
    ]);
    expect(reaped).toEqual(["exp-1", "exp-2"]);
    expect(spansEndedFor).toEqual(["exp-1", "exp-2"]);
    expect(draftsDeletedFor).toEqual([DRIVER]);
  });

  /**
   * TEST_SCENARIO: The conditional transition loses to another path (Stop or
   * the inactivity sweep got there first). No follow-up runs for that row.
   */
  it("skips the follow-up when the transition did not apply", async () => {
    const { repo } = fakeRepo([runningRow("exp-1")], async () => false);
    const onReaped = vi.fn(async () => {});
    const cleanup = createExperimentDriverCleanup({
      repo,
      onReaped,
      now: () => new Date("2026-09-08T00:00:00Z"),
    });

    await cleanup(DRIVER);

    expect(onReaped).not.toHaveBeenCalled();
  });

  /**
   * TEST_SCENARIO: One row's transition throws. The cleanup logs and moves on
   * to the next row instead of leaving the rest running.
   */
  it("continues past a row whose reap fails", async () => {
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const { repo } = fakeRepo(
      [runningRow("exp-1"), runningRow("exp-2")],
      async (id) => {
        if (id === "exp-1") throw new Error("boom");
        return true;
      },
    );
    const reaped: string[] = [];
    const cleanup = createExperimentDriverCleanup({
      repo,
      now: () => new Date("2026-09-08T00:00:00Z"),
      onReaped: async (row) => {
        reaped.push(row.id);
      },
    });

    await cleanup(DRIVER);

    expect(reaped).toEqual(["exp-2"]);
    expect(stderr).toHaveBeenCalled();
    stderr.mockRestore();
  });
});
