// TEST_OVERVIEW: A renamed periodic job leaves its old BullMQ queue in Redis:
// TEST_OVERVIEW: the job scheduler and its one waiting job, with no worker.
// TEST_OVERVIEW: retire() deletes that queue at api-server start, active jobs
// TEST_OVERVIEW: included, and does not start a worker or a scheduler for it.
import { describe, it, expect, vi } from "vitest";

const { queues } = vi.hoisted(() => ({
  queues: [] as {
    name: string;
    obliterate: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    upsertJobScheduler: ReturnType<typeof vi.fn>;
  }[],
}));

vi.mock("bullmq", () => ({
  Queue: class {
    obliterate = vi.fn(async () => {});
    close = vi.fn(async () => {});
    upsertJobScheduler = vi.fn(async () => {});
    constructor(public name: string) {
      queues.push(this);
    }
  },
  Worker: class {
    constructor() {
      throw new Error("retire must not start a worker");
    }
  },
}));

const { createPeriodicJobs } = await import("../../core/periodic-jobs.js");

describe("periodic jobs: retire", () => {
  /**
   * TEST_SCENARIO: The image-update job was called retired-image-migration.
   * Its old queue must be deleted with force, so a job that a replica still
   * runs does not block the delete, and the queue connection is closed.
   */
  it("obliterates the old job's queue and closes it", async () => {
    const jobs = createPeriodicJobs({ connection: {}, log: () => {} });
    await jobs.retire("retired-image-migration");
    await jobs.close();

    expect(queues.map((q) => q.name)).toEqual([
      "periodic.retired-image-migration",
    ]);
    expect(queues[0]!.obliterate).toHaveBeenCalledWith({ force: true });
    expect(queues[0]!.close).toHaveBeenCalled();
    expect(queues[0]!.upsertJobScheduler).not.toHaveBeenCalled();
  });
});
