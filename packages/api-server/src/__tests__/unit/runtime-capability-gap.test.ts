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
import { outboxRow } from "../helpers/outbox-row.js";

const AGENT = "agent-1";
const SETTLED = 5;
const ENV = { contributions: ["env"], events: [] };
const ENV_AND_SKILLS = { contributions: ["env", "skill-ref"], events: [] };

async function runHello(
  previous: unknown,
  reported: unknown,
  cursor: number,
): Promise<{
  enqueued: { agentId: string; retryUntilReady?: boolean }[];
  bumped: boolean;
}> {
  const enqueued: { agentId: string; retryUntilReady?: boolean }[] = [];
  let bumped = false;
  const hello = createHelloHandler({
    outboxRepo: {
      getRow: async () => outboxRow({ agentId: AGENT, version: SETTLED }),
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
    queue: {
      enqueue: async (
        agentId: string,
        opts?: { retryUntilReady?: boolean },
      ) => {
        enqueued.push({ agentId, ...opts });
      },
    } as unknown as StateQueue,
    resolveOwner: async () => null,
    log: () => {},
  });
  await hello.hello(AGENT, {
    lastAppliedVersion: cursor,
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
