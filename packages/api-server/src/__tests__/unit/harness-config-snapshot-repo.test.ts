/**
 * TEST_OVERVIEW: An agent keeps one harness-config snapshot per harness in one
 * column. A runtime reports several harnesses at once, so two writes for two
 * harnesses can race; both must land. A harness's snapshot written before the
 * agent's own top-level one must not make the agent look captured.
 */
import { describe, expect, it } from "vitest";
import type { Db } from "db";
import { createHarnessConfigSnapshotRepo } from "../../modules/harness-config/infrastructure/snapshot-repo.js";

function fakeDb(): Db {
  let column: unknown = null;
  let held: Promise<unknown> = Promise.resolve();
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const db = {
    select: () => ({
      from: () => ({
        where: async () => {
          await tick();
          return [{ snapshot: column }];
        },
      }),
    }),
    update: () => ({
      set: (values: { harnessConfigSnapshot: unknown }) => ({
        where: async () => {
          await tick();
          column = values.harnessConfigSnapshot;
        },
      }),
    }),
    transaction: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const run = held.then(() => fn({ ...db, execute: async () => {} }));
      held = run.catch(() => {});
      return run;
    },
  };
  return db as unknown as Db;
}

const reported = (model: string) => ({
  model,
  mode: null,
  configOptions: {},
  availableModels: null,
});

describe("harness-config snapshot repo", () => {
  /** TEST_SCENARIO: A runtime reports two harnesses at once; the two writes
   * overlap, and each harness keeps its own snapshot. */
  it("keeps both harnesses when their writes overlap", async () => {
    const repo = createHarnessConfigSnapshotRepo(fakeDb());
    await Promise.all([
      repo.merge("a", reported("gpt-5"), { confirmed: true, harness: "codex" }),
      repo.merge("a", reported("m"), { confirmed: true, harness: "pi" }),
    ]);
    expect((await repo.read("a", "codex"))?.model).toBe("gpt-5");
    expect((await repo.read("a", "pi"))?.model).toBe("m");
  });

  /** TEST_SCENARIO: Only another harness has reported so far, so the agent's
   * own snapshot reads as never captured, until it is. */
  it("reads no top-level snapshot until one is written", async () => {
    const repo = createHarnessConfigSnapshotRepo(fakeDb());
    await repo.merge("a", reported("gpt-5"), {
      confirmed: true,
      harness: "codex",
    });
    expect(await repo.read("a")).toBeNull();
    await repo.merge("a", reported("opus"), { confirmed: true });
    expect(await repo.read("a")).toMatchObject({ model: "opus" });
    expect((await repo.read("a", "codex"))?.model).toBe("gpt-5");
  });
});
