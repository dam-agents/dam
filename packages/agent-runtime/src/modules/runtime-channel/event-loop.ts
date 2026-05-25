import type { Event } from "agent-runtime-api";
import type { TriggerImpl } from "./drivers/trigger-impl.js";
import type { StateStore } from "./state-store.js";

/**
 * Event loop — invoked after contribution reconciliation per ADR-052.
 * Walks the payload's `events[]` in order; for each event whose
 * `version` is past the agent's `lastAppliedVersion` cursor, calls the
 * per-kind handler **locally** inside the agent-runtime.
 *
 * Dedupe model — single cursor:
 *   - Events with `version <= lastAppliedVersion` are skipped (already
 *     processed in a prior batch that the agent crashed during).
 *   - After each successful handler commit, the cursor advances by one
 *     event. A crash between handler completion and cursor write is
 *     possible; on retry the same event runs again. For triggers a
 *     rare duplicate is acceptable (one extra session); the alternative
 *     — advance-before-handler — risks silently dropping a scheduled
 *     fire on crash, which is worse for user-visible scheduled work.
 */
export async function processEvents(
  events: Event[],
  triggerImpl: TriggerImpl,
  stateStore: StateStore,
  log: (msg: string) => void,
): Promise<void> {
  const now = Date.now();
  for (const e of events) {
    const cursor = stateStore.read().lastAppliedVersion;
    if (e.version <= cursor) {
      log(
        `[runtime] event ${e.id} (version=${e.version}) already processed; skipping`,
      );
      continue;
    }

    // Defense-in-depth — the server's state-builder already filters by
    // expires_at, but agents on slow time-sync should still skip an
    // event that's locally past TTL.
    const expiresMs = Date.parse(e.expiresAt);
    if (Number.isFinite(expiresMs) && expiresMs <= now) {
      log(`[runtime] event ${e.id} expired locally; skipping`);
      continue;
    }

    try {
      await invokeHandler(e, triggerImpl);
      const current = stateStore.read();
      stateStore.write({
        lastAppliedVersion: e.version,
        lastAppliedHash: current.lastAppliedHash,
      });
    } catch (err) {
      log(
        `[runtime] event ${e.id} (${e.kind}) failed: ${(err as Error).message}`,
      );
      // Don't advance the cursor — the server will redeliver on the
      // next dispatch. Continue with the next event so an independent
      // kind isn't head-of-line-blocked.
    }
  }
}

async function invokeHandler(
  e: Event,
  triggerImpl: TriggerImpl,
): Promise<void> {
  switch (e.kind) {
    case "trigger":
      await triggerImpl.handle(e.payload);
      return;
  }
}
