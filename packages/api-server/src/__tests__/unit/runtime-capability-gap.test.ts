/** TEST_OVERVIEW: how a runtime that starts accepting more Contribution kinds
 *  gets the ones its older image refused. Capability filtering runs before the
 *  payload hash, so a gapped delivery settles clean and nothing in the outbox
 *  cursors records that anything was withheld — which means a hello reporting
 *  a changed capability set is the only thing that can re-open delivery, and
 *  it has to do so durably. */
import { describe, it, expect } from "vitest";
import { createHelloHandler } from "../../modules/runtime-delivery/services/hello-handler.js";
import type {
  AgentsRuntimeRepo,
  OutboxRepo,
} from "../../modules/runtime-delivery/infrastructure/outbox-repo.js";
import type { StateQueue } from "../../modules/runtime-delivery/infrastructure/state-queue.js";
import type { HarnessConfigSnapshotWriter } from "../../modules/runtime-delivery/services/snapshot-writer.js";
import type { StateBuilder } from "../../modules/runtime-delivery/services/state-builder.js";
import type { DriverFailure } from "api-server-api";
import type { Tx } from "../../core/unit-of-work.js";
import { outboxRow } from "../helpers/outbox-row.js";

const AGENT = "agent-1";
const SETTLED = 5;
const ENV = { contributions: ["env"], events: [] };
const ENV_AND_SKILLS = { contributions: ["env", "skill-ref"], events: [] };

async function runHello(
  previous: unknown,
  reported: unknown,
  cursor: number,
  drift: {
    applied?: string;
    built?: string;
    failures?: DriverFailure[];
  } = {},
): Promise<{
  enqueued: { agentId: string; retryUntilReady?: boolean }[];
  bumped: boolean;
}> {
  const enqueued: { agentId: string; retryUntilReady?: boolean }[] = [];
  let bumped = false;
  const hello = createHelloHandler({
    outboxRepo: {
      getRow: async () =>
        outboxRow({
          agentId: AGENT,
          version: SETTLED,
          applyFailures: drift.failures ?? [],
        }),
      bumpVersion: async () => {
        bumped = true;
        return SETTLED + 1;
      },
    } as unknown as OutboxRepo,
    agentsRuntimeRepo: {
      upsertHello: async () => ({ previousCapabilities: previous }),
    } as unknown as AgentsRuntimeRepo,
    snapshotWriter: {
      merge: async () => {},
    } as unknown as HarnessConfigSnapshotWriter,
    stateBuilder: {
      build: async () => ({ hash: drift.built ?? "built" }),
    } as unknown as StateBuilder,
    queue: {
      enqueue: async (
        agentId: string,
        opts?: { retryUntilReady?: boolean },
      ) => {
        enqueued.push({ agentId, ...opts });
      },
    } as unknown as StateQueue,
    uow: async (fn) => fn({} as Tx),
    resolveOwner: async () => null,
    log: () => {},
  });
  await hello.hello(AGENT, {
    lastAppliedVersion: cursor,
    ...(drift.applied !== undefined && { lastAppliedHash: drift.applied }),
    protocolVersion: "v1",
    agentRuntimeVersion: "1.0.0",
    capabilities: reported,
  } as Parameters<typeof hello.hello>[1]);
  return { enqueued, bumped };
}

describe("runtime capability gap", () => {
  /** TEST_SCENARIO: hello's re-delivery decision. A gapped delivery settled
   *  clean, so after an agent update only the capability change can re-send
   *  the refused parts — and it must raise the version, not just enqueue, or a
   *  lost job strands the gap with nothing left to detect it. An unchanged
   *  reconnect must stay quiet; hello fires on every reconnect. */
  it.each([
    [
      "widened kinds bump and re-deliver",
      ENV,
      ENV_AND_SKILLS,
      SETTLED,
      true,
      true,
    ],
    [
      "unchanged kinds on a caught-up row do nothing",
      ENV,
      ENV,
      SETTLED,
      false,
      false,
    ],
    [
      "unchanged kinds behind the cursor re-deliver only",
      ENV,
      ENV,
      2,
      false,
      true,
    ],
  ])("%s", async (_case, previous, reported, cursor, bumps, redelivers) => {
    const { bumped, enqueued } = await runHello(previous, reported, cursor);
    expect(bumped).toBe(bumps);
    expect(enqueued).toEqual(
      redelivers ? [{ agentId: AGENT, retryUntilReady: true }] : [],
    );
  });
});

describe("runtime state drift", () => {
  /** TEST_SCENARIO: a deploy changes the state built for an agent without
   *  raising its version, as when provider env gained its template. A
   *  caught-up agent whose applied hash no longer matches the state built now
   *  is re-delivered through a version bump; a matching hash, an agent that
   *  reports no hash, and one with failures the retries own stay quiet. */
  it.each([
    ["a stale applied hash bumps and re-delivers", { applied: "old" }, true],
    [
      "a matching applied hash does nothing",
      { applied: "built", built: "built" },
      false,
    ],
    ["no reported hash does nothing", {}, false],
    [
      "failures on record leave it to their retries",
      {
        applied: "old",
        failures: [{ kind: "env", message: "boom" }] as DriverFailure[],
      },
      false,
    ],
  ])("%s", async (_case, drift, redelivers) => {
    const { bumped, enqueued } = await runHello(ENV, ENV, SETTLED, drift);
    expect(bumped).toBe(redelivers);
    expect(enqueued).toEqual(
      redelivers ? [{ agentId: AGENT, retryUntilReady: true }] : [],
    );
  });
});
