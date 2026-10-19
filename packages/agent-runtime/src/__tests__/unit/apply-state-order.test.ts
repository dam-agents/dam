/**
 * TEST_OVERVIEW: A delivery's contributions are in force before its events run.
 * The workspace seed and the install command call git, and git authenticates
 * through gh's credential helper, so the helper's setup — fed by the
 * contributions — must settle before the first event of the same delivery is
 * dispatched, not after it.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ApplyStateInput, Contribution } from "agent-runtime-api";

import { createFileDocumentStoreBackend } from "../../core/document-store.js";
import { createRuntimeChannelService } from "../../modules/runtime-channel/service.js";
import { createStateStore } from "../../modules/runtime-channel/state-store.js";

const token: Contribution = {
  kind: "env",
  name: "GH_ENTERPRISE_TOKEN",
  placeholder: "platform:conn:aaa",
};

function delivery(hash: string): ApplyStateInput {
  return {
    version: 1,
    state: { hash, contributions: [token] },
    events: [
      {
        id: "seed:1000",
        kind: "workspace-seed",
        version: 1,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        payload: { url: "https://ghe.example.com/org/kit" },
      },
    ],
  } as ApplyStateInput;
}

describe("runtime-channel applyState", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "apply-order-"));
    mkdirSync(join(home, ".platform"), { recursive: true });
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  function service(order: string[]) {
    return createRuntimeChannelService({
      dispatcher: {
        apply: async () => {
          order.push("contributions");
          return [];
        },
      },
      eventDispatcher: {
        invoke: async (kind) => {
          order.push(kind);
        },
      },
      stateStore: createStateStore(createFileDocumentStoreBackend(home)),
      readHarnessConfig: async () => ({}),
      onContributionsApplied: async (contributions) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push(`applied:${contributions.length}`);
      },
      onSnapshotProcessed: () => {
        order.push("processed");
      },
      reporter: { report: async () => {} },
      log: () => {},
    });
  }

  /** TEST_SCENARIO: A new agent's first delivery carries its GitHub Enterprise
   * Connection and the kit's seed together; the seed runs only once the
   * credential setup for that Connection has settled. */
  it("settles the contribution hook before dispatching the delivery's events", async () => {
    const order: string[] = [];
    await service(order).applyState(delivery("h1"));
    expect(order).toEqual([
      "contributions",
      "applied:1",
      "workspace-seed",
      "processed",
    ]);
  });

  /** TEST_SCENARIO: A retry redelivers the same snapshot, so dispatch is
   * skipped; the hook still runs ahead of the seed, so a runtime that restarted
   * between the attempts sets git up again before retrying. */
  it("runs the hook ahead of the events when the snapshot is unchanged", async () => {
    const order: string[] = [];
    const s = service(order);
    await s.applyState(delivery("h1"));
    order.length = 0;
    await s.applyState({
      ...delivery("h1"),
      events: [{ ...delivery("h1").events[0]!, id: "seed:2000" }],
    });
    expect(order).toEqual(["applied:1", "workspace-seed", "processed"]);
  });
});
