import type { ApprovalsRepository } from "../infrastructure/approvals-repository.js";
import type { WrapperFrameSender } from "./approvals-service.js";
import {
  buildAcpPermissionResponse,
  pickOptionId,
} from "../infrastructure/wrapper-response-frames.js";

export interface DeliverySweeper {
  start(): void;
  stop(): Promise<void>;
}

export interface CreateDeliverySweeperDeps {
  repo: ApprovalsRepository;
  wrapperFrameSender: WrapperFrameSender;
  /** How often to scan for resolved-but-undelivered rows. */
  intervalMs: number;
  /** Only retry rows whose `resolved_at` is at least this old — gives the
   *  inline path on the click-handling replica room to finish without the
   *  sweep racing it. */
  staleMs: number;
  /** Cap per tick to bound work on a busy cluster. */
  batchSize: number;
}

/**
 * Periodic best-effort retry of rows that are `resolved AND delivered_at IS NULL`,
 * paired with an overdue-pending sweep that flips rows past their
 * `expires_at` to `expired`.
 *
 * No claim coordination — every replica scans, and on a contention race
 * multiple replicas may dial the wrapper for the same row. The wrapper
 * deduplicates by JSON-RPC id (matches against its `pendingFromAgent` map
 * and drops anything not pending), so duplicate sends are harmless. First
 * successful send stamps `delivered_at`; subsequent scans skip the row.
 *
 * The retry path covers exactly the failure modes the inline path can't:
 *   - Replica died after CAS-resolve, before WS send.
 *   - WS send raised; the inline path swallowed and didn't retry.
 *   - Wrapper was momentarily unreachable (pod restart, pending-to-running
 *     ramp).
 *
 * The expire path bounds inbox lifetime: ext_authz rows past their TTL
 * (24h default), and acp_native rows whose wrapper is gone for good, get
 * flipped to `expired` so the inbox doesn't accumulate stale work.
 */
export function createDeliverySweeper(
  deps: CreateDeliverySweeperDeps,
): DeliverySweeper {
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const rows = await deps.repo.listResolvedUndelivered({
        staleMs: deps.staleMs,
        limit: deps.batchSize,
      });
      for (const row of rows) {
        if (row.payload.kind !== "acp_native") continue;
        if (row.verdict === null) continue;
        const rpcId = row.payload.rpcId;
        if (rpcId === undefined || rpcId === null) continue;
        const optionId = pickOptionId(row.payload.options ?? [], row.verdict);
        const frame = JSON.stringify(buildAcpPermissionResponse(rpcId, optionId));
        try {
          await deps.wrapperFrameSender.send(row.instanceId, frame);
          await deps.repo.markDelivered(row.id);
        } catch {
          // Leave for next tick. The expire-overdue pass below bounds how
          // long a never-delivered row sticks around in the inbox.
        }
      }
      // Flip overdue pending rows to `expired`. The query is cheap (a
      // partial index on `(status, expires_at)` would help if it ever
      // becomes hot, but the DELETE-on-agent-cleanup keeps the table
      // small in normal operation).
      await deps.repo.expireOverdue(new Date()).catch(() => {});
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => {
        tick().catch(() => {});
      }, deps.intervalMs);
      // Don't keep the event loop alive on shutdown.
      timer.unref?.();
    },
    async stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      // Wait for an in-flight tick to settle. Bounded by frame-sender
      // connect timeout × batchSize; in practice well under a second.
      while (running) await new Promise((r) => setTimeout(r, 50));
    },
  };
}
