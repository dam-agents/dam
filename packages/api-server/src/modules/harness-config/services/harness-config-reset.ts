import type { Db, DbTx } from "db";
import { emit, EventType } from "../../../events.js";
import type { HarnessConfigEventQueue } from "../infrastructure/config-event-queue.js";
import type { HarnessConfigResetRepo } from "../infrastructure/reset-repo.js";
import type { HarnessConfigSnapshotRepo } from "../infrastructure/snapshot-repo.js";

const BATCH = 100;
const LOCK_TIMEOUT_MS = 5_000;
const HINT_TIMEOUT_MS = 10_000;

/**
 * UNIT_BOUNDARY_DESCRIPTION: a one-off reset of Claude Code's default
 * permission mode, which an earlier image rewrite left at bypassPermissions on
 * the Agents holding one Connection preset. The cohort is frozen once, before
 * any Agent is processed, and an Agent of it is settled in one transaction
 * holding its snapshot lock: the mode it reports is read there, and the
 * harness-config change the Config panel sends — mode auto — is queued and
 * declared there, so an owner's change cannot land between the decision and
 * what the Agent is told. A failed Agent stays pending and is retried on a
 * later start. Waking the pod is a hint that can fail; the correction is
 * durable without it.
 */
export function createHarnessConfigReset(deps: {
  repo: HarnessConfigResetRepo;
  snapshotRepo: HarnessConfigSnapshotRepo;
  eventQueue: HarnessConfigEventQueue;
  enqueue: (agentId: string) => Promise<void>;
  ownerOf: (agentId: string) => Promise<string | null>;
  harness: string;
  from: string;
  to: string;
  log: (msg: string) => void;
  batch?: number;
  lockTimeoutMs?: number;
  hintTimeoutMs?: number;
}): { run(): Promise<{ reset: number; failed: number }> } {
  /**
   * UNIT_BOUNDARY_DESCRIPTION: where the Agent reports its mode — the named
   * harness's own snapshot when the runtime keeps one, since a stale root value
   * must not override a newer per-harness one, and the root otherwise.
   */
  const locate = async (agentId: string, tx: Db | DbTx) => {
    const named = await deps.snapshotRepo.read(agentId, deps.harness, tx);
    if (named) return { harness: deps.harness, mode: named.mode };
    const root = await deps.snapshotRepo.read(agentId, undefined, tx);
    return root ? { mode: root.mode } : null;
  };

  const bounded = async <T>(work: Promise<T>, ms: number) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<undefined>((done) => {
          timer = setTimeout(() => done(undefined), ms);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    async run() {
      if (await deps.repo.roster())
        deps.log(`[harness-config-reset] ${deps.harness}: cohort frozen`);
      else if (await deps.repo.frozen())
        deps.log(
          `[harness-config-reset] ${deps.harness}: cohort was frozen already`,
        );
      let reset = 0;
      let failed = 0;
      let after = "";
      for (;;) {
        const batch = await deps.repo.pending({
          after,
          limit: deps.batch ?? BATCH,
        });
        if (batch.length === 0) break;
        for (const agentId of batch) {
          after = agentId;
          try {
            const done = await deps.snapshotRepo.locked(
              agentId,
              async (tx) => {
                /* UNIT_BOUNDARY_DESCRIPTION: the pending list was read before
                 * this transaction, so another boot may have settled this Agent
                 * since; the claim decides, and it rolls back with a correction
                 * that did not commit. */
                if (!(await deps.repo.claim(agentId, tx))) return "settled";
                const found = await locate(agentId, tx);
                if (found?.mode === deps.from) {
                  const patch = { mode: deps.to };
                  const scope =
                    found.harness === undefined
                      ? {}
                      : { harness: found.harness };
                  await deps.eventQueue.queue(
                    agentId,
                    { ...patch, ...scope },
                    tx,
                  );
                  await deps.snapshotRepo.merge(agentId, patch, {
                    confirmed: false,
                    ...scope,
                    tx,
                  });
                }
                return found?.mode === deps.from ? "reset" : "settled";
              },
              { lockTimeoutMs: deps.lockTimeoutMs ?? LOCK_TIMEOUT_MS },
            );
            if (done !== "reset") continue;
          } catch (err) {
            failed += 1;
            deps.log(
              `[harness-config-reset] ${agentId}: ${(err as Error).message}`,
            );
            continue;
          }
          reset += 1;
          await bounded(
            deps.enqueue(agentId),
            deps.hintTimeoutMs ?? HINT_TIMEOUT_MS,
          ).catch((err: unknown) =>
            deps.log(
              `[harness-config-reset] ${agentId}: queued, but waking it failed: ${(err as Error).message}`,
            ),
          );
          const ownerSub = await bounded(
            deps.ownerOf(agentId),
            deps.hintTimeoutMs ?? HINT_TIMEOUT_MS,
          ).catch(() => null);
          if (ownerSub)
            emit({ type: EventType.HarnessConfigChanged, agentId, ownerSub });
        }
      }
      deps.log(
        `[harness-config-reset] reset ${deps.harness} from ${deps.from} to ${deps.to} on ${reset} agent(s)${failed ? `, ${failed} retried on a later start` : ""}`,
      );
      return { reset, failed };
    },
  };
}
